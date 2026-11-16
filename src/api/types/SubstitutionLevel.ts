import { constants } from '../../shared'
import { HasMember, LibraryMemberName } from './Utilities'

export const returns: typeof constants.CONTEXT.returns.symbol = constants.CONTEXT.returns.symbol
export const throws: typeof constants.CONTEXT.throws.symbol = constants.CONTEXT.throws.symbol
export const resolves: typeof constants.CONTEXT.resolves.symbol = constants.CONTEXT.resolves.symbol
export const rejects: typeof constants.CONTEXT.rejects.symbol = constants.CONTEXT.rejects.symbol
export const mimicks: typeof constants.CONTEXT.mimicks.symbol = constants.CONTEXT.mimicks.symbol

type OneArgumentRequiredFunction<TArgs, TReturnType> = (requiredInput: TArgs, ...restInputs: TArgs[]) => TReturnType

type ReturnsFunction<TReturnType> = OneArgumentRequiredFunction<TReturnType, void>
type ThrowsFunction = OneArgumentRequiredFunction<any, never>
type MimicksFunction<TImplementation> = OneArgumentRequiredFunction<TImplementation, void>
type ResolvesFunction<TResolved> = OneArgumentRequiredFunction<TResolved, void>
type RejectsFunction = OneArgumentRequiredFunction<any, void>

// `null | undefined` are ignored when deciding whether the value is a promise or has a conflicting member:
// `Promise<T> | undefined` still offers resolves/rejects. The check is not distributive (see T:TY-1).
type PromiseValue<TReturnType> = [NonNullable<TReturnType>] extends [Promise<infer U>] ? U : never
type IsPromise<TReturnType> = [NonNullable<TReturnType>] extends [never] ? false :
  [NonNullable<TReturnType>] extends [Promise<any>] ? true : false

type SymbolSetupMethods<TReturnType, TImplementation> = {
  [returns]: ReturnsFunction<TReturnType>
  [throws]: ThrowsFunction
  [mimicks]: MimicksFunction<TImplementation>
} & (IsPromise<TReturnType> extends true ? {
  [resolves]: ResolvesFunction<PromiseValue<TReturnType>>
  [rejects]: RejectsFunction
} : {})

type StringSetupMethods<TReturnType, TImplementation> = {
  returns: ReturnsFunction<TReturnType>
  throws: ThrowsFunction
  mimicks: MimicksFunction<TImplementation>
} & (IsPromise<TReturnType> extends true ? {
  resolves: ResolvesFunction<PromiseValue<TReturnType>>
  rejects: RejectsFunction
} : {})

// The string form of a setup method is offered only when the value it is accessed on has no member with that name.
// Otherwise `value.returns` would be the value's own member (the symbol form `value[returns]` always works).
// `TValue` is checked per union member (so that a constrained type parameter is resolved through its constraint), but the
// method type is computed from the whole value type, so a union return type does not split the method (T:TY-1).
type StringForm<TValue, TName extends LibraryMemberName, TMethod> = TValue extends unknown ?
  (HasMember<TValue, TName> extends true ? {} : { [P in TName]: TMethod }) :
  never

type CheckedStringSetupMethods<TReturnType, TImplementation> =
  StringForm<NonNullable<TReturnType>, 'returns', ReturnsFunction<TReturnType>> &
  StringForm<NonNullable<TReturnType>, 'throws', ThrowsFunction> &
  StringForm<NonNullable<TReturnType>, 'mimicks', MimicksFunction<TImplementation>> &
  (IsPromise<TReturnType> extends true ? (
    StringForm<NonNullable<TReturnType>, 'resolves', ResolvesFunction<PromiseValue<TReturnType>>> &
    StringForm<NonNullable<TReturnType>, 'rejects', RejectsFunction>
  ) : {})

// A member that never returns can only throw (or mimick an implementation that throws).
type NeverSetupMethods<TImplementation> = {
  [throws]: ThrowsFunction
  [mimicks]: MimicksFunction<TImplementation>
  throws: ThrowsFunction
  mimicks: MimicksFunction<TImplementation>
}

/**
 * The setup API offered on the result of a member access or call of a substitute.
 * `TReturnType` is the member's value (or return) type, `TImplementation` the function type `mimicks` accepts.
 * `TReturnType` must not be `never`, `null` or `undefined` (see `SubstitutionResult`).
 */
type SetupMethods<TReturnType, TImplementation> =
  SymbolSetupMethods<TReturnType, TImplementation> & CheckedStringSetupMethods<TReturnType, TImplementation>

/** The setup API without name-conflict checks, used where the value itself is not exposed (`[configure]()`). */
export type UncheckedSetupMethods<TReturnType, TImplementation> =
  SymbolSetupMethods<TReturnType, TImplementation> & StringSetupMethods<TReturnType, TImplementation>

/**
 * The type of a member access or call on a substitute: the value intersected with the setup API.
 * `null` and `undefined` cannot carry the setup API, so they are dropped from the value part (T:TY-9), while the
 * setup methods still accept them. `never` (a member that always throws) only offers `throws` and `mimicks` (T:TY-12).
 */
export type SubstitutionResult<TReturnType, TImplementation> =
  [TReturnType] extends [never] ? NeverSetupMethods<TImplementation> :
  [NonNullable<TReturnType>] extends [never] ? UncheckedSetupMethods<TReturnType, TImplementation> :
  NonNullable<TReturnType> & SetupMethods<TReturnType, TImplementation>

/** The type of a member access or call on the `[configure]()` view: only the setup API. */
export type ConfigurationResult<TReturnType, TImplementation> =
  [TReturnType] extends [never] ? NeverSetupMethods<TImplementation> :
  UncheckedSetupMethods<TReturnType, TImplementation>
