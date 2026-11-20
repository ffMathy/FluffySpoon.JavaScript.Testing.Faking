import { inspect, InspectOptions, isDeepStrictEqual, types } from 'util'
// (from the module itself rather than '../shared', whose re-exports are getters in CommonJS output: the matcher search
// runs on the arguments of every call, and a getter per lookup cost more than E75's own check)
import {
  MatcherKind, argumentKindOf, argumentsAreEquivalent, evaluateMatcher, evaluateMatcherInLook, foreignMatcherKind, foreignMatcherOf, isAllArguments,
  isArgMatcher, isArgumentMatcher, matcherFactoryOf, matcherKindOf
} from '../shared/Arguments'
import { SubstituteException } from './SubstituteException'
import { FAMILY_KEYS, forgetListings, hashSettings, isInFamily, noteListing } from './utilities/ArgumentHash'
import { noteMatcherHolder } from './utilities/Stringify'
import { libraryGuard } from './utilities/Guard'
import { CLEAR_ARGUMENTS } from './utilities/Look'

type ArgumentsClass = 'plain' | 'with-predicate' | 'wildcard'
const argumentsClassDigitMapper: Record<ArgumentsClass | 'none', number> = {
  plain: 0,
  'with-predicate': 1,
  wildcard: 2,
  none: 4
}

export type ArgumentsMatch = {
  matches: boolean
  /** The error thrown by an Arg.is predicate, if the match failed because a predicate threw. */
  predicateError?: unknown
  predicateThrew: boolean
}

const MATCH: ArgumentsMatch = { matches: true, predicateThrew: false }
const NO_MATCH: ArgumentsMatch = { matches: false, predicateThrew: false }

/**
 * E57: whether the library is comparing arguments with util.isDeepStrictEqual. Reads that reach a substitute through an
 * object that inherits from it are then the runtime's probes (Node.js 20 looks for KeyObjects and URLs), which record
 * nothing (see the get trap in Engine). E63: in any copy of the package (see Guard).
 */
export const isComparing = (): boolean => libraryGuard.comparing > 0

const literalEquals = (expected: unknown, actual: unknown): boolean => {
  if (expected === actual) return expected !== 0 || Object.is(expected, actual)
  libraryGuard.comparing++
  try {
    return isDeepStrictEqual(expected, actual)
  } catch {
    return false
  } finally {
    libraryGuard.comparing--
  }
}

// ---- D27: matchers nested in plain objects and arrays ------------------------------------------

/**
 * What a value is to the search for matchers: the kind of matcher of an expected argument (an Arg matcher, or E75 a
 * matcher of a test runner), 'plain' for a plain container (an array, or an object whose prototype is Object.prototype
 * or null: the only values that may hold nested matchers, D27), or undefined for anything else. E75: with one look at
 * the value (one read of the matcher brand, its prototype, and one own-property check for the test runners' matchers,
 * two for an object that is not plain), wherever matchers are looked for.
 */
type Look = MatcherKind | 'plain' | undefined

const lookAt = (value: unknown): Look => {
  if (typeof value !== 'object' || value === null) return undefined
  const brand = argumentKindOf(value)
  if (brand !== undefined) return brand
  let plain: boolean
  try {
    if (Array.isArray(value)) return 'plain'
    const prototype = Object.getPrototypeOf(value)
    plain = prototype === Object.prototype || prototype === null
  } catch {
    return undefined // a revoked proxy
  }
  return foreignMatcherKind(value, plain) ?? (plain ? 'plain' : undefined)
}

/** Arrays, and objects whose prototype is Object.prototype or null, that are not matchers (see lookAt). */
const isPlainContainer = (value: unknown): value is object => lookAt(value) === 'plain'

/** The own enumerable string and symbol keys of a plain object (the keys deep strict equality compares). */
const ownEnumerableKeys = (object: object): PropertyKey[] => {
  const keys: PropertyKey[] = Object.keys(object)
  for (const symbol of Object.getOwnPropertySymbols(object))
    if (Object.prototype.propertyIsEnumerable.call(object, symbol)) keys.push(symbol)
  return keys
}

/** The values inside a plain container, with the position each one is at. */
const containerEntries = (container: object): Array<[PropertyKey, unknown]> => Array.isArray(container)
  ? Array.from({ length: container.length }, (_, index): [PropertyKey, unknown] => [index, container[index]])
  : ownEnumerableKeys(container).map((key): [PropertyKey, unknown] => [key, (container as any)[key]])

// Annex B, in every supported runtime; captured when the library is loaded
const lookupGetter: (this: object, key: PropertyKey) => Function | undefined = (Object.prototype as any).__lookupGetter__

