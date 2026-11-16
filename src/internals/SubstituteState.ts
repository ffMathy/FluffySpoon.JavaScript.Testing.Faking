import { inspect } from 'util'

import { CallRecord, RecordKind, currentSequence } from './CallRecord'
import { RecordedArguments } from './RecordedArguments'
import { SELF, SubstitutionMethod, keyToString } from './Constants'
import { fingerprintArguments, identityFingerprintArguments, stableFingerprintArguments } from './utilities'

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
  private _state?: SubstituteState
  public proxy: any
  /** The record of the operation that last handed out this entry's proxy, with the sequence number at that time. */
  public handedOutBy?: { record: CallRecord, seq: number }

  constructor(
    public readonly kind: 'get' | 'call',
    public readonly parent: SubstituteState,
    public readonly key: PropertyKey,
    public readonly args?: RecordedArguments
  ) { }

  public get state(): SubstituteState {
    if (this._state === undefined) this._state = new SubstituteState(this)
    return this._state
  }

  public get materializedState(): SubstituteState | undefined {
    return this._state
  }

  public handOut(record: CallRecord): void {
    this.handedOutBy = { record, seq: currentSequence() }
  }

  /**
   * The record that handed out this proxy, if that was the most recent operation of all. Then the
   * current operation continues the same expression (`sub.a.b`), and setups or assertions resolved
   * later on in the chain retract it.
   */
  public chainHead(): CallRecord | undefined {
    const handedOutBy = this.handedOutBy
    return handedOutBy !== undefined && handedOutBy.seq === currentSequence() ? handedOutBy.record : undefined
  }
}

type CallEntryIndex = {
  byFingerprint: Map<string, AutoEntry[]>
  /** The entry last handed out for exactly these primitives and objects (see identityFingerprintArguments). */
  byIdentity: Map<string, AutoEntry>
  unfingerprinted: AutoEntry[]
}

/** The most recent substitution in `list` (kept in configuration order) that matches, if it is more recent than `best`. */
const mostRecentMatch = (list: readonly Substitution[], actualArguments: readonly unknown[], best: Substitution | undefined): Substitution | undefined => {
  for (let index = list.length - 1; index >= 0; index--) {
    const candidate = list[index]
    if (best !== undefined && candidate.order < best.order) return best
    if (candidate.args!.matches(actualArguments)) return candidate
  }
  return best
}

/**
 * The call substitutions configured for one member.
 *
 * All-literal substitutions (the most specific class, D4) are indexed by the stable fingerprint of their
 * arguments, which deep strictly equal argument lists share and which does not change when an object in the
 * arguments is mutated after the setup (literal arguments are compared as they are when the call is made, D15).
 * A call therefore only compares against the literal substitutions with the same primitives in the same places:
 * a single one for distinct primitive arguments, however many there are. Substitutions with Arg matchers are kept
 * in a list.
 */
class CallSubstitutions {
  private readonly _literal = new Map<string, Substitution[]>()
  /** All-literal substitutions whose arguments could not be fingerprinted. */
  private readonly _unindexed: Substitution[] = []
  private readonly _withMatchers: Substitution[] = []
  private _size = 0

  public get size(): number {
    return this._size
  }

  private listFor(args: RecordedArguments, create: boolean): Substitution[] | undefined {
    if (args.argumentsClass !== 'plain') return this._withMatchers
    const fingerprint = stableFingerprintArguments(args.value!)
    if (fingerprint === undefined) return this._unindexed
    let list = this._literal.get(fingerprint)
    if (list === undefined && create) {
      list = []
      this._literal.set(fingerprint, list)
    }
    return list
  }

  /** Adds a substitution. One with the same specification is replaced (most recent wins). */
  public add(substitution: Substitution): void {
    const list = this.listFor(substitution.args!, true)!
    const index = list.findIndex(existing => existing.args!.equals(substitution.args!))
    if (index !== -1) list.splice(index, 1)
    else this._size++
    list.push(substitution)
  }

  /** The substitution configured with exactly this specification. */
  public withSpecification(args: RecordedArguments): Substitution | undefined {
    return this.listFor(args, false)?.find(substitution => substitution.args!.equals(args))
  }

  /** The most specific class wins (all-literal, then predicates, then Arg.all()); within a class the most recent one. */
  public match(actualArguments: readonly unknown[]): Substitution | undefined {
    let best: Substitution | undefined
    const fingerprint = stableFingerprintArguments(actualArguments)
    if (fingerprint !== undefined) {
      const list = this._literal.get(fingerprint)
      if (list !== undefined) best = mostRecentMatch(list, actualArguments, best)
    } else for (const list of this._literal.values()) best = mostRecentMatch(list, actualArguments, best)
    best = mostRecentMatch(this._unindexed, actualArguments, best)
    if (best !== undefined) return best

    const withMatchers = this._withMatchers
    for (let index = withMatchers.length - 1; index >= 0; index--) {
      const candidate = withMatchers[index]
      if (best !== undefined && candidate.rank >= best.rank) continue
      if (candidate.args!.matches(actualArguments)) best = candidate
    }
    return best
  }

  public *all(): IterableIterator<Substitution> {
    for (const list of this._literal.values()) yield* list
    yield* this._unindexed
    yield* this._withMatchers
  }
}

