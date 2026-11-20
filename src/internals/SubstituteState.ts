import { CallRecord, RecordKind, currentSequence } from './CallRecord'
import { StackHolder } from './CallSite'
import { RecordedArguments } from './RecordedArguments'
import { SELF, SubstitutionMethod, keyToString } from './Constants'
import { entryPath, rootLabel } from './Paths'
import { libraryGuard } from './utilities/Guard'
import { closeLook, openLook } from './utilities/Look'

export { pathArguments } from './Paths'

let substitutionOrder = 0

/** E123: how many times received calls were cleared, of any substitute (see SubstituteState.clearedAt): none, as a rule. */
let clears = 0
export const clearsSoFar = (): number => clears

/** The actual arguments of one call, as the engine hands them to the lookups below. */
export class ArgumentHashes {
  constructor(public readonly args: readonly unknown[]) { }
}

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
  // D30: the state (records, configuration, nested auto-substitutes) is only allocated when it is needed
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

  /** E110, E122: the configured hand-outs of this entry's proxy in the latest expression (see HandOutNotes). (Left undeclared until one.) */
  private _configuredHandOut?: HandOutNotes

  /** E110, E122: notes a configured hand-out of this entry's proxy (see HandOutNotes). */
  public noteConfiguredHandOut(record: CallRecord, from: SubstituteState, shared: boolean): void {
    this._configuredHandOut = configuredHandOutNoted(this._configuredHandOut, record, from, shared)
  }

  /** E110, E122: the configured hand-out of this entry's proxy that `record` made, if it is one of the latest expression. */
  public configuredHandOut(record: CallRecord): ConfiguredHandOut | undefined {
    return configuredHandOutOf(this._configuredHandOut, record)
  }

  /** E122: whether `record` continues the expression of the latest configured hand-out of this entry's proxy. */
  public continuesConfiguredHandOut(record: CallRecord): boolean {
    return continuesNotes(this._configuredHandOut, record)
  }
}

/**
 * E110 (R16V-2, the docs agent's E99 retention): a substitute that the operation of `record` answered as a configured
 * value (a setup's value, a mimicked instance's value, also the substitute itself when a setup with matchers shares it):
 * the substitute that answered (`from`, the one `record` belongs to), and whether that answer is shared (E99: a setup
 * with matchers, or the mimicked instance, gives it every call that it matches). Kept on the substitute handed out, so
 * that a check through it finds where its expression came from (the engine's concreteRoute), with nothing kept per call:
 * a record noted otherwise (E99 kept a note per call) is reachable from outside its substitute (from the substitute it
 * handed out, and from the records chained to it), and would keep that substitute alive.
 */
export type ConfiguredHandOut = {
  record: CallRecord, from: SubstituteState, shared: boolean,
  /**
   * E122, E126: whether this hand-out was noted as continuing the expression of the note before it while the link of its
   * record to that note's record, a hand-out of the substitute itself, was not decided yet (see configuredHandOutNoted).
   */
  pending: boolean
}

/**
 * E122 (R17-ADV-1, R17-ADV-2): the configured hand-outs of a substitute in the latest expression that handed it out, in
 * the order they were made: one note as a rule, an array when the expression handed the substitute out again (a
 * self-returning builder, `db('orders').where('id', 1).where(...)`, or a cycle, `io.to('b').back(1).to('a')`), so that a
 * check through it follows the route step by step past each of them. A hand-out that does not continue the expression
 * of the latest one (its record is not chained to that one's) starts over: what is kept is bounded by the latest
 * expression, and keeps nothing alive once another expression hands the substitute out.
 */
export type HandOutNotes = ConfiguredHandOut | ConfiguredHandOut[]

/** E122: at most this many hand-outs of one substitute are kept for one expression (the oldest go first). */
const MAX_HAND_OUT_NOTES = 1000

/**
 * E122: whether `record` continues the expression of `latest` (an earlier record): `latest` is among the records it is
 * chained to (CallRecord.chainPrevious). The records of an expression are made one after the other, so the search stops
 * at the first older record, after at most MAX_HAND_OUT_NOTES steps.
 */
const continuesHandOut = (latest: CallRecord, record: CallRecord): boolean => {
  const seq = latest.seq
  let previous = record.chainPrevious
  for (let steps = 0; previous !== undefined && steps < MAX_HAND_OUT_NOTES; steps++) {
    if (previous === latest) return true
    if (previous.seq < seq) return false
    previous = previous.chainPrevious
  }
  return false
}

