import { inspect } from 'util'
import { libraryGuard } from '../internals/utilities/Guard'

/**
 * What an `Arg.is` predicate may return: any value whose truthiness decides the match (`user => user.name`,
 * `u => u.roles.length`, `u => u.name?.startsWith('a')`), except a promise or another thenable, which the runtime
 * refuses (E49: an async predicate). An object is any non-primitive without a `then` member: the `any` index signature
 * makes every object fit (also interfaces and class instances, and without a weak-type check), and `then?: never`
 * rejects the thenables (R14FE-3, T75). `void` and `unknown` do not fit: a predicate that returns nothing would never
 * match, and `unknown` may be a promise.
 */
export type PredicateResult = boolean | string | number | bigint | symbol | null | undefined | NotThenable
type NotThenable = { [key: string]: any, then?: never }
export type PredicateFunction<T> = (arg: T) => PredicateResult
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

/**
 * E96 (R14FE-4): Arg matchers compose with the matchers of test runners. jest's and vitest's equality treats any object
 * with an `asymmetricMatch` method as an asymmetric matcher, so an Arg matcher in the sample of one of theirs
 * (`expect.objectContaining({ topic: Arg.any('string') })`, `expect.arrayContaining([{ key: Arg.any() }])`), in a setup
 * or a check, or in `expect(value).toEqual({ id: Arg.any() })`, matches as the Arg matcher: Arg.any / Arg.is (and their
 * `.not` forms) as their predicate decides (E95: leaving no trace on substitutes), Arg.all() any value (as an object
 * value, D27), and never an Arg matcher (D3). A method of the prototype, not enumerable: Arg matchers print as before,
 * and they have no `$$typeof`, so the library recognises them as Arg matchers first (by their brand), never as matchers
 * of a test runner (E75). (sinon's matchers only call `test` on matchers of sinon's own, so `sinon.match({ id: Arg.any() })`
 * compares the Arg matcher as a value.)
 */
const asymmetricMatch = function asymmetricMatch(this: unknown, value: unknown): boolean {
  const kind = brandOf(this)
  if (kind === 'all') return true
  if (kind !== 'single' || brandOf(value) !== undefined) return false
  // E100: inside a look of the library (a runner's matcher among the matchers of a setup or a check asks it), that look
  // decides what leaves no trace; called by a runner's own equality, a look of its own
  const inLook = libraryGuard.matching > 0 || libraryGuard.looking !== undefined
  return (inLook ? runPredicate(this as AnyArgument, value) : evaluateArgument(this as AnyArgument, value)).matches
}
Object.defineProperty(BaseArgument.prototype, 'asymmetricMatch', { value: asymmetricMatch, writable: true, configurable: true })

/** True for matchers created with Arg.any / Arg.is (including `.not`), by any copy of this package. */
export const isSingleArgument = (value: unknown): value is Argument<unknown> => brandOf(value) === 'single'
/** True for matchers created with Arg.all, by any copy of this package. */
export const isAllArguments = (value: unknown): value is AllArguments<any[]> => brandOf(value) === 'all'
/** True for any Arg matcher (created with Arg, by any copy of this package), and only for those. */
export const isArgMatcher = (value: unknown): value is AnyArgument => brandOf(value) !== undefined
/** Which Arg matcher a value is: Arg.any/Arg.is ('single') or Arg.all ('all'), if it is one. */
export const argumentKindOf = (value: unknown): ArgumentBrand | undefined => brandOf(value)

// ---- E75 (R12FE-1): the matchers of test runners ----------------------------------------------------------------

