import { CallRecord, RecordKind, currentSequence } from './CallRecord'
import { StackHolder } from './CallSite'
import { RecordedArguments } from './RecordedArguments'
import { SELF, SubstitutionMethod, keyToString } from './Constants'
import { entryPath, rootLabel } from './Paths'
import {
  coarseHashArguments, hashArguments, identityHashArguments, lastHashContentUses, lastHashMetUnreadable, lastHashMetWide,
  lastHashShapeUses, lastHashWasApproximate, narrowHashArguments, newOperation, refinedHashArguments, stillWideIn
} from './utilities'
import { libraryGuard } from './utilities/Guard'
import { closeLook, openLook } from './utilities/Look'

export { pathArguments } from './Paths'

let substitutionOrder = 0

/** E123: how many times received calls were cleared, of any substitute (see SubstituteState.clearedAt): none, as a rule. */
let clears = 0
export const clearsSoFar = (): number => clears

/**
 * The hashes of the actual arguments of one call (see ArgumentHash), computed when first needed and shared by the
 * lookups the call makes (the literal substitutions, then the auto-substitute cache). They belong to one operation.
 *
 * E18: the structural hash may use what earlier operations found out about wide containers among the arguments, and
 * be stale when one of them changed since. Such a lookup that finds nothing looks again with the fresh hash before it
 * takes the call as unmatched, wherever a candidate could exist: one with the same narrow hash (see
 * ArgumentHash.narrowHashArguments, CallSubstitutions.match, SubstituteState.callEntry). The arguments of a setup
 * (`setup`) are hashed fresh to begin with, so that they are filed under their contents.
 */
export class ArgumentHashes {
  private readonly _operation = newOperation()
  private _structural?: number
  private _wide = false
  private _unreadable = false
  private _approximate = false
  /** The containers whose hashes, or whose being wide, the structural hash took from memos of earlier operations. */
  private _contentUses?: ReadonlySet<object>
  private _shapeUses?: ReadonlySet<object>
  private _memoBased?: boolean
  private _fresh?: number
  private _narrow?: number
  private _narrowWide = false
  private _refined?: number
  private _identity?: number | null
  private _coarse?: number

  /**
   * `_inherit` (E32): the operation of the call whose setup these arguments are, whose verdicts on values that cannot be
   * read hold for this one (see ArgumentHash), or 0.
   */
  constructor(public readonly args: readonly unknown[], private readonly _setup = false, private readonly _inherit = 0) { }

  /** The operation these hashes belong to (see ArgumentHash.newOperation). */
  public get operation(): number {
    return this._operation
  }

  /** E32: whether the structural hash, if it was computed, met a value that cannot be read (without computing it). */
  public get metUnreadable(): boolean {
    return this._structural !== undefined && this._unreadable
  }

  public get structural(): number {
    if (this._structural === undefined) {
      this._structural = hashArguments(this.args, this._operation, this._setup, this._inherit)
      this._unreadable = lastHashMetUnreadable()
      this._wide = lastHashMetWide()
      this._approximate = lastHashWasApproximate()
      this._contentUses = lastHashContentUses()
      this._shapeUses = lastHashShapeUses()
    }
    return this._structural
  }

  /**
   * E18: whether the structural hash may be stale: it used the hash of a container remembered by an earlier operation,
   * or took a container to be wide from such a memo while it no longer is.
   */
  public get memoBased(): boolean {
    void this.structural
    if (this._memoBased === undefined)
      this._memoBased = this._contentUses !== undefined || (this._shapeUses !== undefined && ![...this._shapeUses].every(stillWideIn(this._operation)))
    return this._memoBased
  }

  /** E18: the structural hash from what this operation finds out alone (the structural hash, unless memoBased). */
  public get fresh(): number {
    if (!this.memoBased) return this._structural!
    if (this._fresh === undefined) this._fresh = hashArguments(this.args, this._operation, true, this._inherit)
    return this._fresh
  }

  /** Whether the hash to file and look these arguments up under is known to be exact: not memoBased, or fresh. */
  public get exact(): boolean {
    return !this.memoBased || this._fresh !== undefined
  }

  /** The hash to file a new entry under: the fresh one if it is known, else the structural one. */
  public get best(): number {
    return this.exact ? this.fresh : this._structural!
  }

  /**
   * E18: whether the structural hash met a wide container among the arguments: only then can it use memos, or can a
   * call whose hash used memos be equal to these arguments.
   */
  public get wide(): boolean {
    void this.structural
    return this._wide
  }

