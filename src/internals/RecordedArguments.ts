import { inspect, InspectOptions, isDeepStrictEqual } from 'util'
import { argumentsAreEquivalent, evaluateArgument, isAllArguments, isArgumentMatcher, isSingleArgument } from '../shared'
import { SubstituteException } from './SubstituteException'

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

/**
 * Whether some value inside a plain container satisfies the predicate. Used on the arguments of every call, so it
 * allocates nothing per item and runs no getters of the code under test's objects.
 */
const someItem = (container: object, predicate: (item: unknown) => boolean): boolean => {
  if (Array.isArray(container)) {
    for (let index = 0; index < container.length; index++) if (predicate(container[index])) return true
    return false
  }
  for (const key of Object.keys(container)) if (predicate(dataValue(container, key))) return true
  for (const symbol of Object.getOwnPropertySymbols(container))
    if (Object.prototype.propertyIsEnumerable.call(container, symbol) && predicate(dataValue(container, symbol))) return true
  return false
}

const holdsMatcher = (container: object, visited: Set<object>): boolean => {
  visited.add(container)
  return someItem(container, item => isArgumentMatcher(item) || (isPlainContainer(item) && !visited.has(item) && holdsMatcher(item, visited)))
}

/**
 * Whether a value has a matcher nested in a plain object or array (D27), at any depth. Every container is visited
 * once, so cycles end. A container that cannot be read (a throwing getter) holds no matcher.
 */
const containsNestedMatcher = (value: unknown): boolean => {
  if (!isPlainContainer(value)) return false
  try {
    return holdsMatcher(value, new Set())
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

  /** Whether two lists of actual (matcher-free) arguments are equal, argument by argument. */
  static literalsEqual(expected: readonly unknown[], actual: readonly unknown[]): boolean {
    if (expected.length !== actual.length) return false
    for (let index = 0; index < expected.length; index++) if (!literalEquals(expected[index], actual[index])) return false
    return true
  }

  /** Whether the arguments hold an Arg matcher, as an argument or nested in plain objects and arrays (D3, D27). */
  static containsMatchers(rawArguments: readonly unknown[]): boolean {
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

  public matchDetailed(actualArguments: readonly unknown[] | undefined): ArgumentsMatch {
    const expected = this._value
    if (expected === undefined || actualArguments === undefined)
      return expected === undefined && actualArguments === undefined ? MATCH : NO_MATCH

    for (let index = 0; index < expected.length; index++) {
      const expectedArgument = expected[index]
      if (isAllArguments(expectedArgument)) return MATCH
      if (index >= actualArguments.length) return NO_MATCH
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
    return expected.length === actualArguments.length ? MATCH : NO_MATCH
  }

  /** True when both specifications are the same (used to recognise a re-configuration). */
  public equals(other: RecordedArguments): boolean {
    const a = this._value
    const b = other._value
    if (a === undefined || b === undefined) return a === b
    if (a.length !== b.length) return false
    if (this._matcherContainers === undefined && other._matcherContainers === undefined) {
      return a.every((argument, index) => {
        const otherArgument = b[index]
        const aIsMatcher = isArgumentMatcher(argument)
        const bIsMatcher = isArgumentMatcher(otherArgument)
        if (aIsMatcher || bIsMatcher) return aIsMatcher && bIsMatcher && argumentsAreEquivalent(argument, otherArgument)
        return literalEquals(argument, otherArgument)
      })
    }
    return a.every((argument, index) => equivalentNested(argument, b[index]))
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
