import { inspect, InspectOptions, isDeepStrictEqual } from 'util'
import { argumentsAreEquivalent, evaluateArgument, isAllArguments, isArgumentMatcher, isSingleArgument } from '../shared'
import { SubstituteException } from './SubstituteException'
import { FAMILY_KEYS, forgetListings, isInFamily, noteListing } from './utilities/ArgumentHash'

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

const literalEquals = (expected: unknown, actual: unknown): boolean => {
  if (expected === actual) return expected !== 0 || Object.is(expected, actual)
  try {
    return isDeepStrictEqual(expected, actual)
  } catch {
    return false
  }
}

// ---- D27: matchers nested in plain objects and arrays ------------------------------------------

/** Arrays, and objects whose prototype is Object.prototype or null: the only values that may hold nested matchers. */
const isPlainContainer = (value: unknown): value is object => {
  if (typeof value !== 'object' || value === null || isArgumentMatcher(value)) return false
  try {
    if (Array.isArray(value)) return true
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false // a revoked proxy
  }
}

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

/** The value of an own data property; getters are not run (a matcher behind a getter is not looked for). */
const dataValue = (object: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
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

/**
 * One search: the argument, the containers searched so far (created once a nested one is reached; true for those
 * searched in full), the items left, and how often a bound left something out (`cuts`: then the containers around it
 * are not remembered as searched).
 */
type Search = { root: object, visited: Map<object, boolean> | undefined, items: number, cuts: number }

const holdsMatcherItem = (item: unknown, budget: number, depth: number, search: Search): boolean => {
  if (isArgumentMatcher(item)) return true
  if (budget > 0 && depth < MAX_SCAN_DEPTH) return isPlainContainer(item) && holdsMatcher(item, budget, depth + 1, search)
  if (typeof item === 'object' && item !== null) search.cuts++
  return false
}

/** Whether a plain container holds a matcher (see above). It runs no getters of the code under test's objects. */
const holdsMatcher = (container: object, budget: number, depth: number, search: Search): boolean => {
  if (notSearched.has(container)) return false
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
  const found = holdsMatcherInside(container, budget, depth, search)
  if (!found && depth > 0 && search.cuts === cuts) search.visited!.set(container, true)
  return found
}

const holdsMatcherInside = (container: object, budget: number, depth: number, search: Search): boolean => {
  const cuts = search.cuts
  if (Array.isArray(container)) {
    const length = container.length
    if (length > MAX_SCANNED_ITEMS) return false
    if (length > search.items) {
      search.cuts++
      return false
    }
    search.items -= length
    const share = Math.floor((budget - 1) / length)
    for (let index = 0; index < length; index++) if (holdsMatcherItem(container[index], share, depth, search)) return true
    if (length > REMEMBERED_ITEMS) rememberSearched(container, search.cuts === cuts)
    return false
  }
  // E13: an object of a family (see ArgumentHash) has more keys than are searched: no need to list them
  if (isInFamily(container)) {
    notSearched.add(container)
    return false
  }
  const keys = Object.keys(container)
  const symbols = Object.getOwnPropertySymbols(container)
  const count = keys.length + symbols.length
  if (count > MAX_SCANNED_ITEMS) {
    notSearched.add(container)
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
  for (let index = 0; index < keys.length; index++) if (holdsMatcherItem(dataValue(container, keys[index]), share, depth, search)) return true
  for (let index = 0; index < symbols.length; index++) {
    const symbol = symbols[index]
    if (Object.prototype.propertyIsEnumerable.call(container, symbol) && holdsMatcherItem(dataValue(container, symbol), share, depth, search)) return true
  }
  if (count > REMEMBERED_ITEMS) rememberSearched(container, search.cuts === cuts)
  return false
}

/** Wide containers whose search left something out, and that cannot be shown to hold no matcher anywhere (see below). */
const unproven = new WeakSet<object>()

/**
 * Remembers a wide container that holds no matcher within the bounds of its search. When the bounds left something
 * out (a record's nested object without a share of the budget), it is searched once more, without budgets (see
 * holdsNoMatcherAtAll), so that a shared table of records is searched in full once instead of in part on every call.
 */
const rememberSearched = (container: object, inFull: boolean): void => {
  if (inFull) notSearched.add(container)
  else if (!unproven.has(container)) {
    if (holdsNoMatcherAtAll(container)) notSearched.add(container)
    else unproven.add(container)
  }
}

/**
 * Whether no matcher can be found in a container in any search: one that looks at everything inside it that a search
 * could reach from it (each container once, with no budgets, MAX_SCAN_DEPTH levels below it, containers that are never
 * searched left out) and finds no matcher, within SCAN_ITEMS items (beyond them, nothing is known).
 */
const holdsNoMatcherAtAll = (root: object): boolean => {
  const seen = new Set<object>([root])
  const pending: Array<[object, number]> = [[root, 0]]
  let items = SCAN_ITEMS
  const look = (value: unknown, depth: number): boolean => {
    if (isArgumentMatcher(value)) return false
    if (depth < MAX_SCAN_DEPTH && isPlainContainer(value) && !seen.has(value) && !notSearched.has(value)) {
      seen.add(value)
      pending.push([value, depth])
    }
    return true
  }
  while (pending.length > 0) {
    const [container, depth] = pending.pop()!
    if (Array.isArray(container)) {
      if (container.length > MAX_SCANNED_ITEMS) continue
      if ((items -= container.length) < 0) return false
      for (let index = 0; index < container.length; index++) if (!look(container[index], depth + 1)) return false
      continue
    }
    if (isInFamily(container)) continue
    const keys = Object.keys(container)
    const symbols = Object.getOwnPropertySymbols(container)
    if (keys.length + symbols.length > MAX_SCANNED_ITEMS) continue
    if ((items -= keys.length + symbols.length) < 0) return false
    for (let index = 0; index < keys.length; index++) if (!look(dataValue(container, keys[index]), depth + 1)) return false
    for (let index = 0; index < symbols.length; index++) {
      const symbol = symbols[index]
      if (Object.prototype.propertyIsEnumerable.call(container, symbol) && !look(dataValue(container, symbol), depth + 1)) return false
    }
  }
  return true
}

/**
 * Whether a value has a matcher nested in a plain object or array (D27), within the bounds above. A container that
 * cannot be read (a throwing getter) holds no matcher.
 */
const containsNestedMatcher = (value: unknown): boolean => {
  if (!isPlainContainer(value)) return false
  try {
    return holdsMatcher(value, SCAN_BUDGET, 0, { root: value, visited: undefined, items: SCAN_ITEMS, cuts: 0 })
  } catch {
    return false
  }
}

/** The plain containers in `value` that hold a matcher somewhere inside, for a specification. */
const collectMatcherContainers = (value: unknown, found: Set<object>, visited: Set<object>): boolean => {
  if (isArgumentMatcher(value)) return true
  if (!isPlainContainer(value) || visited.has(value)) return found.has(value as object)
  visited.add(value)
  let holds = false
  try {
    for (const [, item] of containerEntries(value)) if (collectMatcherContainers(item, found, visited)) holds = true
  } catch {
    return false
  }
  if (holds) found.add(value)
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
const matchNested = (expected: unknown, actual: unknown, matcherContainers: ReadonlySet<object>, comparing: Array<[unknown, unknown]>): Evaluation => {
  if (isSingleArgument(expected)) {
    if (isArgumentMatcher(actual)) return DIFFERS
    const evaluation = evaluateArgument(expected, actual)
    return evaluation.matches ? MATCHES : { matches: false, predicateThrew: evaluation.threw, predicateError: evaluation.error }
  }
  if (isAllArguments(expected)) return MATCHES
  if (!matcherContainers.has(expected as object)) return literalEquals(expected, actual) ? MATCHES : DIFFERS
  if (comparing.some(([e, a]) => e === expected && a === actual)) return MATCHES

  const container = expected as object
  try {
    if (typeof actual !== 'object' || actual === null || isArgumentMatcher(actual)) return DIFFERS
    if (Array.isArray(container) !== Array.isArray(actual) || Object.getPrototypeOf(container) !== Object.getPrototypeOf(actual)) return DIFFERS
    let pairs: Array<[unknown, unknown]>
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
    comparing.push([expected, actual])
    try {
      for (const [expectedItem, actualItem] of pairs) {
        const evaluation = matchNested(expectedItem, actualItem, matcherContainers, comparing)
        if (!evaluation.matches) return evaluation
      }
    } finally {
      comparing.pop()
    }
    return MATCHES
  } catch {
    return DIFFERS
  }
}

/** Whether two expected values are the same specification (re-configuration), matchers compared as matchers. */
const equivalentNested = (a: unknown, b: unknown, depth = 0): boolean => {
  const aIsMatcher = isArgumentMatcher(a)
  const bIsMatcher = isArgumentMatcher(b)
  if (aIsMatcher || bIsMatcher) return aIsMatcher && bIsMatcher && argumentsAreEquivalent(a, b)
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
  if (aIsMatcher || bIsMatcher) return aIsMatcher && bIsMatcher && argumentsAreEquivalent(a, b)
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

  private constructor(rawArguments: any[] | void) {
    if (typeof rawArguments === 'undefined') return this

    this._value = rawArguments
    let containers: Set<object> | undefined
    for (const argument of rawArguments) {
      if (isArgumentMatcher(argument) || !containsNestedMatcher(argument)) continue
      if (containers === undefined) containers = new Set()
      collectMatcherContainers(argument, containers, new Set())
    }
    this._matcherContainers = containers
    this._argumentsClass = this.classifyArguments(rawArguments)
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
    for (const argument of rawArguments) if (isArgumentMatcher(argument) || containsNestedMatcher(argument)) return true
    return false
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

  public matches(actualArguments: readonly unknown[] | undefined): boolean {
    return this.matchDetailed(actualArguments).matches
  }

  /**
   * E22: a position that one side does not have (an omitted trailing argument) reads as undefined. It matches only an
   * undefined argument, or a matcher that accepts undefined (Arg.any(), Arg.any('undefined'), ...): `f(1)` and
   * `f(1, undefined)` match each other, `set('a', 1, Arg.any())` matches `set('a', 1)`, and `f(1)` and `f(1, 2)` do not.
   * Arg.all() at a position matches whatever remains from there, including nothing.
   */
  public matchDetailed(actualArguments: readonly unknown[] | undefined): ArgumentsMatch {
    const expected = this._value
    if (expected === undefined || actualArguments === undefined)
      return expected === undefined && actualArguments === undefined ? MATCH : NO_MATCH

    const length = Math.max(expected.length, actualArguments.length)
    for (let index = 0; index < length; index++) {
      // an argument the specification does not have: only undefined matches it
      if (index >= expected.length) {
        if (actualArguments[index] !== undefined) return NO_MATCH
        continue
      }
      const expectedArgument = expected[index]
      if (isAllArguments(expectedArgument)) return MATCH
      // undefined when the call does not have this argument
      const actualArgument = actualArguments[index]
      if (isSingleArgument(expectedArgument)) {
        if (isArgumentMatcher(actualArgument)) return NO_MATCH
        const evaluation = evaluateArgument(expectedArgument, actualArgument)
        if (!evaluation.matches)
          return evaluation.threw ? { matches: false, predicateThrew: true, predicateError: evaluation.error } : NO_MATCH
        continue
      }
      const containers = this._matcherContainers
      if (containers !== undefined && containers.has(expectedArgument)) {
        const evaluation = matchNested(expectedArgument, actualArgument, containers, [])
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

  private classifyArguments(rawArguments: any[]): ArgumentsClass {
    if (this._matcherContainers === undefined && !rawArguments.some(argument => isArgumentMatcher(argument))) return 'plain'
    if (rawArguments.length > 0 && isAllArguments(rawArguments[0])) return 'wildcard'
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
