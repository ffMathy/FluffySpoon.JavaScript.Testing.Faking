import { CallRecord, RecordKind, currentSequence } from './CallRecord'
import { StackHolder } from './CallSite'
import { RecordedArguments } from './RecordedArguments'
import { SELF, SubstitutionMethod, keyToString } from './Constants'
import { entryPath, rootLabel } from './Paths'
import { libraryGuard } from './utilities/Guard'
import { closeLook, openLook } from './utilities/Look'

export { pathArguments } from './Paths'

let substitutionOrder = 0

/** A configured behaviour: `sub.add(1, Arg.any()).returns(3, 4)`, `sub.prop.throws(err)`, ... */
export class Substitution {
  private _next = 0
  public readonly order = ++substitutionOrder

  constructor(
    public readonly kind: 'get' | 'call',
    public readonly key: PropertyKey,
    /** The expected arguments for a call; undefined for a property. */
    public readonly args: RecordedArguments | undefined,
    /** 'auto' returns a cached auto-substitute; it is registered by nested setups such as `sub[configure]().a(Arg.any()).b.returns(1)`. */
    public readonly method: SubstitutionMethod | 'auto',
    public readonly values: readonly any[],
    public readonly entry?: AutoEntry
  ) { }

  public get rank(): number {
    return this.args?.rank ?? 0
  }

  /** The value the next use would give, without using it. */
  public peekValue(): any {
    return this.values.length === 0 ? undefined : this.values[this._next]
  }

  /** The values are used in order and the last one keeps being used (NSubstitute semantics). */
  public nextValue(): any {
    const values = this.values
    if (values.length === 0) return undefined
    const value = values[this._next]
    if (this._next < values.length - 1) this._next++
    return value
  }
}

/**
 * The auto-substitute behind an unconfigured property read (kind 'get', one per member) or an
 * unconfigured call (kind 'call', one per member and argument list). Repeated access to the same path
 * with matching arguments gets the same entry, so nested setups and assertions find each other.
 */
export class AutoEntry {
  // D30: the state (records, configuration, nested auto-substitutes), created when it is first used
  private _state?: SubstituteState = undefined
  public proxy: any = undefined
  /** The record of the operation that last handed out this entry's proxy, and the sequence number at that time. */
  private _handedOutBy?: CallRecord = undefined
  private _handedOutAt = 0

  constructor(
    public readonly kind: 'get' | 'call',
    public readonly parent: SubstituteState,
    public readonly key: PropertyKey,
    /** The arguments of a call entry: a specification, or the actual arguments of the call that created it. */
    public readonly args?: RecordedArguments
  ) { }

  /** The argument list of this call entry (the actual arguments, or the specification's). */
  public get argumentList(): readonly unknown[] | undefined {
    return this.args?.value
  }

  /**
   * E81: whether this is the auto-substitute of a nested setup through a call with matchers (see specificationEntry),
   * which stands for every call matching it, rather than of one call or member.
   */
  public get specifiesMatchers(): boolean {
    const argumentsClass = this.args?.argumentsClass
    return argumentsClass === 'with-predicate' || argumentsClass === 'wildcard'
  }

  /** Whether the arguments of this call entry match a call with these actual arguments. */
  public matchesCall(actualArguments: readonly unknown[]): boolean {
    return this.args !== undefined && this.args.matches(actualArguments)
  }

  public get state(): SubstituteState {
    if (this._state === undefined) this._state = new SubstituteState(this)
    return this._state
  }

  public get materializedState(): SubstituteState | undefined {
    return this._state
  }

  /**
   * E24: the path of this auto-substitute (`@Substitute.logger`, `@Substitute.getUser(1)`), without creating its state.
   * E33/E35: bounded, and built without recursion (see Paths).
   */
  public get path(): string {
    return entryPath(this)
  }

  /** Notes that the operation of `record` hands out this entry's proxy. */
  public handOut(record: CallRecord): void {
    this._handedOutBy = record
    this._handedOutAt = currentSequence()
  }

