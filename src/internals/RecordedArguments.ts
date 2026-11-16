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

  private constructor(rawArguments: any[] | void) {
    if (typeof rawArguments === 'undefined') return this

    this._argumentsClass = this.classifyArguments(rawArguments)
    this._value = rawArguments
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
    return new this(rawArguments)
  }

  static containsMatchers(rawArguments: readonly unknown[]): boolean {
    for (const argument of rawArguments) if (isArgumentMatcher(argument)) return true
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
    return a.every((argument, index) => {
      const otherArgument = b[index]
      const aIsMatcher = isArgumentMatcher(argument)
      const bIsMatcher = isArgumentMatcher(otherArgument)
      if (aIsMatcher || bIsMatcher) return aIsMatcher && bIsMatcher && argumentsAreEquivalent(argument, otherArgument)
      return literalEquals(argument, otherArgument)
    })
  }

  private classifyArguments(rawArguments: any[]): ArgumentsClass {
    if (!RecordedArguments.containsMatchers(rawArguments)) return 'plain'
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