  /** E18: the narrow hash of the arguments (see ArgumentHash.narrowHashArguments): exact, whatever memos there are. */
  public get narrow(): number {
    if (this._narrow === undefined) {
      this._narrow = narrowHashArguments(this.args, this._operation, this._inherit)
      this._narrowWide = lastHashMetWide()
    }
    return this._narrow
  }

  /** Whether the arguments hold a wide container now (as the narrow hash finds). */
  public get narrowWide(): boolean {
    void this.narrow
    return this._narrowWide
  }

  /**
   * E13: whether the structural hash is a family hash for a wide object among the arguments (see ArgumentHash), which
   * leaves out the keys outside the family. Several candidates with the same structural hash are then told apart by
   * their refined hashes before they are compared with live deep equality.
   */
  public get approximate(): boolean {
    void this.structural
    return this._approximate
  }

  public get refined(): number {
    if (!this.approximate) return this.structural
    if (this._refined === undefined) this._refined = refinedHashArguments(this.args, this._operation, this._setup, this._inherit)
    return this._refined
  }

  /** Whether the candidates in a bucket of this hash with these arguments can be equal to these arguments. */
  public mayEqual(candidate: readonly unknown[] | undefined, candidates: number): boolean {
    return candidates < 2 || candidate === undefined || !this.approximate || refinedHashArguments(candidate, this._operation) === this.refined
  }

  /** E9: primitives and functions only (see coarseHashArguments): free to compute. */
  public get coarse(): number {
    if (this._coarse === undefined) this._coarse = coarseHashArguments(this.args)
    return this._coarse
  }

  public get identity(): number | undefined {
    if (this._identity === undefined) this._identity = identityHashArguments(this.args) ?? null
    return this._identity ?? undefined
  }
}

/** A map from hashes to the items with that hash, which stores a single item without an array. */
type Buckets<T> = Map<number, T | T[]>

const bucketAdd = <T>(buckets: Buckets<T>, hash: number, item: T): void => {
  const bucket = buckets.get(hash)
  if (bucket === undefined) buckets.set(hash, item)
  else if (Array.isArray(bucket)) bucket.push(item)
  else buckets.set(hash, [bucket, item])
}

const bucketItems = <T>(buckets: Buckets<T>, hash: number): readonly T[] | undefined => {
  const bucket = buckets.get(hash)
  return bucket === undefined ? undefined : Array.isArray(bucket) ? bucket : [bucket]
}

const bucketRemove = <T>(buckets: Buckets<T>, hash: number, item: T): void => {
  const bucket = buckets.get(hash)
  if (bucket === item) buckets.delete(hash)
  else if (Array.isArray(bucket)) {
    const index = bucket.indexOf(item)
    if (index !== -1) bucket.splice(index, 1)
    if (bucket.length === 0) buckets.delete(hash)
  }
}

function* allBucketItems<T>(buckets: Buckets<T>): IterableIterator<T> {
  for (const bucket of buckets.values()) {
    if (Array.isArray(bucket)) yield* bucket
    else yield bucket
  }
}