  /**
   * The record that handed out this proxy, if that was the most recent operation of all. Then the current
   * operation may continue the same expression (`sub.a.b`): the engine checks that both come from the same
   * function (D25), and setups or assertions resolved later on in the chain retract it.
   */
  public adjacentHandOut(): CallRecord | undefined {
    return this._handedOutAt === currentSequence() ? this._handedOutBy : undefined
  }

  /** E111: forgets that `record` handed out this proxy (a check made through it used it up, see the engine's faceContextFunction). */
  public forgetHandOut(record: CallRecord): void {
    if (this._handedOutBy === record) this._handedOutBy = undefined
  }
}

/**
 * E81 (R13FE-3): whether a substitution answers calls. An 'auto' registration (the auto-substitute of a nested setup
 * through a call, `repo.find(Arg.any()).name.returns('x')`) answers only once something below it is configured: a read
 * or a check through a call with matchers (`repo.find(Arg.any()).name`, `repo.find(Arg.any()).items[received]()`)
 * registers the auto-substitute that a nested setup would configure, and it must not change what later calls answer.
 */
const answers = (substitution: Substitution): boolean =>
  substitution.method !== 'auto' || substitution.entry!.materializedState?.configured === true

/** The call substitutions configured for one member: all-literal ones and ones with matchers, each in configuration order. */
class CallSubstitutions {
  private readonly _literal: Substitution[] = []
  private readonly _withMatchers: Substitution[] = []

  public get size(): number {
    return this._literal.length + this._withMatchers.length
  }

  /** Adds a substitution. One with the same specification is replaced (most recent wins). */
  public add(substitution: Substitution): void {
    const args = substitution.args!
    const list = args.argumentsClass === 'plain' ? this._literal : this._withMatchers
    const index = list.findIndex(existing => existing.args!.equals(args))
    if (index !== -1) list.splice(index, 1)
    list.push(substitution)
  }

  /** The substitution configured with exactly this specification. */
  public withSpecification(args: RecordedArguments): Substitution | undefined {
    const list = args.argumentsClass === 'plain' ? this._literal : this._withMatchers
    return list.find(substitution => substitution.args!.equals(args))
  }

  /**
   * The most specific class wins (all-literal, then predicates, then Arg.all()); within a class the most recent one.
   * `real`: for a real call of the code under test (E100, see Look).
   */
  public match(actualArguments: readonly unknown[], real = false): Substitution | undefined {
    const literal = this._literal
    for (let index = literal.length - 1; index >= 0; index--) {
      const candidate = literal[index]
      if (answers(candidate) && candidate.args!.matches(actualArguments)) return candidate
    }

    const withMatchers = this._withMatchers
    if (withMatchers.length === 0) return undefined
    // E100 (R15-ADV-4): one guard for the matchers of the whole pass. A real call opens the look of its arguments (see
    // Look); anything else (a setup's registration, a matcher's look itself) looks with nothing recorded at all.
    const look = real && libraryGuard.matching === 0 ? openLook(actualArguments) : undefined
    if (look === undefined) libraryGuard.matching++
    let best: Substitution | undefined
    try {
      for (let index = withMatchers.length - 1; index >= 0; index--) {
        const candidate = withMatchers[index]
        if (best !== undefined && candidate.rank >= best.rank) continue
        if (answers(candidate) && candidate.args!.matches(actualArguments, true)) best = candidate
      }
    } finally {
      if (look === undefined) libraryGuard.matching--
      else closeLook(look)
    }
    return best
  }

  public *all(): IterableIterator<Substitution> {
    yield* this._literal
    yield* this._withMatchers
  }
}

const memberPath = (state: SubstituteState, key: PropertyKey): string =>
  key === SELF ? state.path : `${state.path}.${keyToString(key)}`

/**
 * E81, E88 (R14-ADV-5): what a received call answered with when a setup or a mimicked instance answered it (see
 * SubstituteState.noteConfiguredAnswer): a substitute of this copy of the library (its AutoEntry or SubstituteState), or
 * anything the engine notes about another value (what gave it, or the value itself, see the engine's handOutConfigured).
 */
export type ConfiguredAnswer = object

