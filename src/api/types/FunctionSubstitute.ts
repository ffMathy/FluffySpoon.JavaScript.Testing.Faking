import { AllArguments } from '../../shared'
import { ConfigurationResult, SubstitutionResult } from './SubstitutionLevel'
import { Equals, IsAny, ObjectKind, Primitive } from './Utilities'

/**
 * What a call returns in each view of a substitute:
 * - `substitute`: the configured value intersected with the setup API (`sub.add(1, 2).returns(3)`)
 * - `configure`: the setup API only (`sub[configure]().add(1, 2).returns(3)`)
 * - `assertion`: nothing (`sub.received().add(1, 2)`)
 */
export type SubstituteView = 'substitute' | 'configure' | 'assertion'

type SetupResult<TView extends SubstituteView, TArguments extends any[], TReturnType> =
  TView extends 'configure' ? ConfigurationResult<TReturnType, (...args: TArguments) => TReturnType> :
  SubstitutionResult<TReturnType, (...args: TArguments) => TReturnType>

// The result of a call of the overload at position `TSlot` (an index into `Overloads`) of a variant of the member
// type `TFunction`.
// A concrete union of function types is expanded per variant (see `EachSignatures`), so that each variant's overloads
// keep their own parameters. Their setup API must take the value of any variant, though (T39, R4TD-1): for `Cat | Dog`
// with `speak(): 'meow'` and `speak(): 'woof'`, a call would return `SubstitutionResult<'meow'> |
// SubstitutionResult<'woof'>`, whose `.returns()` takes only what both accept (`never`). So when the variants'
// overloads at this position return different types, every variant's call result is computed from the union of those
// return types instead: `.returns()` takes `'meow' | 'woof'`, and `.resolves()`, `.mimicks()` and the configure view
// likewise.
// The choice is an indexed access, as for the kinds in Utilities.ts: `SlotKind` is `'slot'` when this overload's
// return type covers the union (always so for a type that is not a union) and `any` otherwise, which selects the number
// index signature. In generic code, where `TFunction` is a type parameter, TypeScript cannot decide it and uses
// `'slot'`: the return type of the constraint's overload (T33). Being part of the signature's return type, all of this
// is only computed for the calls that are made.
type CallResult<TView extends SubstituteView, TArguments extends any[], TReturnType, TFunction, TSlot extends number> =
  TView extends 'assertion' ? void : {
    slot: SetupResult<TView, TArguments, TReturnType>
    [union: number]: SetupResult<TView, TArguments, SlotReturnTypes<TFunction, TSlot>>
  }[SlotKind<TFunction, TSlot, TReturnType>]

// The return types of the overloads at position `TSlot` of the variants of `TFunction`.
type SlotReturnTypes<TFunction, TSlot extends number> =
  TFunction extends unknown ? Overloads<TFunction>[TSlot]['returnType'] : never
type SlotKind<TFunction, TSlot extends number, TReturnType> =
  [SlotReturnTypes<TFunction, TSlot>] extends [TReturnType] ? 'slot' : any

type Overload<TArguments extends any[], TReturnType> = { arguments: TArguments, returnType: TReturnType }
// Not `undefined`: without strictNullChecks `undefined` would match `Overload`. Its `returnType` is `never`, so that
// `SlotReturnTypes` can read the return type of any slot.
type NoOverload = { readonly noOverload: true, readonly returnType: never }

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
type PositionalSignature<TOverload, TView extends SubstituteView, TFunction, TSlot extends number> =
  TOverload extends Overload<any[], any> ?
  (...args: TOverload['arguments']) => CallResult<TView, TOverload['arguments'], TOverload['returnType'], TFunction, TSlot> :
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
type AllArgumentsSignatures<TOverload, TView extends SubstituteView, TFunction, TSlot extends number> =
  TOverload extends Overload<any[], any> ?
  ((allArguments: AllArguments<TOverload['arguments']>) => CallResult<TView, TOverload['arguments'], TOverload['returnType'], TFunction, TSlot>) &
  TrailingAllArgumentsSignatures<TOverload['arguments'], TOverload['returnType'], TView, TFunction, TSlot> :
  unknown

type TrailingAllArgumentsSignatures<A extends any[], R, V extends SubstituteView, F, S extends number> = [Exclude<A['length'], 0 | 1>] extends [never] ? unknown :
  ((arg0: A[0], allArguments: AllArguments<A>) => CallResult<V, A, R, F, S>) & ([Exclude<A['length'], 0 | 1 | 2>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], allArguments: AllArguments<A>) => CallResult<V, A, R, F, S>) & ([Exclude<A['length'], 0 | 1 | 2 | 3>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], allArguments: AllArguments<A>) => CallResult<V, A, R, F, S>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], allArguments: AllArguments<A>) => CallResult<V, A, R, F, S>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], arg4: A[4], allArguments: AllArguments<A>) => CallResult<V, A, R, F, S>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5 | 6>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], arg4: A[4], arg5: A[5], allArguments: AllArguments<A>) => CallResult<V, A, R, F, S>))))))