/**
 * E75: the matchers of test runners, used in the expected arguments of a setup or a check, match as the runner's own
 * equality uses them, like an Arg matcher (D3: a call with one is a setup or a check, never a real call; D27: also
 * nested in plain objects and arrays):
 * - 'asymmetric': jest's and vitest's asymmetric matchers (expect.any(String), expect.anything(),
 *   expect.stringContaining('@'), expect.objectContaining({ ... }), expect.arrayContaining([...]), expect.closeTo(...),
 *   their `expect.not` forms and the matchers of expect.extend): an object with its own `$$typeof` set to
 *   Symbol.for('jest.asymmetricMatcher') and an `asymmetricMatch` function. It matches a value for which
 *   `asymmetricMatch(value)` is truthy.
 * - 'sinon': sinon's matchers (sinon.match(...), sinon.match.has('err'), sinon.match.string, ...), as sinon creates them:
 *   an object with its own `test` function and `message` string, and `and` and `or` functions, whose prototype is not
 *   Object.prototype. It matches a value for which `test(value)` is truthy.
 * They are recognised only on the expected side: a received (actual) argument that is such an object is a value like
 * any other. Only own properties are looked at first (an object that inherits from a substitute reaches nothing of
 * it), and the sinon shape only on an object that is not a plain one, so that a plain object argument costs one look.
 */
export type ForeignMatcherKind = 'asymmetric' | 'sinon'

const asymmetricMatcherType = Symbol.for('jest.asymmetricMatcher')
const hasOwn = Object.prototype.hasOwnProperty

/**
 * Which matcher of a test runner an object is (see ForeignMatcherKind), if it is one. `plain`: whether its prototype is
 * Object.prototype or null (the caller knows it), where only the jest shape is looked for.
 */
export const foreignMatcherKind = (value: object, plain: boolean): ForeignMatcherKind | undefined => {
  try {
    if (hasOwn.call(value, '$$typeof'))
      return (value as any).$$typeof === asymmetricMatcherType && typeof (value as any).asymmetricMatch === 'function' ? 'asymmetric' : undefined
    if (plain || !hasOwn.call(value, 'test') || !hasOwn.call(value, 'message')) return undefined
    const matcher = value as any
    return typeof matcher.test === 'function' && typeof matcher.message === 'string' &&
      typeof matcher.and === 'function' && typeof matcher.or === 'function' ? 'sinon' : undefined
  } catch {
    return undefined // a revoked proxy, a throwing getter
  }
}

/**
 * The matcher of a test runner that a value is (see ForeignMatcherKind), if it is one. E83 (R13V-1): every look at the
 * value is guarded, as RecordedArguments' lookAt is (E14/E18): Array.isArray and Object.getPrototypeOf throw for a
 * revoked proxy (an immer draft after produce() ended), and a proxy's traps may throw. Such a value is not a matcher, and
 * is compared like any other value (by identity, as it cannot be read).
 */
export const foreignMatcherOf = (value: unknown): ForeignMatcherKind | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  let plain: boolean
  try {
    if (Array.isArray(value)) return undefined
    const prototype = Object.getPrototypeOf(value)
    plain = prototype === Object.prototype || prototype === null
  } catch {
    return undefined // a revoked proxy, a throwing getPrototypeOf trap
  }
  return foreignMatcherKind(value, plain)
}

/** Every kind of matcher of an expected argument: Arg.any/Arg.is ('single'), Arg.all ('all'), and E75's. */
export type MatcherKind = ArgumentBrand | ForeignMatcherKind

/** The kind of matcher an expected argument is (see MatcherKind), if it is one. */
export const matcherKindOf = (value: unknown): MatcherKind | undefined => brandOf(value) ?? foreignMatcherOf(value)

/**
 * True for any matcher of an expected argument: an Arg matcher, or (E75) a matcher of a test runner. (A received value is
 * never a matcher; isArgMatcher tells the library's own matchers apart there.)
 */
export const isArgumentMatcher = (value: unknown): boolean => matcherKindOf(value) !== undefined

/**
 * Evaluates a matcher of a test runner against a value (see ForeignMatcherKind); one that throws does not match. E95: what
 * it does to substitutes leaves no trace (see evaluateArgument).
 */
export const evaluateForeignMatcher = (matcher: object, kind: ForeignMatcherKind, value: unknown): ArgumentEvaluation => {
  let result: unknown
  libraryGuard.matching++
  try {
    result = kind === 'asymmetric' ? (matcher as any).asymmetricMatch(value) : (matcher as any).test(value)
  } catch (error) {
    return { matches: false, error, threw: true }
  } finally {
    libraryGuard.matching--
  }
  return { matches: !!result, threw: false }
}