/**
 * The value of an own property of an object (keys come from listing its own keys); getters are not run (a matcher behind
 * a getter is not looked for), and neither are the get traps of a proxy (`proxy`: the object is one). E29: without
 * creating a property descriptor for every key of an ordinary object, which made the search allocate more than anything
 * else for arrays of records.
 */
const dataValue = (object: object, key: PropertyKey, proxy: boolean): unknown => {
  if (proxy) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  }
  return lookupGetter.call(object, key) === undefined ? (object as any)[key] : undefined
}

/*
 * E3, E9: the search for nested matchers runs on the arguments of every call, so its cost is bounded like the
 * structural hash's (see ArgumentHash): each argument has a budget of SCAN_BUDGET containers, a container shares the
 * rest of its budget evenly among its items, and containers without a share, nested more than MAX_SCAN_DEPTH levels
 * deep (so cycles end), or with more than MAX_SCANNED_ITEMS items or keys are not searched. Each container is searched
 * once per argument however often it is referenced, and an argument looks at SCAN_ITEMS items and keys in all at most.
 * Matchers beyond these bounds are not recognised, and the value is compared literally. Items without a share are still
 * checked for being a matcher themselves.
 * The keys of an object can only be counted by listing them all, which is slow for a wide one (a millisecond for
 * 10,000 keys), so an object found too wide once is remembered (weakly) and never listed again: an object shared by
 * many calls, such as a lookup table, costs nothing after its first call. E13: so is a container with more than
 * REMEMBERED_ITEMS items or keys that was searched in full (no bound left out anything inside it) and holds no matcher.
 * Mutating an argument after it was passed is not supported (amended D15/D35): a matcher put into such a container
 * later is not seen.
 */
const SCAN_BUDGET = 1024
const MAX_SCAN_DEPTH = 32
const MAX_SCANNED_ITEMS = FAMILY_KEYS - 1 // 1024
const SCAN_ITEMS = 32768
const REMEMBERED_ITEMS = 256

/** Containers that are never searched again: too wide to be searched, or wide and searched in full without a matcher. */
const notSearched = new WeakSet<object>()

/** Whether a container is remembered as one that is never searched again (none are with the memos off, see hashSettings). */
const isNotSearched = (container: object): boolean => hashSettings.memos && notSearched.has(container)

/**
 * E109: those of them that hold no substitute either (see clearArgumentsOf): too wide to be searched, or searched in
 * full with nothing in them but primitive values, plain objects and arrays; with the items and keys listed in them.
 */
const clearSearched = new WeakMap<object, number>()

/** E109: notes, for a container that is not searched again, whether it holds no substitute (see Search). */
const metNotSearched = (container: object, search: Search): void => {
  const listed = clearSearched.get(container)
  if (listed === undefined) search.opaque++
  else search.remembered += listed
}

/**
 * One search: the argument, the containers searched so far (created once a nested one is reached; true for those
 * searched in full), the items left, and how often a bound left something out (`cuts`: then the containers around it
 * are not remembered as searched). E109: `opaque`, how many values it met that may be or hold a substitute without its
 * looking into them (see clearArgumentsOf), and `remembered`, the items and keys listed in the containers that it met
 * without searching them again and that hold no substitute.
 */
type Search = { root: object, visited: Map<object, boolean> | undefined, items: number, cuts: number, opaque: number, remembered: number }

/** E109: how many items and keys a search has listed so far, also in the containers that it did not search again. */
const listedBy = (search: Search): number => SCAN_ITEMS - search.items + search.remembered

/** `probe`: whether a container may be looked up in the families (see ArgumentHash.hashKeyed): not an array item. */
const holdsMatcherItem = (item: unknown, budget: number, depth: number, search: Search, probe: boolean): boolean => {
  const look = lookAt(item)
  if (look !== 'plain') {
    // E109: a function, or an object that is not plain (a class instance, a Map, a Date, ...), is not searched
    if (look === undefined && (typeof item === 'function' || (typeof item === 'object' && item !== null))) search.opaque++
    return look !== undefined
  }
  if (budget > 0 && depth < MAX_SCAN_DEPTH) return holdsMatcher(item as object, budget, depth + 1, search, probe)
  // E20: only a plain container is ever searched, so only one is left out (a Date or a class instance is not)
  search.cuts++
  return false
}

