import { AllArguments } from '../../shared'
import { ConfigurationResult, SubstitutionResult } from './SubstitutionLevel'
import { Equals, IsAny, IsNever, Primitive } from './Utilities'

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

type NoOverloads = [NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload]

/**
 * The overloads of a function type, as a fixed-length list of `Overload | NoOverload` (empty slots first), or only
 * `NoOverload` when the type is not callable.
 * The pattern uses method signatures, which TypeScript compares bivariantly even with `strictFunctionTypes`, so it
 * matches any function with 1 to 8 overloads in one step. Functions with more than 8 overloads keep their substitute
 * typing for the last 8 only (T:TY-11).
 * The checked type is intersected with `TFunction` itself so that TypeScript defers the check until `TFunction` is
 * known (an object type that merely contains a type parameter would be resolved eagerly, and wrongly).
 * Primitives (also large unions of string literals, such as lib.dom's `AutoFill`) are never callable: they are ruled out
 * first, without distributing the pattern over the union (TD-8).
 */
type Overloads<TFunction> = [TFunction] extends [Primitive] ? NoOverloads :
  ({ substituteOverloads: TFunction } & TFunction) extends {
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
  NoOverloads

// `unknown` (not `{}`) when there is no signature, so that `FunctionSubstitute<...> & TValue` is exactly `TValue` for a
// member that is not callable: `{} & undefined` is `never` (TypeScript >= 4.8), which would drop `undefined` from an
// optional property in the assertion view (TD-7).
type PositionalSignature<TOverload, TView extends SubstituteView> = TOverload extends Overload<any[], any> ?
  (...args: TOverload['arguments']) => CallResult<TView, TOverload['arguments'], TOverload['returnType']> :
  unknown

// The `Arg.all()` signatures of an overload:
// - a single `Arg.all()` argument: `add(Arg.all())`;
// - `Arg.all()` after leading arguments (D14, TD-3): `add(1, Arg.all())`, `log('x', Arg.all())`. For every position `n`
//   from 1 to 6 at which the overload has a parameter (required, optional or rest), a signature takes the first `n`
//   parameters of the overload followed by `Arg.all()`. They are written out position by position because
//   TypeScript 3.6 has no variadic tuple types, so their parameters are named `arg0`, `arg1`, ...
//   The overload has a parameter at position `n` when one of its possible argument counts (`A['length']`: a number
//   literal, a union of them with optional parameters, or `number` with a rest parameter) is greater than `n`. The
//   nesting stops at the first position the overload does not have. (`A extends [any?]` would be shorter, but
//   TypeScript 4.0 and 4.1 consider `[string, number?]` assignable to `[any?]`.)
// (The return types are written inside each signature, where TypeScript only computes them when the signature is used.)
type AllArgumentsSignatures<TOverload, TView extends SubstituteView> = TOverload extends Overload<any[], any> ?
  ((allArguments: AllArguments<TOverload['arguments']>) => CallResult<TView, TOverload['arguments'], TOverload['returnType']>) &
  TrailingAllArgumentsSignatures<TOverload['arguments'], TOverload['returnType'], TView> :
  unknown

type TrailingAllArgumentsSignatures<A extends any[], R, V extends SubstituteView> = [Exclude<A['length'], 0 | 1>] extends [never] ? unknown :
  ((arg0: A[0], allArguments: AllArguments<A>) => CallResult<V, A, R>) & ([Exclude<A['length'], 0 | 1 | 2>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], allArguments: AllArguments<A>) => CallResult<V, A, R>) & ([Exclude<A['length'], 0 | 1 | 2 | 3>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], allArguments: AllArguments<A>) => CallResult<V, A, R>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], allArguments: AllArguments<A>) => CallResult<V, A, R>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], arg4: A[4], allArguments: AllArguments<A>) => CallResult<V, A, R>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5 | 6>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], arg4: A[4], arg5: A[5], allArguments: AllArguments<A>) => CallResult<V, A, R>))))))

// All positional signatures come before the `Arg.all()` signatures, so a call with a single matcher
// (`Arg.any()`, `Arg.is(...)`) resolves against the real parameter lists first (T:TY-10).
type OverloadSignatures<TOverloads extends any[], TView extends SubstituteView> =
  PositionalSignature<TOverloads[0], TView> & PositionalSignature<TOverloads[1], TView> &
  PositionalSignature<TOverloads[2], TView> & PositionalSignature<TOverloads[3], TView> &
  PositionalSignature<TOverloads[4], TView> & PositionalSignature<TOverloads[5], TView> &
  PositionalSignature<TOverloads[6], TView> & PositionalSignature<TOverloads[7], TView> &
  AllArgumentsSignatures<TOverloads[0], TView> & AllArgumentsSignatures<TOverloads[1], TView> &
  AllArgumentsSignatures<TOverloads[2], TView> & AllArgumentsSignatures<TOverloads[3], TView> &
  AllArgumentsSignatures<TOverloads[4], TView> & AllArgumentsSignatures<TOverloads[5], TView> &
  AllArgumentsSignatures<TOverloads[6], TView> & AllArgumentsSignatures<TOverloads[7], TView>

/**
 * The call signatures a member of type `TFunction` has on a substitute: per overload, the overload's own parameter list,
 * a single `Arg.all()` argument, and the leading parameters followed by `Arg.all()`. `unknown` when `TFunction` is not
 * callable.
 */
export type FunctionSubstitute<TFunction, TView extends SubstituteView = 'substitute'> =
  IsNever<TFunction> extends true ? unknown :
  IsAny<TFunction> extends true ? (...args: any[]) => CallResult<TView, any[], any> :
  // Not `[TFunction] extends [(...args: any) => any]`: in its true branch TypeScript would add that signature to TFunction.
  OverloadSignatures<Overloads<TFunction>, TView>
