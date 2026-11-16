import { inspect } from 'util'
import { Argument, AllArguments, ArgumentOptions, PredicateFunction, isSubstituteProxy } from '../shared'

type Inversable<T> = T & {
  /**
   * The inverse matcher: it matches the arguments the matcher itself rejects, e.g. `Arg.is.not(x => x === 0)` or
   * `Arg.any.not('string')`. A predicate that throws matches in neither form.
   */
  not: T
}
type ExtractFirstArg<T> = T extends AllArguments<infer TArgs> ? TArgs[0] : T
type ReturnArg<T> = Argument<T> & T
const createInversable = <TArg, TReturn>(target: (arg: TArg, opt?: ArgumentOptions) => TReturn): Inversable<(arg: TArg) => TReturn> => {
  const inversable = (arg: TArg) => target(arg)
  inversable.not = (arg: TArg) => target(arg, { inverseMatch: true })
  return inversable
}

const describePredicate = (predicate: Function): string => {
  try {
    const customInspect = (predicate as any).inspect
    if (typeof customInspect === 'function') return String(customInspect.call(predicate))
  } catch { /* fall through to the source text */ }
  try {
    return Function.prototype.toString.call(predicate)
  } catch {
    return '<predicate>'
  }
}

const describeInvalidPredicate = (value: unknown): string => {
  try {
    return inspect(value, { depth: 0 })
  } catch {
    return typeof value
  }
}

const isFunction = <T>(predicate: PredicateFunction<ExtractFirstArg<T>>, options?: ArgumentOptions) => {
  if (typeof predicate !== 'function')
    throw new TypeError(`Arg.is expects a predicate function, but received ${describeInvalidPredicate(predicate)}.`)
  return new Argument(`Arg.is{${describePredicate(predicate)}}`, predicate, options)
}
type Is = {
  /**
   * Matches an argument for which `predicate` returns a truthy value: `calculator.add(Arg.is(x => x > 10), 2)`.
   * The predicate's parameter type is taken from the parameter the matcher is passed to. A predicate that throws counts
   * as a non-match.
   */
  <T>(predicate: PredicateFunction<ExtractFirstArg<T>>): ReturnArg<ExtractFirstArg<T>>
  /**
   * Matches an argument for which `predicate` returns a truthy value: `const negative = Arg.is((x: number) => x < 0)`.
   * A predicate that throws counts as a non-match.
   */
  // Infers the type from an annotated predicate when the matcher is created on its own, which TypeScript 3.6 and 3.7
  // cannot do through `ExtractFirstArg` above (TD-6).
  <T>(predicate: (arg: T) => boolean): ReturnArg<T>
}

// 'function' and 'object' are mostly used for callback and object parameters, so they must be assignable to them (TD-5):
// 'function' is typed as any function or constructor (its `matches` still accepts any `Function`), 'object' as `any`
// (no type is assignable to every object type).
type AnyFunction = Argument<Function> & ((...args: any[]) => any) & (new (...args: any[]) => any)

type MapAnyReturn<T> = T extends 'any' ?
ReturnArg<any> : T extends 'string' ?
ReturnArg<string> : T extends 'number' ?
ReturnArg<number> : T extends 'boolean' ?
ReturnArg<boolean> : T extends 'symbol' ?
ReturnArg<symbol> : T extends 'undefined' ?
ReturnArg<undefined> : T extends 'object' ?
ReturnArg<any> : T extends 'function' ?
AnyFunction : T extends 'array' ?
ReturnArg<any[]> : any

type AnyType = 'string' | 'number' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' | 'array' | 'any'
type Any = {
  /**
   * Matches any argument (`Arg.any()`), or any argument of the given type: 'string', 'number', 'boolean', 'symbol',
   * 'undefined', 'object' (non-null objects, arrays and substitutes), 'function' (functions, classes and substitutes),
   * 'array' or 'any'.
   */
  <T extends AnyType = 'any'>(type?: T): MapAnyReturn<T>
}

const createAnyPredicate = (type: string): PredicateFunction<unknown> => {
  switch (type) {
    case 'any':
      return () => true
    case 'array':
      return x => Array.isArray(x)
    case 'object':
      // non-null objects (arrays included) and substitutes (which are function proxies)
      return x => (typeof x === 'object' && x !== null) || isSubstituteProxy(x)
    case 'function':
      // functions, which includes substitutes
      return x => typeof x === 'function'
    default:
      return x => typeof x === type
  }
}

// One predicate per type, so that two Arg.any('number') matchers are recognised as the same matcher.
const anyPredicates = new Map<string, PredicateFunction<unknown>>()
const anyPredicateFor = (type: string): PredicateFunction<unknown> => {
  let predicate = anyPredicates.get(type)
  if (predicate === undefined) {
    predicate = createAnyPredicate(type)
    anyPredicates.set(type, predicate)
  }
  return predicate
}

const anyFunction = (type: AnyType = 'any', options?: ArgumentOptions) => {
  const description = `Arg.any{${type}}`
  return new Argument(description, anyPredicateFor(type), options)
}

type ArgMatchers = {
  /**
   * Matches all arguments. As the only argument it matches any argument list: `calculator.add(Arg.all())`. After
   * leading arguments it matches the rest of the arguments, including none: `logger.log('saved', Arg.all())` matches
   * `log('saved')` and `log('saved', 1, 2)`. Nothing may follow it.
   */
  all: <T extends any[]>() => AllArguments<T>
  /**
   * Matches an argument for which the predicate returns a truthy value: `calculator.add(Arg.is(x => x > 10), 2)`.
   * `Arg.is.not(predicate)` matches where it returns a falsy value. A predicate that throws matches in neither form.
   */
  is: Inversable<Is>
  /**
   * Matches any argument (`Arg.any()`), or any argument of a type (`Arg.any('string')`): 'string', 'number',
   * 'boolean', 'symbol', 'undefined', 'object' (non-null objects, arrays and substitutes), 'function' (functions,
   * classes and substitutes), 'array' or 'any'. `Arg.any.not('string')` matches every argument that is not a string.
   */
  any: Inversable<Any>
}

/**
 * Argument matchers for setups and assertions: `Arg.any()`, `Arg.is(predicate)`, `Arg.all()` and their `.not` forms.
 * A call whose arguments contain a matcher is always a setup or an assertion, never a real call.
 */
export const Arg: ArgMatchers = {
  all: <T extends any[]>(): AllArguments<T> => new AllArguments<T>(),
  is: createInversable(isFunction) as Inversable<Is>,
  any: createInversable(anyFunction) as Inversable<Any>
}