/** Whether a plain container holds a matcher (see above). It runs no getters of the code under test's objects. */
const holdsMatcher = (container: object, budget: number, depth: number, search: Search, probe: boolean): boolean => {
  if (isNotSearched(container)) {
    metNotSearched(container, search)
    return false
  }
  const cuts = search.cuts
  if (depth > 0) {
    const visited = search.visited ?? (search.visited = new Map([[search.root, false]]))
    const searched = visited.get(container)
    if (searched !== undefined) {
      // searched already (without a matcher), or being searched further up: left out unless it was searched in full
      if (!searched) search.cuts++
      return false
    }
    visited.set(container, false)
  }
  const found = holdsMatcherInside(container, budget, depth, search, probe)
  if (!found && depth > 0 && search.cuts === cuts) search.visited!.set(container, true)
  return found
}

/**
 * E93 (R14V-1): a container whose keys or items cannot be read (a proxy whose ownKeys or getOwnPropertyDescriptor trap
 * throws) holds no matcher, and the search goes on with the items next to it: such a value is compared like the other
 * values that cannot be read, by identity (E14/E83), also next to a matcher (`{ entity, id: Arg.any() }`).
 */
const holdsMatcherInside = (container: object, budget: number, depth: number, search: Search, probe: boolean): boolean => {
  try {
    return searchInside(container, budget, depth, search, probe)
  } catch {
    // (left out: the containers around it are not remembered as searched in full)
    search.cuts++
    return false
  }
}

const searchInside = (container: object, budget: number, depth: number, search: Search, probe: boolean): boolean => {
  const cuts = search.cuts
  // E109: what this container's search finds out about substitutes (see rememberSearched)
  const opaque = search.opaque
  const listed = listedBy(search)
  // E109: a proxy may answer otherwise later
  const proxy = types.isProxy(container)
  if (proxy) search.opaque++
  if (Array.isArray(container)) {
    // E109: an array with a prototype of its own (a subclass, or one that inherits from a substitute) is not plain to
    // the look of a matcher (see Look)
    if (Object.getPrototypeOf(container) !== Array.prototype) search.opaque++
    const length = container.length
    if (length > MAX_SCANNED_ITEMS) return false
    if (length > search.items) {
      search.cuts++
      return false
    }
    search.items -= length
    const share = Math.floor((budget - 1) / length)
    for (let index = 0; index < length; index++) if (holdsMatcherItem(container[index], share, depth, search, false)) return true
    if (length > REMEMBERED_ITEMS) rememberSearched(container, search.cuts === cuts, search.opaque === opaque, listedBy(search) - listed)
    return false
  }
  // E13: an object of a family (see ArgumentHash) has more keys than are searched: no need to list them
  if (probe && isInFamily(container)) {
    if (hashSettings.memos) notSearched.add(container)
    search.opaque++
    return false
  }
  const keys = Object.keys(container)
  const symbols = Object.getOwnPropertySymbols(container)
  const count = keys.length + symbols.length
  if (count > MAX_SCANNED_ITEMS) {
    if (hashSettings.memos) {
      notSearched.add(container)
      // E109: the look of a matcher does not list it either
      if (search.opaque === opaque) clearSearched.set(container, 0)
    }
    // E13: the hash, which comes next, takes the keys from here
    noteListing(container, symbols.length === 0 ? keys : [...keys, ...symbols.filter(symbol => Object.prototype.propertyIsEnumerable.call(container, symbol))])
    return false
  }
  if (count > search.items) {
    search.cuts++
    return false
  }
  search.items -= count
  const share = Math.floor((budget - 1) / count)
  for (let index = 0; index < keys.length; index++) if (holdsMatcherItem(dataValue(container, keys[index], proxy), share, depth, search, true)) return true
  for (let index = 0; index < symbols.length; index++) {
    const symbol = symbols[index]
    if (Object.prototype.propertyIsEnumerable.call(container, symbol) && holdsMatcherItem(dataValue(container, symbol, proxy), share, depth, search, true)) return true
  }
  if (count > REMEMBERED_ITEMS) rememberSearched(container, search.cuts === cuts, search.opaque === opaque, listedBy(search) - listed)
  return false
}

/**
 * Wide containers whose search left something out: false once one was seen (searched within its bounds), true once
 * it cannot be shown to hold no matcher anywhere (see below).
 */
const partlySearched = new WeakMap<object, boolean>()

/**
 * Remembers a wide container that holds no matcher within the bounds of its search. When the bounds left something
 * out (a record's nested object without a share of the budget) and the container is seen a second time, it is
 * searched once more, without budgets (see holdsNoMatcherAtAll), so that a shared table of records is searched in full
 * once instead of in part on every call. E20: a container that is only passed once (a fresh batch of records for
 * every call) is not searched again. E109: `clear` when the search found only primitive values, plain objects and
 * arrays in it, and `listed`, how many items and keys it listed in it (see clearSearched).
 */