/**
 * Everything the library knows about one substitute (the root, or a cached auto-substitute):
 * the received calls, the configured substitutions, the mimicked instance and the auto-substitutes.
 */
export class SubstituteState {
  private readonly _records: CallRecord[] = []
  private readonly _recordsByKey = new Map<PropertyKey, CallRecord[]>()
  private readonly _pendingReads = new Map<PropertyKey, CallRecord[]>()

  private readonly _propertySubstitutions = new Map<PropertyKey, Substitution>()
  private readonly _callSubstitutions = new Map<PropertyKey, CallSubstitutions>()

  private readonly _propertyEntries = new Map<PropertyKey, AutoEntry>()
  private readonly _callEntries = new Map<PropertyKey, AutoEntry[]>()
  private readonly _specificationEntries = new Map<PropertyKey, AutoEntry[]>()

  private _mimicked?: { instance: any }
  /** E35: the keys of this substitute that have a setup: of the member itself, or further down (see noteSetup). */
  private _configuredKeys?: Set<PropertyKey>
  /** E35: whether this substitute, or one of its auto-substitutes, has a setup or mimicks an instance. */
  private _configured?: boolean
  /** E39: the record of the operation that last answered with this substitute (a configured value), and when. */
  private _handedOutBy?: CallRecord
  private _handedOutAt?: number
  /** E81, E88: what the received calls answered with a configured value (see noteConfiguredAnswer). */
  private readonly _configuredAnswers = new Map<CallRecord, ConfiguredAnswer>()

  constructor(public readonly owner?: AutoEntry) { }

  /**
   * E39: notes that the operation of `record` answered with this substitute, a configured value
   * (`app.getCalc().returns(calc)`), so that a setup or a check chained to it in the same expression
   * (`app.getCalc().add(1, 2).returns(3)`) leaves out that operation, as for auto-substitutes (see AutoEntry.handOut).
   */
  public handOut(record: CallRecord): void {
    this._handedOutBy = record
    this._handedOutAt = currentSequence()
  }

  /** E39: the record that answered with this substitute, if that was the most recent operation of all. */
  public adjacentHandOut(): CallRecord | undefined {
    return this._handedOutAt === currentSequence() ? this._handedOutBy : undefined
  }

  /** E111: forgets that `record` handed out this substitute (a check made through it used it up, see the engine's faceContextFunction). */
  public forgetHandOut(record: CallRecord): void {
    if (this._handedOutBy === record) this._handedOutBy = undefined
  }

  public get mimicked(): { instance: any } | undefined {
    return this._mimicked
  }

  public set mimicked(mimicked: { instance: any } | undefined) {
    this._mimicked = mimicked
    if (mimicked !== undefined) this.noteSetup(undefined)
  }

  /**
   * E35: whether `key in sub` holds for a setup: the member has a setup of its own (a property or a call, not the
   * 'auto' registrations of nested setups and of matcher chains), or one of its auto-substitutes has one, or mimicks an
   * instance. A setup notes its key here and in every substitute above it (noteSetup).
   */
  public isConfiguredKey(key: PropertyKey): boolean {
    return this._configuredKeys !== undefined && this._configuredKeys.has(key)
  }

  /** E81: whether this substitute, or one of its auto-substitutes, has a setup or mimicks an instance (see noteSetup). */
  public get configured(): boolean {
    return this._configured === true
  }

  /**
   * E35: notes a setup of `key` (undefined: a mimicked instance) on this substitute, and that this substitute is
   * configured on the key of its owner, and so on up to the root. A substitute already noted as configured has noted
   * that above it before, so the walk stops there.
   */
  private noteSetup(key: PropertyKey | undefined): void {
    let state: SubstituteState = this
    let configuredKey = key
    for (;;) {
      if (configuredKey !== undefined) (state._configuredKeys ?? (state._configuredKeys = new Set())).add(configuredKey)
      if (state._configured === true) return
      state._configured = true
      const owner = state.owner
      if (owner === undefined) return
      configuredKey = owner.key
      state = owner.parent
    }
  }

  public get path(): string {
    return this.owner === undefined ? rootLabel(this) : this.owner.path
  }

  public memberPath(key: PropertyKey): string {
    return memberPath(this, key)
  }

