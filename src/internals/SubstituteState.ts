import { inspect } from 'util'

import { CallRecord, RecordKind, currentSequence } from './CallRecord'
import { StackHolder } from './CallSite'
import { RecordedArguments } from './RecordedArguments'
import { SELF, SubstitutionMethod, keyToString } from './Constants'
import { coarseHashArguments, hashArguments, identityHashArguments, lastHashWasApproximate, refinedHashArguments, withPrintGuard } from './utilities'

let substitutionOrder = 0

/**
 * The hashes of the actual arguments of one call (see ArgumentHash), computed when first needed and shared by the
 * lookups the call makes (the literal substitutions, then the auto-substitute cache).
 */
export class ArgumentHashes {
  private _structural?: number
  private _approximate = false
  private _refined?: number
  private _identity?: number | null
  private _coarse?: number

  constructor(public readonly args: readonly unknown[]) { }

  public get structural(): number {
    if (this._structural === undefined) {
      this._structural = hashArguments(this.args)
      this._approximate = lastHashWasApproximate()
    }
    return this._structural
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
    if (this._refined === undefined) this._refined = refinedHashArguments(this.args)
    return this._refined
  }

  /** Whether the candidates in a bucket of this hash with these arguments can be equal to these arguments. */
  public mayEqual(candidate: readonly unknown[] | undefined, candidates: number): boolean {
    return candidates < 2 || candidate === undefined || !this.approximate || refinedHashArguments(candidate) === this.refined
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

  /** E24: the path of this auto-substitute (`@Substitute.logger`, `@Substitute.getUser(1)`), without creating its state. */
  public get path(): string {
    const path = memberPath(this.parent, this.key)
    return this.kind === 'get' ? path : `${path}${pathArguments(this.argumentList)}`
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
}

type CallEntryIndex = {
  /** Every entry, by the structural hash of its arguments when it was created. */
  byHash: Buckets<AutoEntry>
  /** The entries handed out for arguments with objects, by their identity hash. */
  byIdentity?: Buckets<AutoEntry>
}

/**
 * The most recent substitution in `list` (kept in configuration order) that matches, if it is more recent than `best`.
 * `sameHash`: `list` holds the substitutions with the structural hash of the actual arguments (E13, see mayEqual).
 */
const mostRecentMatch = (list: readonly Substitution[], actual: ArgumentHashes, best: Substitution | undefined, sameHash: boolean): Substitution | undefined => {
  for (let index = list.length - 1; index >= 0; index--) {
    const candidate = list[index]
    if (best !== undefined && candidate.order < best.order) return best
    if ((!sameHash || actual.mayEqual(candidate.args!.value, list.length)) && candidate.args!.matches(actual.args)) return candidate
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
 */
class CallSubstitutions {
  /** In configuration order within each bucket. */
  private readonly _literal: Buckets<Substitution> = new Map()
  private readonly _byIdentity: Buckets<Substitution> = new Map()
  /** The coarse hashes of the literal substitutions (a replaced substitution has the coarse hash of its replacement). */
  private readonly _coarse = new Set<number>()
  /** The order of the most recent literal substitution. */
  private _latestLiteral = 0
  private readonly _withMatchers: Substitution[] = []
  private _size = 0

  public get size(): number {
    return this._size
  }

  /** Adds a substitution. One with the same specification is replaced (most recent wins). */
  public add(substitution: Substitution): void {
    const args = substitution.args!
    if (args.argumentsClass !== 'plain') {
      const index = this._withMatchers.findIndex(existing => existing.args!.equals(args))
      if (index !== -1) this._withMatchers.splice(index, 1)
      else this._size++
      this._withMatchers.push(substitution)
      return
    }
    const hashes = new ArgumentHashes(args.value!)
    const hash = hashes.structural
    const bucket = bucketItems(this._literal, hash)
    const replaced = bucket?.find(existing => hashes.mayEqual(existing.args!.value, bucket.length) && existing.args!.equals(args))
    if (replaced !== undefined) {
      bucketRemove(this._literal, hash, replaced)
      if (replaced.identity !== undefined) bucketRemove(this._byIdentity, replaced.identity, replaced)
    } else this._size++
    bucketAdd(this._literal, hash, substitution)
    this._coarse.add(coarseHashArguments(args.value!))
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
    const hashes = new ArgumentHashes(args.value!)
    const bucket = bucketItems(this._literal, hashes.structural)
    return bucket?.find(substitution => hashes.mayEqual(substitution.args!.value, bucket.length) && substitution.args!.equals(args))
  }

  /** The most specific class wins (all-literal, then predicates, then Arg.all()); within a class the most recent one. */
  public match(hashes: ArgumentHashes): Substitution | undefined {
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
        const literal = bucketItems(this._literal, hashes.structural)
        if (literal !== undefined) best = mostRecentMatch(literal, hashes, best, true)
      }
      if (best !== undefined) return best
    }

    const withMatchers = this._withMatchers
    for (let index = withMatchers.length - 1; index >= 0; index--) {
      const candidate = withMatchers[index]
      if (best !== undefined && candidate.rank >= best.rank) continue
      if (candidate.args!.matches(actualArguments)) best = candidate
    }
    return best
  }

  public *all(): IterableIterator<Substitution> {
    yield* allBucketItems(this._literal)
    yield* this._withMatchers
  }
}

const memberPath = (state: SubstituteState, key: PropertyKey): string =>
  key === SELF ? state.path : `${state.path}.${keyToString(key)}`

/**
 * The arguments of a call as a path shows them: `(1, { id: 1 })`, objects one level deep, substitutes by their paths
 * (printed under the print guard, so that a substitute among the arguments is never printed in full).
 */
export const pathArguments = (args: readonly unknown[] | undefined): string => {
  const values = args ?? []
  try {
    return `(${withPrintGuard(() => values.map(value => inspect(value, { depth: 0, colors: false, breakLength: Infinity })).join(', '))})`
  } catch {
    return '(...)'
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
    return this.owner === undefined ? '@Substitute' : this.owner.path
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
  public findCallSubstitution(key: PropertyKey, actualArguments: ArgumentHashes): Substitution | undefined {
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
   * The auto-substitute for a call with these actual (literal) arguments (D2), found in O(1) expected time by the
   * structural hash of the arguments (D35). The same objects get the same auto-substitute even when they were
   * mutated in between (the structural hash has gone stale then), so that after `api.get(request).body.returns(1)`
   * and `request.x = 1`, `api.get(request).body` is still 1: entries for arguments with objects are also found by
   * the identity of those objects, first.
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

    const hash = actual.structural
    const bucket = bucketItems(index.byHash, hash)
    let entry = bucket?.find(candidate => actual.mayEqual(candidate.argumentList, bucket.length) && candidate.matchesCall(actualArguments))
    if (entry === undefined) {
      entry = new AutoEntry('call', this, key, actualArguments)
      bucketAdd(index.byHash, hash, entry)
    }
    if (identity !== undefined) {
      if (index.byIdentity === undefined) index.byIdentity = new Map()
      bucketAdd(index.byIdentity, identity, entry)
    }
    return entry
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