const rememberSearched = (container: object, inFull: boolean, clear: boolean, listed: number): void => {
  if (!hashSettings.memos) return
  if (inFull) {
    notSearched.add(container)
    if (clear) clearSearched.set(container, listed)
    return
  }
  const unproven = partlySearched.get(container)
  if (unproven === undefined) partlySearched.set(container, false)
  else if (!unproven) {
    const proof = holdsNoMatcherAtAll(container)
    if (proof === NOT_PROVEN) partlySearched.set(container, true)
    else {
      notSearched.add(container)
      if (proof !== NOT_CLEAR) clearSearched.set(container, proof)
    }
  }
}

/** E109: what holdsNoMatcherAtAll finds out besides the number of items and keys listed in a container that holds no substitute. */
const NOT_PROVEN = -1
const NOT_CLEAR = -2

/**
 * Whether no matcher can be found in a container in any search: one that looks at everything inside it that a search
 * could reach from it (each container once, with no budgets, MAX_SCAN_DEPTH levels below it, containers that are never
 * searched left out) and finds no matcher, within SCAN_ITEMS items (beyond them, nothing is known). NOT_PROVEN if one
 * may be there; otherwise (E109) the number of items and keys listed in it when it holds only primitive values, plain
 * objects and arrays (no substitute, see clearSearched), and NOT_CLEAR when it holds other values.
 */
const holdsNoMatcherAtAll = (root: object): number => {
  const seen = new Set<object>([root])
  const pending: Array<[object, number]> = [[root, 0]]
  let items = SCAN_ITEMS
  let clear = true
  let remembered = 0
  const look = (value: unknown, depth: number): boolean => {
    const kind = lookAt(value)
    if (kind !== 'plain') {
      if (kind === undefined && (typeof value === 'function' || (typeof value === 'object' && value !== null))) clear = false
      return kind === undefined
    }
    if (depth < MAX_SCAN_DEPTH && !seen.has(value as object)) {
      seen.add(value as object)
      if (!notSearched.has(value as object)) pending.push([value as object, depth])
      else {
        const listed = clearSearched.get(value as object)
        if (listed === undefined) clear = false
        else remembered += listed
      }
    }
    return true
  }
  /** Looks at the items of one container (false: a matcher may be among them). */
  const lookInside = (container: object, depth: number): boolean => {
    if (types.isProxy(container) || (Array.isArray(container) && Object.getPrototypeOf(container) !== Array.prototype)) clear = false
    if (Array.isArray(container)) {
      if (container.length > MAX_SCANNED_ITEMS) return true
      if ((items -= container.length) < 0) return false
      for (let index = 0; index < container.length; index++) if (!look(container[index], depth + 1)) return false
      return true
    }
    if (isInFamily(container)) {
      clear = false
      return true
    }
    const keys = Object.keys(container)
    const symbols = Object.getOwnPropertySymbols(container)
    if (keys.length + symbols.length > MAX_SCANNED_ITEMS) return true
    if ((items -= keys.length + symbols.length) < 0) return false
    const proxy = types.isProxy(container)
    for (let index = 0; index < keys.length; index++) if (!look(dataValue(container, keys[index], proxy), depth + 1)) return false
    for (let index = 0; index < symbols.length; index++) {
      const symbol = symbols[index]
      if (Object.prototype.propertyIsEnumerable.call(container, symbol) && !look(dataValue(container, symbol, proxy), depth + 1)) return false
    }
    return true
  }
  while (pending.length > 0) {
    const [container, depth] = pending.pop()!
    try {
      if (!lookInside(container, depth)) return NOT_PROVEN
    } catch {
      return NOT_PROVEN // E93: its keys or items cannot be read, so nothing is known
    }
  }
  return clear ? SCAN_ITEMS - items + remembered : NOT_CLEAR
}

/**
 * Whether a value has a matcher nested in a plain object or array (D27), within the bounds above. A container that
 * cannot be read (a throwing getter) holds no matcher.
 */
const containsNestedMatcher = (value: unknown): boolean => isPlainContainer(value) && holdsNestedMatcher(value)

/** containsNestedMatcher for a value known to be a plain container (see lookAt). */
const holdsNestedMatcher = (container: object): boolean => {
  try {
    return holdsMatcher(container, SCAN_BUDGET, 0, { root: container, visited: undefined, items: SCAN_ITEMS, cuts: 0, opaque: 0, remembered: 0 }, true)
  } catch {
    return false
  }
}

/**
 * E109: the arguments of the last search for matchers of a call (containsMatchers), which of them hold no substitute (a
 * bit for each), and how many items and keys it listed in those (see clearArgumentsOf).
 */
