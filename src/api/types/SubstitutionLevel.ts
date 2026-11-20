import { constants } from '../../shared'
import { OverloadsMimicksFunction } from './FunctionSubstitute'
import { HasMember, LibraryMemberName } from './Utilities'

/**
 * Symbol form of `.returns(...)`: `sub.add(1, 2)[returns](3)`. Always available, also where the value has its own member
 * called `returns`.
 */
export const returns: typeof constants.CONTEXT.returns.symbol = constants.CONTEXT.returns.symbol
/** Symbol form of `.throws(...)`: `sub.divide(1, 0)[throws](new Error())`. */
export const throws: typeof constants.CONTEXT.throws.symbol = constants.CONTEXT.throws.symbol
/** Symbol form of `.resolves(...)`, offered on members that may return a promise: `sub.load()[resolves](value)`. */
export const resolves: typeof constants.CONTEXT.resolves.symbol = constants.CONTEXT.resolves.symbol
/** Symbol form of `.rejects(...)`, offered on members that may return a promise: `sub.load()[rejects](new Error())`. */
export const rejects: typeof constants.CONTEXT.rejects.symbol = constants.CONTEXT.rejects.symbol
/** Symbol form of `.mimicks(...)`: `sub.add(Arg.all())[mimicks]((a, b) => a + b)`. */
export const mimicks: typeof constants.CONTEXT.mimicks.symbol = constants.CONTEXT.mimicks.symbol

type OneArgumentRequiredFunction<TArgs, TReturnType> = (requiredInput: TArgs, ...restInputs: TArgs[]) => TReturnType
// `returns()` and `resolves()` configure `undefined` when called without a value: that is allowed whenever `undefined`
// is a valid value (`void`, `any`, `unknown`, `T | undefined`: Koa's `next().resolves()` for `Promise<any>`, R8FE-8,
// T58). A value type that does not accept `undefined` (and `never`, T:TY-12) still requires a value. (In generic code,
// where the check cannot be decided, both forms are offered and a call resolves to the one that requires a value.)
type ValueFunction<TValue> = undefined extends TValue ?
  (value?: TValue, ...restValues: TValue[]) => void :
  OneArgumentRequiredFunction<TValue, void>

type ReturnsFunction<TReturnType> = ValueFunction<TReturnType>
type ThrowsFunction = OneArgumentRequiredFunction<any, never>
// An implementation type whose `this` is an `OverloadsImplementation` stands for the calls of several overloads (see
// there); every other implementation type the typings build declares no `this`, which is then inferred as `unknown`.
type MimicksFunction<TImplementation> =
  TImplementation extends (this: infer TThis, ...args: any) => any ? MimicksFunctionFor<TThis, TImplementation> :
  OneArgumentRequiredFunction<TImplementation, void>
type MimicksFunctionFor<TThis, TImplementation> =
  TThis extends OverloadsImplementation<infer TOverloads, infer TReturnType> ? OverloadsMimicksFunction<TOverloads, TReturnType> :
  OneArgumentRequiredFunction<TImplementation, void>
/**
 * The `this` type of the implementation type of a setup that takes the calls of several overloads (`TOverloads`, as
 * `FunctionSubstitute` lists them), each with the value `TReturnType`: a single `Arg.all()` on an overloaded member
 * whose overloads return different types (R16FE-1, T80; see `OverloadsMimicksFunction`). The overloads are passed as
 * they are, so that what `.mimicks()` takes is only worked out when it is used, and in a function type, which costs
 * fewer type instantiations than an object type there.
 */
export type OverloadsImplementation<TOverloads, TReturnType> = {
  readonly '@fluffy-spoon/substitute:overloads-implementation': [TOverloads, TReturnType]
}
type ResolvesFunction<TResolved> = ValueFunction<TResolved>
type RejectsFunction = OneArgumentRequiredFunction<any, void>