const memberPath = (state: SubstituteState, key: PropertyKey): string =>
  key === SELF ? state.path : `${state.path}.${keyToString(key)}`

const shortArguments = (args: RecordedArguments | undefined): string => {
  const values = args?.value ?? []
  try {
    return values.map(value => inspect(value, { depth: 0, colors: false, breakLength: Infinity })).join(', ')
  } catch {
    return '...'
  }
}

/**
 * Everything the library knows about one substitute (the root, or a cached auto-substitute):
 * the received calls, the configured substitutions, the mimicked instance and the auto-substitutes.
 * Received calls and configured substitutions are kept apart, so that resolving a call never scans
 * the history of received calls.
 */
export class SubstituteState {
  private readonly _records: CallRecord[] = []
  private readonly _recordsByKey = new Map<PropertyKey, CallRecord[]>()
  private readonly _pendingReads = new Map<PropertyKey, CallRecord[]>()

  private readonly _propertySubstitutions = new Map<PropertyKey, Substitution>()
  private readonly _callSubstitutions = new Map<PropertyKey, CallSubstitutions>()

  private readonly _propertyEntries = new Map<PropertyKey, AutoEntry>()
  private readonly _callEntries = new Map<PropertyKey, CallEntryIndex>()
  private readonly _specificationEntries = new Map<PropertyKey, AutoEntry[]>()

  public mimicked?: { instance: any }

  constructor(public readonly owner?: AutoEntry) { }

  public get path(): string {
    const owner = this.owner
    if (owner === undefined) return '@Substitute'
    const path = memberPath(owner.parent, owner.key)
    return owner.kind === 'get' ? path : `${path}(${shortArguments(owner.args)})`
  }

  public memberPath(key: PropertyKey): string {
    return memberPath(this, key)
  }

  // ---- received calls -------------------------------------------------------------------------

  public addRecord(kind: RecordKind, key: PropertyKey, args: any[] | undefined, stackStart: Function, chainPrevious?: CallRecord): CallRecord {
    const record = new CallRecord(kind, key, args, stackStart, chainPrevious)
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

  /** Received calls of one member, in order, without retracted records. */
  public recordsFor(key: PropertyKey): CallRecord[] {
    const records = this._recordsByKey.get(key)
    return records === undefined ? [] : records.filter(record => !record.retracted)
  }

  public get records(): CallRecord[] {
    return this._records.filter(record => !record.retracted)
  }

  public clearReceivedCalls(): void {
    this._records.length = 0
    this._recordsByKey.clear()
    this._pendingReads.clear()
    for (const entry of this.entries()) entry.materializedState?.clearReceivedCalls()
  }

  // ---- substitutions --------------------------------------------------------------------------

  public setPropertySubstitution(key: PropertyKey, method: SubstitutionMethod, values: readonly any[]): void {
    this._propertySubstitutions.set(key, new Substitution('get', key, undefined, method, values))
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
  public findCallSubstitution(key: PropertyKey, actualArguments: readonly unknown[]): Substitution | undefined {
    return this._callSubstitutions.get(key)?.match(actualArguments)
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

  /**
   * The auto-substitute for a call with these actual (literal) arguments. The same objects get the same
   * auto-substitute even when they were mutated in between (their structural fingerprint has gone stale then),
   * so that after `api.get(request).body.returns(1)` and `request.x = 1`, `api.get(request).body` is still 1 (D2).
   */
  public callEntry(key: PropertyKey, actualArguments: any[]): AutoEntry {
    let index = this._callEntries.get(key)
    if (index === undefined) {
      index = { byFingerprint: new Map(), byIdentity: new Map(), unfingerprinted: [] }
      this._callEntries.set(key, index)
    }
    const identity = identityFingerprintArguments(actualArguments)
    if (identity !== undefined) {
      const known = index.byIdentity.get(identity)
      if (known !== undefined && known.args!.matches(actualArguments)) return known
    }
    const entry = this.structuralCallEntry(index, key, actualArguments)
    if (identity !== undefined) index.byIdentity.set(identity, entry)
    return entry
  }

  private structuralCallEntry(index: CallEntryIndex, key: PropertyKey, actualArguments: any[]): AutoEntry {
    const fingerprint = fingerprintArguments(actualArguments)
    let bucket: AutoEntry[] | undefined
    if (fingerprint === undefined) bucket = index.unfingerprinted
    else {
      bucket = index.byFingerprint.get(fingerprint)
      if (bucket === undefined) {
        bucket = []
        index.byFingerprint.set(fingerprint, bucket)
      }
    }
    for (const entry of bucket) if (entry.args!.matches(actualArguments)) return entry
    const entry = new AutoEntry('call', this, key, RecordedArguments.from(actualArguments))
    bucket.push(entry)
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
    for (const index of this._callEntries.values()) {
      for (const bucket of index.byFingerprint.values()) yield* bucket
      yield* index.unfingerprinted
    }
    for (const list of this._specificationEntries.values()) yield* list
  }

  /** Configured substitutions, for printing. */
  public substitutions(): Substitution[] {
    const all: Substitution[] = [...this._propertySubstitutions.values()]
    for (const substitutions of this._callSubstitutions.values()) all.push(...substitutions.all())
    return all.sort((a, b) => a.order - b.order)
  }
}
