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
    // E46: only the two brand values make a matcher. An object that inherits from a substitute (an instance of
    // `class Plugin extends sdk.Base`) reaches the substitute with this read, which answers undefined (see the get trap
    // in Engine), and a substitute of another copy of the library may answer it with anything.
    const brand = (value as any)[argumentBrand]
    return brand === 'single' || brand === 'all' ? brand : undefined
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
  let result: unknown
  try {
    result = matchingFunction(value)
  } catch (error) {
    return { matches: false, error, threw: true }
  }
  if (isThenable(result)) throw thenablePredicateError(argument, result)
  return { matches: inverseMatch ? !result : !!result, threw: false }
}

/** Whether a predicate returned a promise or another thenable (an async predicate). */
const isThenable = (value: unknown): value is PromiseLike<unknown> => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false
  try {
    return typeof (value as { then?: unknown }).then === 'function'
  } catch {
    return false
  }
}

/**
 * E49 (R8FE-4): an Arg.is predicate must decide synchronously. A promise is truthy, so an async predicate matched every
 * value, and one that rejected left an unhandled rejection behind. It is a usage error instead (a TypeError, like the
 * other invalid uses of Arg.is), and the promise's rejection is handled, so that it is the only error.
 */
const thenablePredicateError = (argument: AnyArgument, result: PromiseLike<unknown>): TypeError => {
  try {
    result.then(undefined, () => { })
  } catch { /* a thenable whose then throws: nothing to handle */ }
  return new TypeError(
    `${argument.toString()} returned a promise (or another thenable), but an Arg.is predicate must return whether the ` +
    `value matches synchronously: an async predicate cannot be used. Await what it needs before the setup or the check.`
  )
}

// ---- E49 (R8FE-5): the matcher functions themselves -------------------------------------------------------------

/** Arg.any, Arg.any.not, Arg.is, Arg.is.not and Arg.all of this copy of the library, with how they are called. */
const matcherFactories = new Map<unknown, { name: string, call: string }>()

/** Registers one of the functions of `Arg` (see Arg.ts): `name` as written, `call` as it is meant to be written. */
export const registerMatcherFactory = (factory: Function, name: string, call: string): void => {
  matcherFactories.set(factory, { name, call })
}

/** The matcher function (Arg.any, ...) that a value is, if it is one, with how it is meant to be called. */
export const matcherFactoryOf = (value: unknown): { name: string, call: string } | undefined =>
  typeof value === 'function' ? matcherFactories.get(value) : undefined

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
