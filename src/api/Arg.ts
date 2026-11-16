import { inspect } from 'util'
import { Argument, AllArguments, ArgumentOptions, PredicateFunction, isSubstituteProxy } from '../shared'

type Inversable<T> = T & { not: T }
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
type Is = <T>(predicate: PredicateFunction<ExtractFirstArg<T>>) => ReturnArg<ExtractFirstArg<T>>

type MapAnyReturn<T> = T extends 'any' ?
ReturnArg<any> : T extends 'string' ?
ReturnArg<string> : T extends 'number' ?
ReturnArg<number> : T extends 'boolean' ?
ReturnArg<boolean> : T extends 'symbol' ?
ReturnArg<symbol> : T extends 'undefined' ?
ReturnArg<undefined> : T extends 'object' ?
ReturnArg<object> : T extends 'function' ?
ReturnArg<Function> : T extends 'array' ?
ReturnArg<any[]> : any

type AnyType = 'string' | 'number' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' | 'array' | 'any'
type Any = <T extends AnyType = 'any'>(type?: T) => MapAnyReturn<T>

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

export const Arg = {
  all: <T extends any[]>(): AllArguments<T> => new AllArguments<T>(),
  is: createInversable(isFunction) as Inversable<Is>,
  any: createInversable(anyFunction) as Inversable<Any>
}