let scannedArguments: readonly unknown[] | undefined
let clearArguments = 0
const scannedItems: number[] = []

/** The plain containers in `value` that hold a matcher somewhere inside, for a specification. */
const collectMatcherContainers = (value: unknown, found: Set<object>, visited: Set<object>): boolean => {
  const look = lookAt(value)
  if (look !== 'plain') return look !== undefined
  if (visited.has(value as object)) return found.has(value as object)
  visited.add(value as object)
  let holds = false
  try {
    for (const [, item] of containerEntries(value as object)) if (collectMatcherContainers(item, found, visited)) holds = true
  } catch {
    return false
  }
  if (holds) found.add(value as object)
  return holds
}

const validateNestedAll = (container: object, matcherContainers: ReadonlySet<object>, visited = new Set<object>()): void => {
  if (visited.has(container)) return
  visited.add(container)
  const entries = containerEntries(container)
  entries.forEach(([, item], index) => {
    if (Array.isArray(container) && isAllArguments(item) && index !== entries.length - 1)
      throw SubstituteException.generic(
        `Arg.all() in an array matches all remaining items, so it must be the last item. ` +
        `Found ${entries.length - index - 1} item(s) after it.`
      )
    if (matcherContainers.has(item as object)) validateNestedAll(item as object, matcherContainers, visited)
  })
}

type Evaluation = { matches: boolean, predicateThrew?: boolean, predicateError?: unknown }
const MATCHES: Evaluation = { matches: true }
const DIFFERS: Evaluation = { matches: false }

/**
 * Matches an expected value that may hold nested matchers against an actual value (D27). Containers with matchers
 * are compared structurally: the same kind (array, or object with the same prototype), the same length or the same
 * own enumerable keys, and every item matches. A trailing Arg.all() in an array matches the remaining items, and
 * Arg.all() as an object value matches any value. Everything else is compared with deep strict equality.
 * A pair of containers that is already being compared further up matches (cycles end).
 */
const matchNested = (expected: unknown, actual: unknown, matcherContainers: ReadonlySet<object>, comparing: Array<[unknown, unknown]>, guarded: boolean): Evaluation => {
  // (a container that holds matchers is never a matcher itself: no need to look for one)
  const holder = matcherContainers.has(expected as object)
  const kind = holder ? undefined : matcherKindOf(expected)
  if (kind === 'all') return MATCHES
  if (kind !== undefined) {
    // (an Arg matcher among the actual arguments is never a value that a matcher matches, D3)
    if (isArgMatcher(actual)) return DIFFERS
    const evaluation = guarded ? evaluateMatcherInLook(expected, kind, actual) : evaluateMatcher(expected, kind, actual)
    return evaluation.matches ? MATCHES : { matches: false, predicateThrew: evaluation.threw, predicateError: evaluation.error }
  }
  if (!holder) return literalEquals(expected, actual) ? MATCHES : DIFFERS
  // E93 (R14V-1): the same container matches itself before any of its keys is listed
  if (expected === actual || comparing.some(([e, a]) => e === expected && a === actual)) return MATCHES

  const container = expected as object
  let pairs: Array<[unknown, unknown]>
  try {
    if (typeof actual !== 'object' || actual === null || isArgMatcher(actual)) return DIFFERS
    if (Array.isArray(container) !== Array.isArray(actual) || Object.getPrototypeOf(container) !== Object.getPrototypeOf(actual)) return DIFFERS
    if (Array.isArray(container)) {
      const items = actual as unknown[]
      const restIndex = container.length > 0 && isAllArguments(container[container.length - 1]) ? container.length - 1 : -1
      if (restIndex === -1 ? items.length !== container.length : items.length < restIndex) return DIFFERS
      const compared = restIndex === -1 ? container.length : restIndex
      pairs = Array.from({ length: compared }, (_, index): [unknown, unknown] => [container[index], items[index]])
    } else {
      const keys = ownEnumerableKeys(container)
      const actualKeys = ownEnumerableKeys(actual)
      if (keys.length !== actualKeys.length || !keys.every(key => actualKeys.indexOf(key) !== -1)) return DIFFERS
      pairs = keys.map((key): [unknown, unknown] => [(container as any)[key], (actual as any)[key]])
    }
  } catch {
    // E93: keys or items that cannot be read (now): compared as such values are, by identity, which was decided above
    // before any key was listed (they are not the same). E102 (R15V-2): without comparing them again, which would read
    // a throwing getter of the actual value a second time (deep equality cannot hold for a container with a matcher).
    return DIFFERS
  }
  // E117 (R16-ADV-8): the items are compared outside the catch above, which is only for reading and listing this
  // container and the value: a usage error of a matcher inside (an async Arg.is predicate's TypeError, a
  // SubstituteException) is thrown as at the top level. A predicate that throws is a non-match there as anywhere
  // (see evaluateArgument), and each nested container's reads are guarded by its own comparison.
  comparing.push([expected, actual])
  try {
    for (const [expectedItem, actualItem] of pairs) {
      const evaluation = matchNested(expectedItem, actualItem, matcherContainers, comparing, guarded)
      if (!evaluation.matches) return evaluation
    }
  } finally {
    comparing.pop()
  }
  return MATCHES
}