/**
 * E110, E122: `notes` (those a substitute had, if any) updated for a new configured hand-out (see HandOutNotes).
 * E126: a hand-out by an operation whose link to the latest note's record, a hand-out of the substitute itself (a fluent
 * step, `emitter.on('a', f).on('b', f)`), is not decided yet (see CallRecord.linkPendsTo) is noted as continuing that
 * expression for now. Whether it does is decided only when the notes are read (see settledNotes), from where both
 * operations are, so that the calls of a fluent method read no stack frames until a check follows them.
 */
const configuredHandOutNoted = (
  notes: HandOutNotes | undefined, record: CallRecord, from: SubstituteState, shared: boolean
): HandOutNotes => {
  if (notes === undefined) return { record, from, shared, pending: false }
  if (Array.isArray(notes)) {
    const latest = notes[notes.length - 1].record
    const pending = record.linkPendsTo(latest)
    if (pending || continuesHandOut(latest, record)) {
      if (notes.length >= MAX_HAND_OUT_NOTES) notes.shift()
      notes.push({ record, from, shared, pending })
      return notes
    }
    notes = notes[0]
  } else if (record.linkPendsTo(notes.record)) return [notes, { record, from, shared, pending: true }]
  else if (record.chainPrevious !== undefined && continuesHandOut(notes.record, record)) return [notes, { record, from, shared, pending: false }]
  // (another expression: the note is reused, E110)
  notes.record = record
  notes.from = from
  notes.shared = shared
  notes.pending = false
  return notes
}

/**
 * E122, E126: `notes` with the pending notes decided (see configuredHandOutNoted): the latest one that does not continue
 * the expression of the note before it started another expression, so the notes before it are dropped, as they would
 * have been when it was noted.
 */
const settledNotes = (notes: ConfiguredHandOut[]): ConfiguredHandOut[] => {
  for (let index = notes.length - 1; index > 0; index--) {
    const note = notes[index]
    if (!note.pending) continue
    note.pending = false
    if (note.record.chainPrevious !== notes[index - 1].record) {
      notes.splice(0, index)
      break
    }
  }
  return notes
}

/** E122: whether `record` continues the expression of the latest of `notes` (see continuesHandOut). */
const continuesNotes = (notes: HandOutNotes | undefined, record: CallRecord): boolean =>
  notes !== undefined && record.chainPrevious !== undefined &&
  continuesHandOut(Array.isArray(notes) ? notes[notes.length - 1].record : notes.record, record)