  // ---- received calls -------------------------------------------------------------------------

  /** Records an operation; `site` is its call site (CallSite.captureStack), captured by the trap of the operation. */
  public addRecord(kind: RecordKind, key: PropertyKey, args: any[] | undefined, site: StackHolder): CallRecord {
    const record = new CallRecord(kind, key, args, site)
    this._records.push(record)
    const forKey = this._recordsByKey.get(key)
    if (forKey === undefined) this._recordsByKey.set(key, [record])
    else forKey.push(record)
    return record
  }

  /** A property read whose result may still be invoked (a method read in order to call it). */
  public addPendingRead(record: CallRecord): void {
    const pending = this._pendingReads.get(record.key)
    if (pending === undefined) this._pendingReads.set(record.key, [record])
    else pending.push(record)
  }

  /** The most recent property read of the member that has not been invoked yet. */
  public takePendingRead(key: PropertyKey): CallRecord | undefined {
    const pending = this._pendingReads.get(key)
    while (pending !== undefined && pending.length > 0) {
      const record = pending.pop()!
      if (!record.retracted && record.kind === 'get') return record
    }
    return undefined
  }

  /**
   * E81: notes that a received call of this substitute answered with a configured value that is a substitute (a setup's
   * value, the auto-substitute of a nested setup through a call with matchers, a mimicked instance's value), so that a
   * check through a call with matchers can count that substitute's calls. E88 (R14-ADV-5): and what answered a call with
   * any other configured value (see ConfiguredAnswer), so that such a check knows that it cannot count it. An
   * unconfigured call notes the auto-substitute it answered on its record (CallRecord.autoAnswer).
   */
  public noteConfiguredAnswer(record: CallRecord, answer: ConfiguredAnswer): void {
    this._configuredAnswers.set(record, answer)
  }

  /** E81: what the received calls of one member answered, for those noted by noteConfiguredAnswer. */
  public configuredAnswers(key: PropertyKey): Map<CallRecord, ConfiguredAnswer> | undefined {
    const byRecord = new Map<CallRecord, ConfiguredAnswer>()
    for (const record of this.recordsFor(key)) {
      const answer = this._configuredAnswers.get(record)
      if (answer !== undefined) byRecord.set(record, answer)
    }
    return byRecord.size === 0 ? undefined : byRecord
  }

  /** E81: what one received call answered, if it was noted (see noteConfiguredAnswer). */
  public configuredAnswerOf(record: CallRecord): ConfiguredAnswer | undefined {
    return this._configuredAnswers.get(record)
  }

  /** Received calls of one member, in order, without retracted records. */
  public recordsFor(key: PropertyKey): CallRecord[] {
    const records = this._recordsByKey.get(key)
    return records === undefined ? [] : records.filter(record => !record.retracted)
  }

  public get records(): CallRecord[] {
    return this._records.filter(record => !record.retracted)
  }

  /**
   * E123 (R17-ADV-12): when the received calls of this substitute were cleared last (the sequence value then; 0 if they
   * never were), so that a check through one of its calls does not count the calls that the substitutes it handed out
   * received before (see the engine's followRoute).
   */
  private _clearedAt?: number

  public get clearedAt(): number {
    return this._clearedAt ?? 0
  }

  /** Clears the received calls of this substitute and of its auto-substitutes (E35: without recursion). */
  public clearReceivedCalls(): void {
    const pending: SubstituteState[] = [this]
    const clearedAt = currentSequence()
    while (pending.length > 0) {
      const state = pending.pop()!
      state._records.length = 0
      state._recordsByKey.clear()
      state._pendingReads.clear()
      state._clearedAt = clearedAt
      state._configuredAnswers.clear()
      for (const entry of state.entries()) {
        const nested = entry.materializedState
        if (nested !== undefined) pending.push(nested)
      }
    }
  }

  // ---- substitutions --------------------------------------------------------------------------

  public setPropertySubstitution(key: PropertyKey, method: SubstitutionMethod, values: readonly any[]): void {
    this._propertySubstitutions.set(key, new Substitution('get', key, undefined, method, values))
    this.noteSetup(key)
  }