/**
 * Whether two matchers always give the same answer (see argumentsAreEquivalent). E75: two matchers of a test runner of
 * the same kind when they are equal (`expect.any(String)` twice: the same class and sample).
 */
const equivalentMatchers = (a: unknown, b: unknown): boolean => {
  if (isArgMatcher(a) || isArgMatcher(b)) return isArgMatcher(a) && isArgMatcher(b) && argumentsAreEquivalent(a, b)
  return foreignMatcherOf(a) === foreignMatcherOf(b) && literalEquals(a, b)
}

/** Whether two expected values are the same specification (re-configuration), matchers compared as matchers. */
const equivalentNested = (a: unknown, b: unknown, depth = 0): boolean => {
  const aIsMatcher = isArgumentMatcher(a)
  const bIsMatcher = isArgumentMatcher(b)
  if (aIsMatcher || bIsMatcher) return aIsMatcher && bIsMatcher && equivalentMatchers(a, b)
  if (!containsNestedMatcher(a) && !containsNestedMatcher(b)) return literalEquals(a, b)
  if (depth > 64 || !isPlainContainer(a) || !isPlainContainer(b)) return false
  if (Array.isArray(a) !== Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  try {
    const aEntries = containerEntries(a)
    const bEntries = containerEntries(b)
    if (aEntries.length !== bEntries.length) return false
    const bValues = new Map(bEntries)
    return aEntries.every(([key, value]) => bValues.has(key) && equivalentNested(value, bValues.get(key), depth + 1))
  } catch {
    return false
  }
}

/** Whether two expected arguments without nested matchers are the same, matchers compared as matchers. */
const equivalentArgument = (a: unknown, b: unknown): boolean => {
  const aIsMatcher = isArgumentMatcher(a)
  const bIsMatcher = isArgumentMatcher(b)
  if (aIsMatcher || bIsMatcher) return aIsMatcher && bIsMatcher && equivalentMatchers(a, b)
  return literalEquals(a, b)
}

/**
 * An argument list. Either the actual arguments of a call, or the expected arguments of a setup or an
 * assertion (a specification), which may contain Arg matchers.
 *
 * Matching is one-directional: `specification.matches(actualArguments)`. A matcher on the specification
 * side matches actual values; an Arg that ends up on the actual side is never treated as a matcher.
 */
export class RecordedArguments {
  private _argumentsClass?: ArgumentsClass
  private _value?: any[]
  /** D27: the plain objects and arrays among the arguments that hold matchers (undefined when there are none). */
  private _matcherContainers?: ReadonlySet<object>
  /** The kind of matcher each argument is, if it is one (E75: of any kind); undefined when none is. */
  private _kinds?: ReadonlyArray<MatcherKind | undefined>

  private constructor(rawArguments: any[] | void) {
    if (typeof rawArguments === 'undefined') return this

    this._value = rawArguments
    let containers: Set<object> | undefined
    let kinds: Array<MatcherKind | undefined> | undefined
    for (let index = 0; index < rawArguments.length; index++) {
      const argument = rawArguments[index]
      const look = lookAt(argument)
      if (look === undefined) continue
      if (look !== 'plain') {
        if (kinds === undefined) kinds = new Array(rawArguments.length)
        kinds[index] = look
        continue
      }
      if (!holdsNestedMatcher(argument)) continue
      if (containers === undefined) containers = new Set()
      collectMatcherContainers(argument, containers, new Set())
    }
    // E54: messages and printouts show these containers at any depth, so that the matchers in them show
    if (containers !== undefined) containers.forEach(noteMatcherHolder)
    this._matcherContainers = containers
    this._kinds = kinds
    this._argumentsClass = this.classifyArguments()
  }

  static from(rawArguments: any[]): RecordedArguments {
    return new this(rawArguments)
  }

  static none(): RecordedArguments {
    return new this()
  }

  /**
   * Creates the specification of a setup or an assertion. Arg.all() matches the rest of the argument list,
   * so anything after it is a usage error.
   */
  static forSpecification(rawArguments: any[]): RecordedArguments {
    RecordedArguments.rejectMatcherFactories(rawArguments)
    const allIndex = rawArguments.findIndex(argument => isAllArguments(argument))
    if (allIndex !== -1 && allIndex !== rawArguments.length - 1)
      throw SubstituteException.generic(
        `Arg.all() matches all remaining arguments, so it must be the last argument. ` +
        `Found ${rawArguments.length - allIndex - 1} argument(s) after it.`
      )
    const specification = new this(rawArguments)
    const containers = specification._matcherContainers
    if (containers !== undefined)
      for (const argument of rawArguments) if (containers.has(argument)) validateNestedAll(argument, containers)
    return specification
  }

  /**
   * E49 (R8FE-5): the arguments of a setup or a check must not be one of the matcher functions themselves (`Arg.any`
   * for `Arg.any()`, a JavaScript slip): compared as a literal function, such a setup never matched, and a negative
   * check always passed. It is a usage error that names the matcher.
   */
  static rejectMatcherFactories(rawArguments: readonly unknown[], stackStart?: Function): void {
    for (const argument of rawArguments) {
      const factory = matcherFactoryOf(argument)
      if (factory !== undefined)
        throw SubstituteException.generic(
          `${factory.name} was passed as an argument without calling it, so it would only match the function ${factory.name} ` +
          `itself. Did you mean ${factory.call}?`,
          stackStart
        )
    }
  }

  /**
   * Whether two lists of actual (matcher-free) arguments are equal, argument by argument. E22: a position that one list
   * does not have reads as undefined, so `f(1)` and `f(1, undefined)` are equal, and `f(1)` and `f(1, 2)` are not.
   */
  static literalsEqual(expected: readonly unknown[], actual: readonly unknown[]): boolean {
    const length = Math.max(expected.length, actual.length)
    for (let index = 0; index < length; index++) if (!literalEquals(expected[index], actual[index])) return false
    return true
  }

  /**
   * Whether the arguments hold an Arg matcher, as an argument or nested in plain objects and arrays (D3, D27). The first
   * look at the arguments of an invocation: it starts the operation's notes of listed keys afresh (see noteListing).
   */
  static containsMatchers(rawArguments: readonly unknown[]): boolean {
    forgetListings()
    // E109: and which of them hold no substitute (see clearArgumentsOf)
    let clear = 0
    for (let index = 0; index < rawArguments.length; index++) {
      const argument = rawArguments[index]
      const look = lookAt(argument)
      if (look === 'plain') {
        const search: Search = { root: argument as object, visited: undefined, items: SCAN_ITEMS, cuts: 0, opaque: 0, remembered: 0 }
        let holds: boolean
        try {
          holds = holdsMatcher(argument as object, SCAN_BUDGET, 0, search, true)
        } catch {
          holds = false
          search.cuts++
        }
        if (holds) return true
        if (search.cuts === 0 && search.opaque === 0 && index < CLEAR_ARGUMENTS) {
          clear |= 1 << index
          scannedItems[index] = listedBy(search)
        }
      } else if (look !== undefined) return true
      else if (index < CLEAR_ARGUMENTS && typeof argument !== 'function' && (typeof argument !== 'object' || argument === null)) clear |= 1 << index
    }
    scannedArguments = rawArguments
    clearArguments = clear
    return false
  }

  /**
   * E109 (R16-ADV-2): which of these arguments (a bit for each of the first CLEAR_ARGUMENTS) the search for matchers that
   * the call made (containsMatchers, the call's last one) found to hold no substitute: primitive values, and plain
   * objects and arrays that it looked through in full (no bound left anything out, no container that it does not search
   * again) and found only primitive values, plain objects and arrays (with their own prototypes) in. Such an argument
   * holds no substitute of any copy of the library, so the look of a matcher (see Look) need not walk it. `items`: how
   * many items and keys the search listed in each (for the look's budget), by position. 0 for other arguments.
   */
  static clearArgumentsOf(rawArguments: readonly unknown[]): number {
    return rawArguments === scannedArguments ? clearArguments : 0
  }

  /** E109: the items and keys that the search listed in each of the arguments that clearArgumentsOf tells about. */
  static get scannedItems(): readonly number[] {
    return scannedItems
  }

  static sort<T extends { recordedArguments: RecordedArguments }>(objectWithArguments: T[]): T[] {
    return objectWithArguments.sort((a, b) => a.recordedArguments.rank - b.recordedArguments.rank)
  }

  get argumentsClass(): ArgumentsClass | undefined {
    return this._argumentsClass
  }

  get value(): any[] | undefined {
    return this._value
  }

  /** Specificity rank: all-literal (0) beats predicates (1) beats a leading Arg.all() wildcard (2). */
  get rank(): number {
    return argumentsClassDigitMapper[this._argumentsClass ?? 'none']
  }

  public hasArguments(): this is this & { argumentsClass: ArgumentsClass, value: any[] } {
    return Array.isArray(this._value)
  }

  /** `this` is the specification, `other` holds the actual arguments. */
  public match(other: RecordedArguments): boolean {
    return this.matchDetailed(other.value).matches
  }

  /** `guarded`: see matchDetailed. */
  public matches(actualArguments: readonly unknown[] | undefined, guarded = false): boolean {
    return this.matchDetailed(actualArguments, guarded).matches
  }

  /**
   * E22: a position that one side does not have (an omitted trailing argument) reads as undefined. It matches only an
   * undefined argument, or a matcher that accepts undefined (Arg.any(), Arg.any('undefined'), ...): `f(1)` and
   * `f(1, undefined)` match each other, `set('a', 1, Arg.any())` matches `set('a', 1)`, and `f(1)` and `f(1, 2)` do not.
   * Arg.all() at a position matches whatever remains from there, including nothing.
   * E100: `guarded` when the caller holds the guard of the matchers it evaluates (see evaluateArgument).
   */
  public matchDetailed(actualArguments: readonly unknown[] | undefined, guarded = false): ArgumentsMatch {
    const expected = this._value
    if (expected === undefined || actualArguments === undefined)
      return expected === undefined && actualArguments === undefined ? MATCH : NO_MATCH

    const kinds = this._kinds
    const length = Math.max(expected.length, actualArguments.length)
    for (let index = 0; index < length; index++) {
      // an argument the specification does not have: only undefined matches it
      if (index >= expected.length) {
        if (actualArguments[index] !== undefined) return NO_MATCH
        continue
      }
      const expectedArgument = expected[index]
      const kind = kinds?.[index]
      if (kind === 'all') return MATCH
      // undefined when the call does not have this argument
      const actualArgument = actualArguments[index]
      if (kind !== undefined) {
        // (an Arg matcher among the actual arguments is never a value that a matcher matches, D3; E75: a test runner's
        // matcher there is a value like any other)
        if (isArgMatcher(actualArgument)) return NO_MATCH
        const evaluation = guarded ? evaluateMatcherInLook(expectedArgument, kind, actualArgument) : evaluateMatcher(expectedArgument, kind, actualArgument)
        if (!evaluation.matches)
          return evaluation.threw ? { matches: false, predicateThrew: true, predicateError: evaluation.error } : NO_MATCH
        continue
      }
      const containers = this._matcherContainers
      if (containers !== undefined && containers.has(expectedArgument)) {
        const evaluation = matchNested(expectedArgument, actualArgument, containers, [], guarded)
        if (!evaluation.matches)
          return evaluation.predicateThrew === true ? { matches: false, predicateThrew: true, predicateError: evaluation.predicateError } : NO_MATCH
        continue
      }
      if (!literalEquals(expectedArgument, actualArgument)) return NO_MATCH
    }
    return MATCH
  }

  /**
   * True when both specifications are the same (used to recognise a re-configuration). E22: a position that one of them
   * does not have is the same as a literal undefined (`f(1)` and `f(1, undefined)` are one specification), and not the
   * same as a matcher.
   */
  public equals(other: RecordedArguments): boolean {
    const a = this._value
    const b = other._value
    if (a === undefined || b === undefined) return a === b
    const plain = this._matcherContainers === undefined && other._matcherContainers === undefined
    const length = Math.max(a.length, b.length)
    for (let index = 0; index < length; index++) {
      if (index >= a.length || index >= b.length) {
        if ((index < a.length ? a[index] : b[index]) !== undefined) return false
        continue
      }
      if (!(plain ? equivalentArgument(a[index], b[index]) : equivalentNested(a[index], b[index]))) return false
    }
    return true
  }

  private classifyArguments(): ArgumentsClass {
    const kinds = this._kinds
    if (this._matcherContainers === undefined && kinds === undefined) return 'plain'
    if (kinds !== undefined && kinds[0] === 'all') return 'wildcard'
    return 'with-predicate'
  }

  [inspect.custom](_: number, options: InspectOptions) {
    return this.printableForm(options)
  }

  private printableForm(options: InspectOptions): string {
    const inspectedValues = this.value?.map(v => inspect(v, options))
    if (!Array.isArray(inspectedValues)) return ''
    return inspectedValues.length !== 1
      ? `(${inspectedValues.join(', ')})`
      : inspectedValues[0]
  }
}
