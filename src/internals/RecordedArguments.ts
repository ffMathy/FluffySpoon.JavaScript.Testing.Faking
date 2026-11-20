import { inspect, InspectOptions, isDeepStrictEqual } from 'util'
// (from the module itself rather than '../shared', whose re-exports are getters in CommonJS output: the matcher search
// runs on the arguments of every call, and a getter per lookup cost more than E75's own check)
import {
  MatcherKind, argumentKindOf, argumentsAreEquivalent, evaluateMatcher, foreignMatcherKind, foreignMatcherOf, isAllArguments,
  isArgMatcher, isArgumentMatcher, matcherFactoryOf, matcherKindOf
} from '../shared/Arguments'
import { SubstituteException } from './SubstituteException'
import { noteMatcherHolder } from './utilities/Stringify'
import { libraryGuard } from './utilities/Guard'
import { dataValue } from './utilities/Look'

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

/** How many levels of plain containers the search for matchers goes into (it is recursive). */
const MAX_SCAN_DEPTH = 32

/**
 * Whether a plain container holds a matcher (D27), at most MAX_SCAN_DEPTH levels deep. Each container is searched once
 * per argument (cycles end). It runs no getters of the code under test's objects (a matcher behind a getter is not
 * looked for). E93 (R14V-1): a container whose keys or items cannot be read (a proxy whose ownKeys or
 * getOwnPropertyDescriptor trap throws) holds no matcher, and the search goes on with the items next to it: such a value
 * is compared like the other values that cannot be read, by identity (E14/E83), also next to a matcher
 * (`{ entity, id: Arg.any() }`).
 */
const holdsMatcher = (container: object, depth: number, visited: Set<object>): boolean => {
  if (visited.has(container)) return false
  visited.add(container)
  const holds = (item: unknown): boolean => {
    const look = lookAt(item)
    if (look !== 'plain') return look !== undefined
    return depth < MAX_SCAN_DEPTH && holdsMatcher(item as object, depth + 1, visited)
  }
  try {
    if (Array.isArray(container)) {
      for (let index = 0; index < container.length; index++) if (holds(container[index])) return true
      return false
    }
    for (const key of Object.keys(container)) if (holds(dataValue(container, key))) return true
    for (const symbol of Object.getOwnPropertySymbols(container))
      if (Object.prototype.propertyIsEnumerable.call(container, symbol) && holds(dataValue(container, symbol))) return true
    return false
  } catch {
    return false
  }
}

/** Whether a value has a matcher nested in a plain object or array (D27, see holdsMatcher). */
const containsNestedMatcher = (value: unknown): boolean => isPlainContainer(value) && holdsNestedMatcher(value)

/** containsNestedMatcher for a value known to be a plain container (see lookAt). */
const holdsNestedMatcher = (container: object): boolean => holdsMatcher(container, 0, new Set())

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
    const evaluation = evaluateMatcher(expected, kind, actual, !guarded)
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

  /** Whether the arguments hold an Arg matcher, as an argument or nested in plain objects and arrays (D3, D27). */
  static containsMatchers(rawArguments: readonly unknown[]): boolean {
    for (const argument of rawArguments) {
      const look = lookAt(argument)
      if (look === 'plain' ? holdsNestedMatcher(argument as object) : look !== undefined) return true
    }
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
        const evaluation = evaluateMatcher(expectedArgument, kind, actualArgument, !guarded)
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
    const length = Math.max(a.length, b.length)
    for (let index = 0; index < length; index++) {
      if (index >= a.length || index >= b.length) {
        if ((index < a.length ? a[index] : b[index]) !== undefined) return false
        continue
      }
      if (!equivalentNested(a[index], b[index])) return false
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