  public propertySubstitution(key: PropertyKey): Substitution | undefined {
    return this._propertySubstitutions.get(key)
  }

  /** Adds a call substitution. A substitution with the same specification is replaced (most recent wins). */
  public addCallSubstitution(key: PropertyKey, args: RecordedArguments, method: SubstitutionMethod | 'auto', values: readonly any[], entry?: AutoEntry): Substitution {
    const substitution = new Substitution('call', key, args, method, values, entry)
    let substitutions = this._callSubstitutions.get(key)
    if (substitutions === undefined) {
      substitutions = new CallSubstitutions()
      this._callSubstitutions.set(key, substitutions)
    }
    substitutions.add(substitution)
    if (method !== 'auto') this.noteSetup(key)
    return substitution
  }

  public hasCallSubstitutions(key: PropertyKey): boolean {
    const substitutions = this._callSubstitutions.get(key)
    return substitutions !== undefined && substitutions.size > 0
  }

  /** The substitution configured with exactly this specification, if any. */
  public callSubstitutionFor(key: PropertyKey, args: RecordedArguments): Substitution | undefined {
    return this._callSubstitutions.get(key)?.withSpecification(args)
  }

  /**
   * The substitution that answers a call: the most specific class wins (all-literal, then predicates,
   * then Arg.all()), and within a class the most recently configured one wins.
   */
  public findCallSubstitution(key: PropertyKey, actualArguments: readonly unknown[], real = false): Substitution | undefined {
    return this._callSubstitutions.get(key)?.match(actualArguments, real)
  }

  // ---- auto-substitutes -----------------------------------------------------------------------

  public propertyEntry(key: PropertyKey): AutoEntry {
    let entry = this._propertyEntries.get(key)
    if (entry === undefined) {
      entry = new AutoEntry('get', this, key)
      this._propertyEntries.set(key, entry)
    }
    return entry
  }

  /** True when the auto-substitute behind a member has its own configuration or records. */
  public hasConfiguredPropertyEntry(key: PropertyKey): boolean {
    return this._propertyEntries.get(key)?.materializedState !== undefined
  }

  /** E81: the auto-substitute behind a member, if it has been created (see propertyEntry). */
  public existingPropertyEntry(key: PropertyKey): AutoEntry | undefined {
    return this._propertyEntries.get(key)
  }

  /**
   * The auto-substitute for a call with these actual (literal) arguments (D2): the first one whose arguments match them
   * now, else a new one.
   */
  public callEntry(key: PropertyKey, actual: readonly unknown[]): AutoEntry {
    let list = this._callEntries.get(key)
    if (list === undefined) {
      list = []
      this._callEntries.set(key, list)
    }
    let entry = list.find(candidate => candidate.matchesCall(actual))
    if (entry === undefined) {
      entry = new AutoEntry('call', this, key, RecordedArguments.from(actual as any[]))
      list.push(entry)
    }
    return entry
  }

  /** The auto-substitute for a call specification used in a nested setup (`a(Arg.any()).b.returns(1)`). */
  public specificationEntry(key: PropertyKey, specification: RecordedArguments): AutoEntry {
    if (specification.argumentsClass === 'plain') return this.callEntry(key, specification.value!)
    let list = this._specificationEntries.get(key)
    if (list === undefined) {
      list = []
      this._specificationEntries.set(key, list)
    }
    let entry = list.find(existing => existing.args!.equals(specification))
    if (entry === undefined) {
      entry = new AutoEntry('call', this, key, specification)
      list.push(entry)
    }
    return entry
  }

  public *entries(): IterableIterator<AutoEntry> {
    yield* this._propertyEntries.values()
    for (const list of this._callEntries.values()) yield* list
    for (const list of this._specificationEntries.values()) yield* list
  }

  /** Configured substitutions, for printing. */
  public substitutions(): Substitution[] {
    const all: Substitution[] = [...this._propertySubstitutions.values()]
    for (const substitutions of this._callSubstitutions.values()) all.push(...substitutions.all())
    return all.sort((a, b) => a.order - b.order)
  }
}
