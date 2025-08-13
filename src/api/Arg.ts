import { Argument, AllArguments, type ArgumentOptions, type PredicateFunction } from '../shared'

type Inversable<T> = T & { not: T }
type ExtractFirstArg<T> = T extends AllArguments<infer TArgs> ? TArgs[0] : T
type ReturnArg<T> = Argument<T> & T
const createInversable = <TArg, TReturn>(target: (arg: TArg, opt?: ArgumentOptions) => TReturn): Inversable<(arg: TArg) => TReturn> => {
  const inversable = (arg: TArg) => target(arg)
  inversable.not = (arg: TArg) => target(arg, { inverseMatch: true })
  return inversable
}

const toStringify = (obj: any) => {
  if (typeof obj.inspect === 'function') return obj.inspect()
  if (typeof obj.toString === 'function') return obj.toString()
  return obj
}
const isFunction = <T>(predicate: PredicateFunction<ExtractFirstArg<T>>, options?: ArgumentOptions) => new Argument(
  `Arg.is{${toStringify(predicate)}}`, predicate, options
)
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

const anyFunction = (type: AnyType = 'any', options?: ArgumentOptions) => {
  const description = `Arg.any{${type}}`
  const predicate = (x: any) => {
    switch (type) {
      case 'any':
        return true
      case 'array':
        return Array.isArray(x)
      default:
        return typeof x === type
    }
  }

  return new Argument(description, predicate, options)
}

export const Arg = {
  all: <T extends any[]>(): AllArguments<T> => new AllArguments<T>(),
  is: createInversable(isFunction) as Inversable<Is>,
  any: createInversable(anyFunction) as Inversable<Any>
}