// All positional signatures come before the `Arg.all()` signatures, so a call with a single matcher
// (`Arg.any()`, `Arg.is(...)`) resolves against the real parameter lists first (T:TY-10).
// `TFunction` is the whole member type (see `CallResult`).
type OverloadSignatures<TOverloads extends any[], TView extends SubstituteView, TFunction> =
  PositionalSignature<TOverloads[0], TView, TFunction, 0> & PositionalSignature<TOverloads[1], TView, TFunction, 1> &
  PositionalSignature<TOverloads[2], TView, TFunction, 2> & PositionalSignature<TOverloads[3], TView, TFunction, 3> &
  PositionalSignature<TOverloads[4], TView, TFunction, 4> & PositionalSignature<TOverloads[5], TView, TFunction, 5> &
  PositionalSignature<TOverloads[6], TView, TFunction, 6> & PositionalSignature<TOverloads[7], TView, TFunction, 7> &
  AllArgumentsSignatures<TOverloads[0], TView, TFunction, 0> & AllArgumentsSignatures<TOverloads[1], TView, TFunction, 1> &
  AllArgumentsSignatures<TOverloads[2], TView, TFunction, 2> & AllArgumentsSignatures<TOverloads[3], TView, TFunction, 3> &
  AllArgumentsSignatures<TOverloads[4], TView, TFunction, 4> & AllArgumentsSignatures<TOverloads[5], TView, TFunction, 5> &
  AllArgumentsSignatures<TOverloads[6], TView, TFunction, 6> & AllArgumentsSignatures<TOverloads[7], TView, TFunction, 7>

// The signatures of `TVariant`, one non-primitive variant of the member type `TFunction`. (Not
// `[TVariant] extends [(...args: any) => any]`: in its true branch TypeScript would add that signature to TVariant.)
type SignaturesOf<TVariant, TView extends SubstituteView, TFunction> =
  OverloadSignatures<Overloads<TVariant>, TView, TFunction>

// Distributive over `TVariant`, so that in generic code (a member type such as `T['add']` with `T extends Calculator`)
// TypeScript computes the signatures from the constraint (`Calculator['add']`) when the member is called (T33). A
// concrete union of function types is expanded per variant as well (matching the whole union against the overload
// pattern is much slower for large unions, such as the methods of all lib.dom elements); `TFunction` passes the whole
// member type on to the call results (see `CallResult`).
type EachSignatures<TVariant, TView extends SubstituteView, TFunction> =
  TVariant extends unknown ? SignaturesOf<TVariant, TView, TFunction> : never

// Primitives, `never` and `any` are ruled out without distributing over a (possibly very large) union of literals
// (TD-8). Their branch is `any` for `any` (a member typed `any` stays `any`) and `never` otherwise: in generic code
// TypeScript cannot decide the check and uses the union of both branches, where `never` drops out, and an `any` branch
// is left out as well (see `ObjectKind`).
type GuardedSignatures<TFunction, TView extends SubstituteView> =
  [TFunction] extends [Primitive] ? (IsAny<TFunction> extends true ? any : never) :
  EachSignatures<TFunction, TView, TFunction>

type FunctionSubstituteOf<TKind, TFunction, TView extends SubstituteView> =
  TKind extends 'object' ? GuardedSignatures<TFunction, TView> : unknown

/**
 * The call signatures a member of type `TFunction` has on a substitute: per overload, the overload's own parameter list,
 * a single `Arg.all()` argument, and the leading parameters followed by `Arg.all()`. `unknown` when `TFunction` is not
 * callable, `any` when it is `any`.
 * In generic code the signatures are computed from the constraint of the member type, so that
 * `sub.add(1, 2).returns(3)` type-checks on a `SubstituteOf<T>` with `T extends Calculator` (T33).
 */
export type FunctionSubstitute<TFunction, TView extends SubstituteView = 'substitute'> =
  FunctionSubstituteOf<ObjectKind<TFunction>, TFunction, TView>

// The assertion view of a callable member also checks the call arguments; for a property it is only the property's
// type. `'call'` or `'plain'` per non-primitive member of the union (see `AssertionMember`).
type EachCallKind<TFunction> = TFunction extends (...args: any[]) => any ? 'call' : 'plain'
type GuardedCallKind<TFunction> = [TFunction] extends [Primitive] ? never : EachCallKind<TFunction>

/**
 * `'call'` when `TFunction` (a member type without `null | undefined`) is callable, otherwise `'plain'`. In generic
 * code it is decided by the member's constraint.
 */
export type CallKind<TFunction> = CallKindOf<ObjectKind<TFunction>, TFunction>
type CallKindOf<TKind, TFunction> = TKind extends 'object' ? GuardedCallKind<TFunction> : 'plain'