// A value that may be a promise offers resolves/rejects, which configure a native promise (`resolves(x)` is
// `returns(Promise.resolve(x))`): a thenable (`Promise<T>`, `PromiseLike<T>`, also as part of a union such as `void |
// Promise<void>` or `T | Promise<T>`, R7FE-8, T52) of which a native promise of its value is a valid value. A thenable
// with members of its own does not offer them, as the promise they configure has no such members: a query builder that
// `extends PromiseLike<Row[]>` and has `where()` (R8TD-2, T55), and a subtype of `Promise` with members of its own
// (knex's `QueryBuilder`, ky's `ResponsePromise`, `CancellablePromise` with `cancel()`, R9-ADV-3, R9TD-3, T63), unless
// a native promise fits its other members (they are optional). A subtype of `Promise` without members of its own is
// a promise for this purpose (Prisma's `PrismaPromise<T>`, which only narrows `[Symbol.toStringTag]`).
// `null | undefined` are ignored: `Promise<T> | undefined` offers them as well. The value they take is what the
// promises of the union resolve to.
type PromiseValue<TReturnType> = NonNullable<TReturnType> extends infer TValue ? PromiseValueOf<TValue, TReturnType> : never
type PromiseValueOf<TValue, TReturnType> = TValue extends PromiseLike<infer U> ?
  (NativePromiseFits<TValue, U, TReturnType> extends true ? U : never) :
  never
type IsPromise<TReturnType> = true extends EachIsPromise<NonNullable<TReturnType>, TReturnType> ? true : false
type EachIsPromise<TValue, TReturnType> = TValue extends PromiseLike<infer U> ? NativePromiseFits<TValue, U, TReturnType> : false
type NativePromiseFits<TValue, U, TReturnType> =
  TValue extends Promise<any> ? ([Exclude<keyof TValue, keyof Promise<any>>] extends [never] ? true : NativePromiseOf<U, TReturnType>) :
  NativePromiseOf<U, TReturnType>
type NativePromiseOf<U, TReturnType> = Promise<U> extends TReturnType ? true : false

type SymbolSetupMethods<TReturnType, TImplementation> = {
  /**
   * Configures the value(s) to return. With several values, the calls return them in order and then keep returning
   * the last one.
   */
  [returns]: ReturnsFunction<TReturnType>
  /** Configures the error(s) to throw, in order; the last one keeps being thrown. */
  [throws]: ThrowsFunction
  /**
   * Configures implementation(s) to run instead. They receive the call's arguments and their result is returned; with
   * several implementations, the calls use them in order and then keep using the last one.
   */
  [mimicks]: MimicksFunction<TImplementation>
} & (IsPromise<TReturnType> extends true ? {
  /** Configures the value(s) the returned promise resolves to, in order; the last one is repeated. */
  [resolves]: ResolvesFunction<PromiseValue<TReturnType>>
  /** Configures the reason(s) the returned promise rejects with, in order; the last one is repeated. */
  [rejects]: RejectsFunction
} : {})

type StringReturns<TReturnType> = {
  /**
   * Configures the value(s) to return. With several values, the calls return them in order and then keep returning
   * the last one. `[returns]` is the symbol form.
   */
  returns: ReturnsFunction<TReturnType>
}
type StringThrows = {
  /** Configures the error(s) to throw, in order; the last one keeps being thrown. `[throws]` is the symbol form. */
  throws: ThrowsFunction
}
type StringMimicks<TImplementation> = {
  /**
   * Configures implementation(s) to run instead. They receive the call's arguments and their result is returned; with
   * several implementations, the calls use them in order and then keep using the last one. `[mimicks]` is the symbol
   * form.
   */
  mimicks: MimicksFunction<TImplementation>
}
type StringResolves<TResolved> = {
  /** Configures the value(s) the returned promise resolves to, in order; the last one is repeated. `[resolves]` is the symbol form. */
  resolves: ResolvesFunction<TResolved>
}
type StringRejects = {
  /** Configures the reason(s) the returned promise rejects with, in order; the last one is repeated. `[rejects]` is the symbol form. */
  rejects: RejectsFunction
}

