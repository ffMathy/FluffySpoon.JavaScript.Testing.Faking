import { AllArguments } from '../../shared'
import { ConfigurationResult, SubstitutionResult } from './SubstitutionLevel'
import { Equals, IsAny, IsNever } from './Utilities'

/**
 * What a call returns in each view of a substitute:
 * - `substitute`: the configured value intersected with the setup API (`sub.add(1, 2).returns(3)`)
 * - `configure`: the setup API only (`sub[configure]().add(1, 2).returns(3)`)
 * - `assertion`: nothing (`sub.received().add(1, 2)`)
 */
export type SubstituteView = 'substitute' | 'configure' | 'assertion'

type CallResult<TView extends SubstituteView, TArguments extends any[], TReturnType> =
  TView extends 'assertion' ? void :
  TView extends 'configure' ? ConfigurationResult<TReturnType, (...args: TArguments) => TReturnType> :
  SubstitutionResult<TReturnType, (...args: TArguments) => TReturnType>

type Overload<TArguments extends any[], TReturnType> = { arguments: TArguments, returnType: TReturnType }
// Not `undefined`: without strictNullChecks `undefined` would match `Overload`.
type NoOverload = { readonly noOverload: true }

// When a function has fewer overloads than the pattern below, the leading slots of the pattern receive no overload of
// their own: TypeScript <= 5.0 leaves them as `(...args: unknown[]) => unknown`, newer versions repeat the first
// overload. Inference pairs the signatures from the end, so the last slot always holds the last overload. A slot is
// skipped when it is empty or identical to the next slot. (A genuine `(...args: unknown[]) => unknown` overload that is
// not the last overload is indistinguishable from an empty slot and is skipped as well.)
type IsSameOverload<TArguments, TReturnType, TNextArguments, TNextReturnType> =
  Equals<TArguments, TNextArguments> extends true ? Equals<TReturnType, TNextReturnType> : false
type IsEmptySlot<TArguments, TReturnType> = IsSameOverload<TArguments, TReturnType, unknown[], unknown>
type Slot<TArguments, TReturnType, TNextArguments, TNextReturnType> = TArguments extends any[] ?
  (IsEmptySlot<TArguments, TReturnType> extends true ? NoOverload :
    IsSameOverload<TArguments, TReturnType, TNextArguments, TNextReturnType> extends true ? NoOverload :
    Overload<TArguments, TReturnType>) :
  NoOverload
type LastSlot<TArguments, TReturnType> = TArguments extends any[] ? Overload<TArguments, TReturnType> : NoOverload

/**
 * The overloads of a function type, as a fixed-length list of `Overload | NoOverload` (empty slots first), or only
 * `NoOverload` when the type is not callable.
 * The pattern uses method signatures, which TypeScript compares bivariantly even with `strictFunctionTypes`, so it
 * matches any function with 1 to 8 overloads in one step. Functions with more than 8 overloads keep their substitute
 * typing for the last 8 only (T:TY-11).
 * The checked type is intersected with `TFunction` itself so that TypeScript defers the check until `TFunction` is
 * known (an object type that merely contains a type parameter would be resolved eagerly, and wrongly).
 */
type Overloads<TFunction> = ({ substituteOverloads: TFunction } & TFunction) extends {
  substituteOverloads(...args: infer A1): infer R1
  substituteOverloads(...args: infer A2): infer R2
  substituteOverloads(...args: infer A3): infer R3
  substituteOverloads(...args: infer A4): infer R4
  substituteOverloads(...args: infer A5): infer R5
  substituteOverloads(...args: infer A6): infer R6
  substituteOverloads(...args: infer A7): infer R7
  substituteOverloads(...args: infer A8): infer R8
} ? [
  Slot<A1, R1, A2, R2>, Slot<A2, R2, A3, R3>, Slot<A3, R3, A4, R4>, Slot<A4, R4, A5, R5>,
  Slot<A5, R5, A6, R6>, Slot<A6, R6, A7, R7>, Slot<A7, R7, A8, R8>, LastSlot<A8, R8>
] :
  [NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload]

type PositionalSignature<TOverload, TView extends SubstituteView> = TOverload extends Overload<any[], any> ?
  (...args: TOverload['arguments']) => CallResult<TView, TOverload['arguments'], TOverload['returnType']> :
  {}

type AllArgumentsSignature<TOverload, TView extends SubstituteView> = TOverload extends Overload<any[], any> ?
  (allArguments: AllArguments<TOverload['arguments']>) => CallResult<TView, TOverload['arguments'], TOverload['returnType']> :
  {}

// All positional signatures come before the `Arg.all()` signatures, so a call with a single matcher
// (`Arg.any()`, `Arg.is(...)`) resolves against the real parameter lists first (T:TY-10).
type OverloadSignatures<TOverloads extends any[], TView extends SubstituteView> =
  PositionalSignature<TOverloads[0], TView> & PositionalSignature<TOverloads[1], TView> &
  PositionalSignature<TOverloads[2], TView> & PositionalSignature<TOverloads[3], TView> &
  PositionalSignature<TOverloads[4], TView> & PositionalSignature<TOverloads[5], TView> &
  PositionalSignature<TOverloads[6], TView> & PositionalSignature<TOverloads[7], TView> &
  AllArgumentsSignature<TOverloads[0], TView> & AllArgumentsSignature<TOverloads[1], TView> &
  AllArgumentsSignature<TOverloads[2], TView> & AllArgumentsSignature<TOverloads[3], TView> &
  AllArgumentsSignature<TOverloads[4], TView> & AllArgumentsSignature<TOverloads[5], TView> &
  AllArgumentsSignature<TOverloads[6], TView> & AllArgumentsSignature<TOverloads[7], TView>

/**
 * The call signatures a member of type `TFunction` has on a substitute, one pair per overload: the overload's own
 * parameter list, and a single `Arg.all()` argument. `{}` when `TFunction` is not callable.
 */
export type FunctionSubstitute<TFunction, TView extends SubstituteView = 'substitute'> =
  IsNever<TFunction> extends true ? {} :
  IsAny<TFunction> extends true ? (...args: any[]) => CallResult<TView, any[], any> :
  // Not `[TFunction] extends [(...args: any) => any]`: in its true branch TypeScript would add that signature to TFunction.
  OverloadSignatures<Overloads<TFunction>, TView>
