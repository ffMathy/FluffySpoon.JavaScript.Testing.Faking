import { inspect } from 'util'

export type PredicateFunction<T> = (arg: T) => boolean
export type ArgumentOptions = {
  inverseMatch?: boolean
}

export type ArgumentEvaluation = {
  matches: boolean
  /** Set when the predicate threw while it was evaluated. A throwing predicate never matches. */
  error?: unknown
  threw: boolean
}

// Registered symbol so that matchers created by another copy of this package are recognised too.
const argumentBrand = Symbol.for('@fluffy-spoon/substitute:argument')
type ArgumentBrand = 'single' | 'all'

class BaseArgument<T> {
  private _description: string
  constructor(
    description: string,
    private _matchingFunction: PredicateFunction<T>,
    private _options?: ArgumentOptions
  ) {
    this._description = `${this._options?.inverseMatch ? 'Not ' : ''}${description}`
  }

  matches(arg: T): boolean {
    return evaluateArgument(this as unknown as AnyArgument, arg).matches
  }

  toString() {
    return this._description
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return this._description
  }
}

// E7: util.inspect looks for the runtime's own util.inspect.custom, which is another symbol than the registered one on
// Node.js 10.0 to 10.11; without it, failure messages would print matchers as raw objects there.
const registeredInspectCustom = Symbol.for('nodejs.util.inspect.custom')
const runtimeInspectCustom = (inspect as { custom?: symbol }).custom
if (runtimeInspectCustom !== undefined && runtimeInspectCustom !== registeredInspectCustom) {
  Object.defineProperty(BaseArgument.prototype, runtimeInspectCustom, {
    value: (BaseArgument.prototype as any)[registeredInspectCustom],
    writable: true,
    configurable: true
  })
}

export class Argument<T> extends BaseArgument<T> {
  private readonly _type = 'SingleArgument';
  get type(): 'SingleArgument' {
    return this._type
  }
}

export class AllArguments<T extends any[]> extends BaseArgument<T> {
  private readonly _type = 'AllArguments';
  constructor() {
    super('Arg.all{}', () => true, {})
  }
  get type(): 'AllArguments' {
    return this._type // TODO: Needed?
  }
}

export type AnyArgument = Argument<any> | AllArguments<any[]>

const brand = (target: object, value: ArgumentBrand) => Object.defineProperty(target, argumentBrand, { value, enumerable: false })
brand(Argument.prototype, 'single')
brand(AllArguments.prototype, 'all')

const brandOf = (value: unknown): ArgumentBrand | undefined => {
  // Only plain objects can be matchers. Never touch functions: substitutes are function proxies,
  // and reading a property from them would be recorded as a property access.
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return (value as any)[argumentBrand]
  } catch {
    return undefined
  }
}

/** True for matchers created with Arg.any / Arg.is (including `.not`), by any copy of this package. */
export const isSingleArgument = (value: unknown): value is Argument<unknown> => brandOf(value) === 'single'
/** True for matchers created with Arg.all, by any copy of this package. */
export const isAllArguments = (value: unknown): value is AllArguments<any[]> => brandOf(value) === 'all'
/** True for any Arg matcher. */
export const isArgumentMatcher = (value: unknown): value is AnyArgument => brandOf(value) !== undefined

/**
 * Evaluates a matcher against a value. A predicate that throws is treated as a non-match and the error is reported.
 */
export const evaluateArgument = (argument: AnyArgument, value: unknown): ArgumentEvaluation => {
  const matchingFunction = argument['_matchingFunction'] as PredicateFunction<unknown>
  const inverseMatch = argument['_options']?.inverseMatch ?? false
  try {
    const result = !!matchingFunction(value)
    return { matches: inverseMatch ? !result : result, threw: false }
  } catch (error) {
    return { matches: false, error, threw: true }
  }
}

/**
 * Two matchers are equivalent when they would always give the same answer: same kind, same predicate
 * (by identity) and same inversion. Used to recognise a re-configuration of the same setup.
 */
export const argumentsAreEquivalent = (a: AnyArgument, b: AnyArgument): boolean => {
  if (a === b) return true
  const brandA = brandOf(a)
  if (brandA === undefined || brandA !== brandOf(b)) return false
  if (brandA === 'all') return true
  return a['_matchingFunction'] === b['_matchingFunction'] &&
    (a['_options']?.inverseMatch ?? false) === (b['_options']?.inverseMatch ?? false) &&
    a.toString() === b.toString()
}