type StringSetupMethods<TReturnType, TImplementation> =
  StringReturns<TReturnType> & StringThrows & StringMimicks<TImplementation> &
  (IsPromise<TReturnType> extends true ? StringResolves<PromiseValue<TReturnType>> & StringRejects : {})

// The string form of a setup method is offered only when the value it is accessed on has no member with that name.
// Otherwise `value.returns` would be the value's own member (the symbol form `value[returns]` always works).
// `TCheck` is `NonNullable<TReturnType> & {}`. The check is distributive over it, so that TypeScript resolves the check
// for a type parameter through the parameter's constraint, and the `& {}` gives an unconstrained type parameter the
// constraint `{}`, which has no conflicting member: in generic code all string forms are offered (TD-2, T26). The method
// type itself is computed from the whole value type, so a union return type does not split the method (T:TY-1).
type StringForm<TCheck, TName extends LibraryMemberName, TMethod> = TCheck extends unknown ?
  (HasMember<TCheck, TName> extends true ? {} : TMethod) :
  never

type CheckedStringSetupMethods<TReturnType, TImplementation> =
  StringForm<NonNullable<TReturnType> & {}, 'returns', StringReturns<TReturnType>> &
  StringForm<NonNullable<TReturnType> & {}, 'throws', StringThrows> &
  StringForm<NonNullable<TReturnType> & {}, 'mimicks', StringMimicks<TImplementation>> &
  (IsPromise<TReturnType> extends true ? (
    StringForm<NonNullable<TReturnType> & {}, 'resolves', StringResolves<PromiseValue<TReturnType>>> &
    StringForm<NonNullable<TReturnType> & {}, 'rejects', StringRejects>
  ) : {})

/**
 * The setup API offered on the result of a member access or call of a substitute: the symbol forms, plus each string
 * form unless the value has a member with that name.
 * `TReturnType` is the member's value (or return) type, `TImplementation` the function type `mimicks` accepts (or one
 * whose `this` is an `OverloadsImplementation`).
 * `TReturnType` must not be `never`, `null` or `undefined` (see `SubstitutionResult`).
 */
export type SetupMethods<TReturnType, TImplementation> =
  SymbolSetupMethods<TReturnType, TImplementation> & CheckedStringSetupMethods<TReturnType, TImplementation>

/** The setup API without name-conflict checks, used where the value itself is not exposed (`[configure]()`). */
export type UncheckedSetupMethods<TReturnType, TImplementation> =
  SymbolSetupMethods<TReturnType, TImplementation> & StringSetupMethods<TReturnType, TImplementation>

/**
 * The type of a call on a substitute: the returned value intersected with the setup API.
 * `null` and `undefined` cannot carry the setup API, so they are dropped from the value part (T:TY-9), while the
 * setup methods still accept them. When nothing is left (`null`, `undefined`, `void`-like or `never`), only the setup
 * API remains. For `never` (a member that always throws) `returns` accepts no value (T:TY-12), so only `throws` and
 * `mimicks` can be used.
 * There is deliberately no separate branch for `never`: for a return type that is a type parameter (generic code) the
 * check cannot be decided, and TypeScript then only offers the members that all branches have (TD-2, T26).
 */
export type SubstitutionResult<TReturnType, TImplementation> =
  [NonNullable<TReturnType>] extends [never] ? UncheckedSetupMethods<TReturnType, TImplementation> :
  NonNullable<TReturnType> & SetupMethods<TReturnType, TImplementation>

/** The type of a member access or call on the `[configure]()` view: only the setup API. */
export type ConfigurationResult<TReturnType, TImplementation> = UncheckedSetupMethods<TReturnType, TImplementation>