/** A configured behaviour: `sub.add(1, Arg.any()).returns(3, 4)`, `sub.prop.throws(err)`, ... */
export class Substitution {
  private _next = 0
  public readonly order = ++substitutionOrder
  /** For a literal substitution whose arguments contain objects: their identity hash (see CallSubstitutions). */
  public identity?: number

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
    /** The arguments of a call entry: a specification, or (D30: wrapped only when needed) the actual arguments. */
    private _args?: RecordedArguments | readonly unknown[]
  ) { }

  public get args(): RecordedArguments | undefined {
    const args = this._args
    if (!Array.isArray(args)) return args as RecordedArguments | undefined
    const wrapped = RecordedArguments.from(args)
    this._args = wrapped
    return wrapped
  }

  /** The argument list of this call entry (the actual arguments, or the specification's). */
  public get argumentList(): readonly unknown[] | undefined {
    const args = this._args
    return Array.isArray(args) ? args : (args as RecordedArguments | undefined)?.value
  }

  /**
   * E81: whether this is the auto-substitute of a nested setup through a call with matchers (see specificationEntry),
   * which stands for every call matching it, rather than of one call or member.
   */
  public get specifiesMatchers(): boolean {
    const args = this._args
    if (args === undefined || Array.isArray(args)) return false
    const argumentsClass = (args as RecordedArguments).argumentsClass
    return argumentsClass === 'with-predicate' || argumentsClass === 'wildcard'
  }

  /** Whether the arguments of this call entry match a call with these actual arguments. */
  public matchesCall(actualArguments: readonly unknown[]): boolean {
    const args = this._args
    if (args === undefined) return false
    return Array.isArray(args) ? RecordedArguments.literalsEqual(args, actualArguments) : (args as RecordedArguments).matches(actualArguments)
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

type CallEntryIndex = {
  /** Every entry, by the structural hash of its arguments when it was created. */
  byHash: Buckets<AutoEntry>
  /** The entries handed out for arguments with objects, by their identity hash. */
  byIdentity?: Buckets<AutoEntry>
  /** E18: the coarse hashes of the entries for arguments with objects (see callEntry). */
  coarse?: Set<number>
  /** E18: per coarse hash, the entries that met a wide container or that were filed unchecked (see callEntry). */
  groups?: Map<number, CoarseGroup>
}

/** An entry filed under a hash that may be stale (it used memos of earlier operations), and that hash. */
type Unchecked = { entry: AutoEntry, hash: number }

/**
 * E18: the entries of one coarse hash that callEntry knows more about: the first one, if it was filed unchecked when
 * no other entry had the coarse hash, and the narrow hashes of those that met a wide container, each with the one that
 * was filed unchecked under it, if there is one.
 */
type CoarseGroup = { first?: Unchecked, byNarrow?: Map<number, Unchecked | null> }

/**
 * The entry in the bucket of `hash` whose arguments match the call. `sameHash`: the bucket is that of the call's
 * structural hash (E13, see mayEqual).
 */
const findEntry = (byHash: Buckets<AutoEntry>, hash: number, actual: ArgumentHashes, sameHash: boolean): AutoEntry | undefined => {
  const bucket = bucketItems(byHash, hash)
  if (bucket === undefined) return undefined
  return bucket.find(candidate => (!sameHash || actual.mayEqual(candidate.argumentList, bucket.length)) && candidate.matchesCall(actual.args))
}

/**
 * E18: files an entry that was filed unchecked under its fresh hash, and gives the fresh hashes of its arguments (for
 * their narrow hash).
 */
const refile = (byHash: Buckets<AutoEntry>, unchecked: Unchecked): ArgumentHashes => {
  const hashes = new ArgumentHashes(unchecked.entry.argumentList!, true)
  const current = hashes.structural
  if (current !== unchecked.hash) {
    bucketRemove(byHash, unchecked.hash, unchecked.entry)
    bucketAdd(byHash, current, unchecked.entry)
  }
  return hashes
}
/**
 * E81 (R13FE-3): whether a substitution answers calls. An 'auto' registration (the auto-substitute of a nested setup
 * through a call, `repo.find(Arg.any()).name.returns('x')`) answers only once something below it is configured: a read
 * or a check through a call with matchers (`repo.find(Arg.any()).name`, `repo.find(Arg.any()).items[received]()`)
 * registers the auto-substitute that a nested setup would configure, and it must not change what later calls answer.
 */
const answers = (substitution: Substitution): boolean =>
  substitution.method !== 'auto' || substitution.entry!.materializedState?.configured === true

/**
 * The most recent substitution in `list` (kept in configuration order) that matches, if it is more recent than `best`.
 * `sameHash`: `list` holds the substitutions with the structural hash of the actual arguments (E13, see mayEqual).
 */
const mostRecentMatch = (list: readonly Substitution[], actual: ArgumentHashes, best: Substitution | undefined, sameHash: boolean): Substitution | undefined => {
  for (let index = list.length - 1; index >= 0; index--) {
    const candidate = list[index]
    if (best !== undefined && candidate.order < best.order) return best
    if ((!sameHash || actual.mayEqual(candidate.args!.value, list.length)) && answers(candidate) && candidate.args!.matches(actual.args)) return candidate
  }
  return best
}

/**
 * The call substitutions configured for one member.
 *
 * All-literal substitutions (the most specific class, D4) are indexed by the structural hash of their arguments at
 * setup time (D35), which deep strictly equal argument lists share, so a call only compares (with live deep equality)
 * against the literal substitutions with the same hash: usually none or one, however many there are and whatever the
 * shape of the arguments. Those with objects among their arguments are also indexed by identity, so passing the same
 * objects again still matches after they were mutated (mutating an argument after the setup is otherwise not
 * supported, amended D15). Substitutions with Arg matchers are kept in a list.
 *
 * E9: a call computes the structural hash of its arguments only when a literal substitution could match it. The same
 * objects as a literal substitution's, found by identity, answer right away when no literal substitution is more
 * recent. And a call whose primitive arguments are those of no literal substitution (coarseHashArguments) cannot
 * match one. So a call with a large object as an argument costs the same as any other, whatever literal substitutions
 * there are with other arguments.
 *
 * E18: the literal substitutions are filed under the fresh hash of their arguments, and a call whose hash used a memo
 * of an earlier operation, and finds no literal substitution with it, looks again with its fresh hash when one has its
 * narrow hash, so that a wide object that changed after it was first hashed still matches a substitution for its
 * current contents.
 */
class CallSubstitutions {
  /** In configuration order within each bucket. */
  private readonly _literal: Buckets<Substitution> = new Map()
  private readonly _byIdentity: Buckets<Substitution> = new Map()
  /** The coarse hashes of the literal substitutions (a replaced substitution has the coarse hash of its replacement). */
  private readonly _coarse = new Set<number>()
  /** E18: the narrow hashes of the literal substitutions (likewise). */
  private readonly _narrow = new Set<number>()
  /** The order of the most recent literal substitution. */
  private _latestLiteral = 0
  private readonly _withMatchers: Substitution[] = []
  private _size = 0

  public get size(): number {
    return this._size
  }

  /**
   * Adds a substitution. One with the same specification is replaced (most recent wins). `inherit`: see
   * ArgumentHashes (E32).
   */
  public add(substitution: Substitution, inherit = 0): void {
    const args = substitution.args!
    if (args.argumentsClass !== 'plain') {
      const index = this._withMatchers.findIndex(existing => existing.args!.equals(args))
      if (index !== -1) this._withMatchers.splice(index, 1)
      else this._size++
      this._withMatchers.push(substitution)
      return
    }
    const hashes = new ArgumentHashes(args.value!, true, inherit)
    const hash = hashes.structural
    const bucket = bucketItems(this._literal, hash)
    const replaced = bucket?.find(existing => hashes.mayEqual(existing.args!.value, bucket.length) && existing.args!.equals(args))
    if (replaced !== undefined) {
      bucketRemove(this._literal, hash, replaced)
      if (replaced.identity !== undefined) bucketRemove(this._byIdentity, replaced.identity, replaced)
    } else this._size++
    bucketAdd(this._literal, hash, substitution)
    this._coarse.add(coarseHashArguments(args.value!))
    this._narrow.add(hashes.narrow)
    this._latestLiteral = substitution.order
    const identity = identityHashArguments(args.value!)
    if (identity !== undefined) {
      substitution.identity = identity
      bucketAdd(this._byIdentity, identity, substitution)
    }
  }

  /** The substitution configured with exactly this specification. */
  public withSpecification(args: RecordedArguments): Substitution | undefined {
    if (args.argumentsClass !== 'plain') return this._withMatchers.find(substitution => substitution.args!.equals(args))
    const hashes = new ArgumentHashes(args.value!, true)
    const bucket = bucketItems(this._literal, hashes.structural)
    return bucket?.find(substitution => hashes.mayEqual(substitution.args!.value, bucket.length) && substitution.args!.equals(args))
  }

  /**
   * The most specific class wins (all-literal, then predicates, then Arg.all()); within a class the most recent one.
   * `real`: for a real call of the code under test (E100, see Look).
   */
  public match(hashes: ArgumentHashes, real = false): Substitution | undefined {
    const actualArguments = hashes.args
    let best: Substitution | undefined
    if (this._literal.size > 0) {
      if (this._byIdentity.size > 0) {
        const identity = hashes.identity
        const sameObjects = identity === undefined ? undefined : bucketItems(this._byIdentity, identity)
        if (sameObjects !== undefined) best = mostRecentMatch(sameObjects, hashes, best, false)
        if (best !== undefined && best.order === this._latestLiteral) return best
      }
      if (this._coarse.has(hashes.coarse)) {
        const before = best
        const literal = bucketItems(this._literal, hashes.structural)
        if (literal !== undefined) best = mostRecentMatch(literal, hashes, best, true)
        // E18: no confirmed match with a hash that may be stale: look again with the fresh one, where one could match
        if (best === before && hashes.memoBased && this._narrow.has(hashes.narrow)) {
          const current = bucketItems(this._literal, hashes.fresh)
          if (current !== undefined) best = mostRecentMatch(current, hashes, best, false)
        }
      }
      if (best !== undefined) return best
    }

    const withMatchers = this._withMatchers
    if (withMatchers.length === 0) return best
    // E100 (R15-ADV-4): one guard for the matchers of the whole pass. A real call opens the look of its arguments (see
    // Look); anything else (a setup's registration, a matcher's look itself) looks with nothing recorded at all.
    const look = real && libraryGuard.matching === 0 ? openLook(actualArguments) : undefined
    if (look === undefined) libraryGuard.matching++
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
    yield* allBucketItems(this._literal)
    yield* this._withMatchers
  }
}

/** E18: notes a narrow hash in a coarse group (an unchecked entry there is kept). */
const noteNarrow = (group: CoarseGroup, narrow: number, unchecked: Unchecked | null): void => {
  const byNarrow = group.byNarrow ?? (group.byNarrow = new Map())
  if (unchecked !== null || !byNarrow.has(narrow)) byNarrow.set(narrow, unchecked)
}

/**
 * E18: files a new entry for arguments with objects in the coarse and narrow index of callEntry: unchecked, when its
 * hash may be stale (and the first of its coarse hash, or of its narrow hash, as callEntry looked for the others).
 */
const fileNew = (index: CallEntryIndex, actual: ArgumentHashes, entry: AutoEntry, hash: number): void => {
  const coarse = actual.coarse
  const known = index.coarse ?? (index.coarse = new Set())
  const firstOfCoarse = !known.has(coarse)
  if (firstOfCoarse) known.add(coarse)
  const stale = !actual.exact
  if (!stale && !actual.wide) return
  const groups = index.groups ?? (index.groups = new Map())
  let group = groups.get(coarse)
  if (group === undefined) {
    group = {}
    groups.set(coarse, group)
  }
  if (stale && firstOfCoarse) group.first = { entry, hash }
  else if (stale) noteNarrow(group, actual.narrow, { entry, hash })
  else noteNarrow(group, actual.narrow, null)
}

/**
 * E32: the arguments of the auto-substitute that the last call handed out, when hashing that call's arguments met a
 * value that cannot be read (a getter that throws), with the call's operation and sequence number. A setup of these
 * arguments right after the call, before anything else is recorded (`repository.save(user).returns(1)`), takes the
 * call's verdicts on such values as its own (see ArgumentHash), so that it does not read them again.
 */
let unreadableCall: { args: readonly unknown[], operation: number, sequence: number } | undefined

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
  private readonly _callEntries = new Map<PropertyKey, CallEntryIndex>()
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
    const call = unreadableCall
    const inherit = call !== undefined && call.args === args.value && call.sequence === currentSequence() ? call.operation : 0
    if (inherit !== 0) unreadableCall = undefined
    substitutions.add(substitution, inherit)
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
   * The auto-substitute for a call with these actual (literal) arguments (D2), found in O(1) expected time by the
   * structural hash of the arguments (D35). The same objects get the same auto-substitute even when they were
   * mutated in between (the structural hash has gone stale then), so that after `api.get(request).body.returns(1)`
   * and `request.x = 1`, `api.get(request).body` is still 1: entries for arguments with objects are also found by
   * the identity of those objects, first.
   *
   * E18: an entry is filed under the hash its call had, which may have used a memo of an earlier operation (a wide
   * object passed before). A call that finds no entry looks again, wherever an entry with its narrow hash exists
   * (exact without memos, see ArgumentHash.lastNarrowHash): with its fresh hash, when its own hash used a memo; and
   * it files the one entry of that narrow hash that was filed under a hash with memos without such a look (the first
   * of its narrow hash, as the later ones looked) under its fresh hash first. So the auto-substitute for a call is the
   * one it would be without memos, as long as the arguments of an entry do not change after its call.
   */
  public callEntry(key: PropertyKey, actual: ArgumentHashes): AutoEntry {
    const actualArguments = actual.args
    let index = this._callEntries.get(key)
    if (index === undefined) {
      index = { byHash: new Map() }
      this._callEntries.set(key, index)
    }
    const identity = actual.identity
    if (identity !== undefined && index.byIdentity !== undefined) {
      const known = bucketItems(index.byIdentity, identity)?.find(entry => entry.matchesCall(actualArguments))
      if (known !== undefined) return known
    }

    let hash = actual.best
    let entry = findEntry(index.byHash, hash, actual, !actual.memoBased)
    if (entry === undefined && identity !== undefined) entry = this.lookAgain(index, actual)
    if (entry === undefined) {
      hash = actual.best
      entry = new AutoEntry('call', this, key, actualArguments)
      bucketAdd(index.byHash, hash, entry)
      if (identity !== undefined) fileNew(index, actual, entry, hash)
    }
    if (identity !== undefined) {
      if (index.byIdentity === undefined) index.byIdentity = new Map()
      bucketAdd(index.byIdentity, identity, entry)
    }
    unreadableCall = actual.metUnreadable ? { args: entry.argumentList!, operation: actual.operation, sequence: currentSequence() } : undefined
    return entry
  }

  /**
   * E81: the auto-substitute that callEntry gives a call with these actual arguments, if it has been created: the one
   * that an unconfigured call with them answered. Looked up as callEntry does, without creating one.
   */
  public existingCallEntry(key: PropertyKey, actual: ArgumentHashes): AutoEntry | undefined {
    const index = this._callEntries.get(key)
    if (index === undefined) return undefined
    const identity = actual.identity
    if (identity !== undefined && index.byIdentity !== undefined) {
      const known = bucketItems(index.byIdentity, identity)?.find(entry => entry.matchesCall(actual.args))
      if (known !== undefined) return known
    }
    const entry = findEntry(index.byHash, actual.best, actual, !actual.memoBased)
    return entry !== undefined || identity === undefined ? entry : this.lookAgain(index, actual)
  }

  /**
   * E18: a call with objects among its arguments found no entry with its hash: where an entry could be equal to it, the
   * entry filed unchecked there is filed under its fresh hash, and the call looks again (with its fresh hash, when its
   * own hash may be stale). The coarse hash, which uses no memos, tells whether any entry has objects at the same
   * places, and the narrow hash (see ArgumentHash.narrowHashArguments) which entries with wide containers can be equal.
   */
  private lookAgain(index: CallEntryIndex, actual: ArgumentHashes): AutoEntry | undefined {
    const coarse = actual.coarse
    if (index.coarse === undefined || !index.coarse.has(coarse)) return undefined
    const stale = !actual.exact
    const group = index.groups?.get(coarse)
    let entry: AutoEntry | undefined
    if (group?.first !== undefined) {
      const first = group.first
      group.first = undefined
      const hashes = refile(index.byHash, first)
      if (hashes.wide) noteNarrow(group, hashes.narrow, null)
      if (!stale) entry = findEntry(index.byHash, actual.best, actual, false)
    }
    if (entry !== undefined || !stale) {
      if (entry === undefined && actual.wide) {
        const unchecked = group?.byNarrow?.get(actual.narrow)
        if (unchecked !== undefined && unchecked !== null) {
          refile(index.byHash, unchecked)
          group!.byNarrow!.set(actual.narrow, null)
          entry = findEntry(index.byHash, actual.best, actual, false)
        }
      }
      return entry
    }
    // a hash that may be stale: an equal entry is filed under the narrow hash of the arguments, if they hold a wide
    // container now, else (no wide container is left) it has none, and the fresh hash finds it
    if (actual.narrowWide) {
      const unchecked = group?.byNarrow?.get(actual.narrow)
      if (unchecked === undefined) return undefined
      if (unchecked !== null) {
        refile(index.byHash, unchecked)
        group!.byNarrow!.set(actual.narrow, null)
      }
    }
    return findEntry(index.byHash, actual.fresh, actual, false)
  }

  /** The auto-substitute for a call specification used in a nested setup (`a(Arg.any()).b.returns(1)`). */
  public specificationEntry(key: PropertyKey, specification: RecordedArguments): AutoEntry {
    if (specification.argumentsClass === 'plain') return this.callEntry(key, new ArgumentHashes(specification.value!, true))
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
    for (const index of this._callEntries.values()) yield* allBucketItems(index.byHash)
    for (const list of this._specificationEntries.values()) yield* list
  }

  /** Configured substitutions, for printing. */
  public substitutions(): Substitution[] {
    const all: Substitution[] = [...this._propertySubstitutions.values()]
    for (const substitutions of this._callSubstitutions.values()) all.push(...substitutions.all())
    return all.sort((a, b) => a.order - b.order)
  }
}