/** E110, E122: the note of `notes` for the hand-out that `record` made, if there is one (the latest first). */
const configuredHandOutOf = (notes: HandOutNotes | undefined, record: CallRecord): ConfiguredHandOut | undefined => {
  if (notes === undefined) return undefined
  if (!Array.isArray(notes)) return notes.record === record ? notes : undefined
  notes = settledNotes(notes)
  for (let index = notes.length - 1; index >= 0; index--) if (notes[index].record === record) return notes[index]
  return undefined
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
  public match(hashes: ArgumentHashes, real = false): Substitution | undefined {
    const actualArguments = hashes.args
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

/** E88: several received calls of one member, one after the other in its records, that the same answer answered. */
const NO_RECORDS: readonly CallRecord[] = Object.freeze([])

class AnswerRun {
  constructor(public readonly first: CallRecord, public last: CallRecord) { }
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
  /**
   * E81, E88: what the received calls answered with a configured value (see noteConfiguredAnswer), as pairs of an answer
   * and the calls it answered (a record, or an AnswerRun of records that follow each other in the records of their
   * member), and per member where the pair of its latest answer is.
   */
  private _configuredAnswers?: unknown[]
  private _latestAnswers?: Map<PropertyKey, number>

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

  /** E110, E122: the configured hand-outs of this substitute in the latest expression (see HandOutNotes). (Left undeclared until one.) */
  private _configuredHandOut?: HandOutNotes

  /** E110, E122: notes a configured hand-out of this substitute (see HandOutNotes). */
  public noteConfiguredHandOut(record: CallRecord, from: SubstituteState, shared: boolean): void {
    this._configuredHandOut = configuredHandOutNoted(this._configuredHandOut, record, from, shared)
  }

  /** E110, E122: the configured hand-out of this substitute that `record` made, if it is one of the latest expression. */
  public configuredHandOut(record: CallRecord): ConfiguredHandOut | undefined {
    return configuredHandOutOf(this._configuredHandOut, record)
  }

  /** E122: whether `record` continues the expression of the latest configured hand-out of this substitute. */
  public continuesConfiguredHandOut(record: CallRecord): boolean {
    return continuesNotes(this._configuredHandOut, record)
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
   * instance. O(1): a setup notes its key here and in every substitute above it (noteSetup).
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
   * unconfigured call answers the auto-substitute of its arguments, which is found again from them (existingCallEntry), so
   * it is not noted.
   *
   * E88: calls of a member that follow each other in its records and are answered alike (`logger.log(i)` in a loop with
   * `log(Arg.any()).returns(undefined)`, a fluent loop) are kept as one run, which grows with each call: noting costs no
   * memory per call then. A call that does not follow the run (another call or read of the member came in between)
   * starts a new one.
   */
  public noteConfiguredAnswer(record: CallRecord, answer: ConfiguredAnswer): void {
    const key = record.key
    // the run noted last goes on when the call comes right after its last call among all the records (a loop)
    const top = this._configuredAnswers
    if (top !== undefined && top[top.length - 2] === answer) {
      const records = this._records
      const length = records.length
      const run = top[top.length - 1] as CallRecord | AnswerRun
      const last = run instanceof AnswerRun ? run.last : run
      if (last === record) return // (noted already)
      if (length > 1 && records[length - 1] === record && records[length - 2] === last && last.key === key) {
        if (run instanceof AnswerRun) run.last = record
        else top[top.length - 1] = new AnswerRun(run, record)
        return
      }
    }
    const answers = top ?? (this._configuredAnswers = [])
    const latest = this._latestAnswers ?? (this._latestAnswers = new Map())
    const at = latest.get(key)
    if (at !== undefined && answers[at] === answer) {
      const records = this._recordsByKey.get(key)
      const length = records === undefined ? 0 : records.length
      const run = answers[at + 1] as CallRecord | AnswerRun
      const last = run instanceof AnswerRun ? run.last : run
      if (last === record) return // (noted already)
      if (length > 1 && records![length - 1] === record && records![length - 2] === last) {
        if (run instanceof AnswerRun) run.last = record
        else answers[at + 1] = new AnswerRun(run, record)
        return
      }
    }
    latest.set(key, answers.length)
    answers.push(answer, record)
  }

  /** E81: what the received calls of one member answered, for those noted by noteConfiguredAnswer. */
  public configuredAnswers(key: PropertyKey): Map<CallRecord, ConfiguredAnswer> | undefined {
    const answers = this._configuredAnswers
    const records = this._recordsByKey.get(key)
    if (answers === undefined || records === undefined) return undefined
    // where the runs of the member start (a call noted again starts a run of its own, which takes its place)
    const starts = new Map<CallRecord, number>()
    for (let index = 0; index < answers.length; index += 2) {
      const run = answers[index + 1] as CallRecord | AnswerRun
      const first = run instanceof AnswerRun ? run.first : run
      if (first.key === key) starts.set(first, index)
    }
    if (starts.size === 0) return undefined
    const byRecord = new Map<CallRecord, ConfiguredAnswer>()
    let answer: ConfiguredAnswer | undefined
    let last: CallRecord | undefined
    for (const record of records) {
      const start = starts.get(record)
      if (start !== undefined) {
        answer = answers[start] as ConfiguredAnswer
        const run = answers[start + 1] as CallRecord | AnswerRun
        last = run instanceof AnswerRun ? run.last : run
      }
      if (answer === undefined) continue
      byRecord.set(record, answer)
      if (record === last) answer = last = undefined
    }
    return byRecord
  }

  /**
   * E110 (R16V-2): what the received calls of one member answered, as configuredAnswers gives it, by position in
   * receivedRecordsOf(key) (undefined where a record is not noted), without building a map: a check through a call goes
   * through every received call of the member.
   */
  public configuredAnswersByPosition(key: PropertyKey): (ConfiguredAnswer | undefined)[] | undefined {
    const answers = this._configuredAnswers
    const records = this._recordsByKey.get(key)
    if (answers === undefined || records === undefined) return undefined
    const starts = new Map<CallRecord, number>()
    for (let index = 0; index < answers.length; index += 2) {
      const run = answers[index + 1] as CallRecord | AnswerRun
      const first = run instanceof AnswerRun ? run.first : run
      if (first.key === key) starts.set(first, index)
    }
    if (starts.size === 0) return undefined
    const byPosition: (ConfiguredAnswer | undefined)[] = new Array(records.length)
    let answer: ConfiguredAnswer | undefined
    let last: CallRecord | undefined
    for (let position = 0; position < records.length; position++) {
      const record = records[position]
      const start = starts.get(record)
      if (start !== undefined) {
        answer = answers[start] as ConfiguredAnswer
        const run = answers[start + 1] as CallRecord | AnswerRun
        last = run instanceof AnswerRun ? run.last : run
      }
      byPosition[position] = answer
      if (record === last) answer = last = undefined
    }
    return byPosition
  }

  /** E110: the records of one member, retracted ones included (see configuredAnswersByPosition). */
  public receivedRecordsOf(key: PropertyKey): readonly CallRecord[] {
    return this._recordsByKey.get(key) ?? NO_RECORDS
  }

  /**
   * E110 (R16V-2): forgets a retracted record that a check went through (the engine's concreteRoute, for a check through a
   * concrete call whose answer a setup with matchers shares), when it is the latest record of its member, as the leading
   * call of a check is: so that the records and answers of the member that later checks look at are those of real calls,
   * and a check costs the same however many came before it. Otherwise it stays (retracted records are never counted or
   * shown).
   */
  public dropRetracted(record: CallRecord): void {
    const forKey = this._recordsByKey.get(record.key)
    if (!record.retracted || forKey === undefined || forKey[forKey.length - 1] !== record) return
    const previous = forKey.length > 1 ? forKey[forKey.length - 2] : undefined
    // what it answered: noted in the latest pair of its member, alone or as the end of a run (see noteConfiguredAnswer)
    const answers = this._configuredAnswers
    const at = this._latestAnswers?.get(record.key)
    if (answers !== undefined && at !== undefined) {
      const run = answers[at + 1] as CallRecord | AnswerRun
      if (run === record) {
        // (a pair that is not the latest of all stays: it matches no record any more)
        if (at === answers.length - 2) {
          answers.length = at
          this._latestAnswers!.delete(record.key)
        }
      } else if (run instanceof AnswerRun && run.last === record && previous !== undefined) {
        if (run.first === previous) answers[at + 1] = previous
        else run.last = previous
      }
    }
    forKey.pop()
    const records = this._records
    if (records[records.length - 1] === record) records.pop()
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
   * received before (see the engine's followRoute). (Left undeclared until a clear.)
   */
  private _clearedAt?: number

  public get clearedAt(): number {
    return this._clearedAt ?? 0
  }

  /** Clears the received calls of this substitute and of its auto-substitutes (E35: without recursion). */
  public clearReceivedCalls(): void {
    const pending: SubstituteState[] = [this]
    const clearedAt = currentSequence()
    clears++
    while (pending.length > 0) {
      const state = pending.pop()!
      state._records.length = 0
      state._recordsByKey.clear()
      state._pendingReads.clear()
      state._clearedAt = clearedAt
      if (state._configuredAnswers !== undefined) state._configuredAnswers = state._latestAnswers = undefined
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
  public findCallSubstitution(key: PropertyKey, actualArguments: ArgumentHashes, real = false): Substitution | undefined {
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
  public callEntry(key: PropertyKey, actual: ArgumentHashes): AutoEntry {
    let list = this._callEntries.get(key)
    if (list === undefined) {
      list = []
      this._callEntries.set(key, list)
    }
    let entry = list.find(candidate => candidate.matchesCall(actual.args))
    if (entry === undefined) {
      entry = new AutoEntry('call', this, key, RecordedArguments.from(actual.args as any[]))
      list.push(entry)
    }
    return entry
  }

  /**
   * E81: the auto-substitute that callEntry gives a call with these actual arguments, if it has been created: the one
   * that an unconfigured call with them answered.
   */
  public existingCallEntry(key: PropertyKey, actual: ArgumentHashes): AutoEntry | undefined {
    return this._callEntries.get(key)?.find(candidate => candidate.matchesCall(actual.args))
  }

  /** The auto-substitute for a call specification used in a nested setup (`a(Arg.any()).b.returns(1)`). */
  public specificationEntry(key: PropertyKey, specification: RecordedArguments): AutoEntry {
    if (specification.argumentsClass === 'plain') return this.callEntry(key, new ArgumentHashes(specification.value!))
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