/** evaluateForeignMatcher without a guard of its own (see evaluateMatcherInLook). */
const runForeignMatcher = (matcher: object, kind: ForeignMatcherKind, value: unknown): ArgumentEvaluation => {
  let result: unknown
  try {
    result = kind === 'asymmetric' ? (matcher as any).asymmetricMatch(value) : (matcher as any).test(value)
  } catch (error) {
    return { matches: false, error, threw: true }
  }
  return { matches: !!result, threw: false }
}

/** Evaluates a matcher of any kind but Arg.all() (see MatcherKind) against a value. */
export const evaluateMatcher = (matcher: unknown, kind: 'single' | ForeignMatcherKind, value: unknown): ArgumentEvaluation =>
  kind === 'single' ? evaluateArgument(matcher as AnyArgument, value) : evaluateForeignMatcher(matcher as object, kind, value)

/**
 * E100 (R15-ADV-4): evaluateMatcher for a caller that holds the guard of all the matchers it evaluates, one per pass
 * instead of one per evaluation: when a real call is matched against setups, the look of the call's arguments (see Look
 * and CallSubstitutions.match), in which only what is done to the values being matched leaves no trace.
 */
export const evaluateMatcherInLook = (matcher: unknown, kind: 'single' | ForeignMatcherKind, value: unknown): ArgumentEvaluation =>
  kind === 'single' ? runPredicate(matcher as AnyArgument, value) : runForeignMatcher(matcher as object, kind, value)

/**
 * E75: how a matcher of a test runner is printed, as the runner prints it: jest's and vitest's with their
 * toAsymmetricMatcher() (`Any<String>`, `Anything`, `NumberCloseTo 1 (2 digits)`) or, without it, their toString() and
 * sample (`StringContaining`, `ObjectContaining` and the sample after it: see `sample`), sinon's with its `message`
 * (`has("err")`, `typeOf("string")`). `sample`: whether the sample is printed after the text.
 */
export const foreignMatcherLabel = (value: unknown): { text: string, sample?: { value: unknown } } | undefined => {
  const kind = foreignMatcherOf(value)
  if (kind === undefined) return undefined
  const matcher = value as any
  try {
    if (kind === 'sinon') return { text: String(matcher.message) }
    if (typeof matcher.toAsymmetricMatcher === 'function') return { text: String(matcher.toAsymmetricMatcher()) }
    const text = typeof matcher.toString === 'function' && matcher.toString !== Object.prototype.toString ? String(matcher.toString()) : 'AsymmetricMatcher'
    return hasOwn.call(matcher, 'sample') ? { text, sample: { value: matcher.sample } } : { text }
  } catch {
    return { text: kind === 'sinon' ? 'SinonMatcher' : 'AsymmetricMatcher' }
  }
}

/**
 * Evaluates a matcher against a value. A predicate that throws is treated as a non-match and the error is reported.
 * E95 (R14FE-1): while it runs (in checks, and when a call is matched against setups), what it does to substitutes
 * leaves no trace: its reads and calls are not recorded, do not use up the values of a returns() or resolves()
 * sequence (they see what the next real read or call would get) and create nothing that a check or a printout shows.
 * They still answer with configured values, and a throws() setup still throws (a non-match). See the record path in
 * Engine, which consults the counter of the looks under way (`libraryGuard.matching`, shared by the copies).
 * E100 (R15-ADV-4): when a real call is matched against setups, the look of the call decides instead (see
 * evaluateMatcherInLook).
 */
export const evaluateArgument = (argument: AnyArgument, value: unknown): ArgumentEvaluation => {
  const matchingFunction = argument['_matchingFunction'] as PredicateFunction<unknown>
  const inverseMatch = argument['_options']?.inverseMatch ?? false
  let result: unknown
  libraryGuard.matching++
  try {
    result = matchingFunction(value)
  } catch (error) {
    return { matches: false, error, threw: true }
  } finally {
    libraryGuard.matching--
  }
  if (isThenable(result)) throw thenablePredicateError(argument, result)
  return { matches: inverseMatch ? !result : !!result, threw: false }
}

/** evaluateArgument without a guard of its own (see evaluateMatcherInLook). */
const runPredicate = (argument: AnyArgument, value: unknown): ArgumentEvaluation => {
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
