import { AllArguments } from '../../shared'
import { ConfigurationResult, SubstitutionResult } from './SubstitutionLevel'
import { Equals, IsAny, ObjectKind, Primitive, UnionToIntersection } from './Utilities'

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

// The result of a call of an overload (parameters `TArguments`, return type `TReturnType`) of a member type that is
// not a union (also in generic code): `TFunction` is `never`, and the call returns what the overload returns.
// For a concrete union `TFunction` is the whole member type, whose variants' signatures are all combined (see
// `CombinedSignatures`), and `TReturnType` is `unknown`. Whichever of them a call resolves to, the value it returns at
// run time is that of the variant the substitute stands in for, so its setup API takes the value of any variant whose
// overloads the call can reach (T39, R4TD-1; T42, R5TD-1): for `Cat | Dog` with `speak(): 'meow'` and `speak():
// 'woof'`, `.returns()` takes `'meow' | 'woof'`, and for `ReaderA | ReaderB` with `read(path: string): string` and
// `read(path: string, encoding?: string): Uint8Array`, `read('p').returns()` takes `string | Uint8Array`.
// `.resolves()`, `.mimicks()` and the configure view likewise. Being part of the signature's return type, this is only
// computed for the calls that are made (and when signatures are compared).
type CallResult<TView extends SubstituteView, TArguments extends any[], TReturnType, TFunction> =
  TView extends 'assertion' ? void : SetupResult<TView, TArguments, CallReturnType<TFunction, TArguments, TReturnType>>
type CallReturnType<TFunction, TArguments, TReturnType> =
  [TFunction] extends [never] ? TReturnType : UnionReturnType<TFunction, TArguments>

// When every overload of every variant returns the same type (all `void`, say), or one returns `any`, that is the
// answer, without looking at the parameters. Otherwise it is the union of `UnionReturnTypes`. The choice is an indexed
// access, as for the kinds in Utilities.ts (`ReturnsKind` is `'same'` or `any`, which selects the number index
// signature): where a return type involves a type parameter (`(() => T) | (() => string)` in `Box<T>`), TypeScript
// cannot decide it and uses `'same'`, the union of all return types. The index signature's type is only an object
// type whose property is computed when it is selected.
type UnionReturnType<TFunction, TArguments> = {
  same: { returnType: AllReturnTypes<TFunction> }
  [differs: number]: { returnType: UnionReturnTypes<TFunction, TArguments> }
}[ReturnsKind<TFunction, AllReturnTypes<TFunction>>]['returnType']
type AllReturnTypes<TFunction> = TFunction extends unknown ? ReturnTypeOf<Overloads<TFunction>[number]> : never
type ReturnTypeOf<TOverload> = TOverload extends Overload<any[], infer R> ? R : never
type ReturnsKind<TFunction, TAllReturnTypes> = false extends EachReturnsAll<TFunction, TAllReturnTypes> ? any : 'same'
type EachReturnsAll<TVariant, TAllReturnTypes> =
  TVariant extends unknown ? ReturnsAll<Overloads<TVariant>[number], TAllReturnTypes> : never
type ReturnsAll<TOverload, TAllReturnTypes> =
  TOverload extends Overload<any[], infer R> ? ([TAllReturnTypes] extends [R] ? true : false) : never

// The return types that a call with the parameters `TArguments` can reach, per variant of `TFunction`:
// - the overload(s) with the same parameters, when the variant has one: the call resolves to it in that variant too.
//   This is always so for the variant the signature comes from, which keeps the return type of each of its overloads;
// - otherwise every overload that some call with these parameters could also match: the numbers of arguments the two
//   parameter lists take overlap, and with every parameter optional, one list accepts the other (`fetch(url)` and
//   `fetch(url, options?)`, `pet(where: 'head')` and `pet(where: 'head' | 'belly')`, `m(x?: string)` and
//   `m(x: string, y?: number)`, `id<T>(x: T)` and `id(x: string)`). Parameter types that merely overlap in another way
//   (`'a' | 'b'` and `'b' | 'c'`) do not count. Both directions are needed: TypeScript picks the first matching
//   signature of all variants, and their order is not the declaration order.
// "The same parameters" means mutually assignable parameter lists (the same method declared in two interfaces has
// parameter lists that are equal but not identical types).
type UnionReturnTypes<TFunction, TArguments> =
  TFunction extends unknown ? VariantReturnTypes<OverloadMatches<Overloads<TFunction>[number], TArguments>> : never
type OverloadMatches<TOverload, TArguments> = TOverload extends Overload<infer A, infer R> ?
  ([TArguments] extends [A] ? ([A] extends [TArguments] ? { same: R } : ApplicableMatch<TArguments, A, R>) :
    ApplicableMatch<TArguments, A, R>) :
  never
type ApplicableMatch<TArguments, A, R> = true extends LengthsOverlap<TArguments, A> ?
  ([Partial<TArguments>] extends [Partial<A>] ? { applicable: R } : [Partial<A>] extends [Partial<TArguments>] ? { applicable: R } : never) :
  never
// `number` is the length of a parameter list with a rest parameter.
type LengthsOverlap<TArguments, A> =
  number extends LengthOf<TArguments> ? true : number extends LengthOf<A> ? true :
  [Extract<LengthOf<TArguments>, LengthOf<A>>] extends [never] ? false : true
type LengthOf<T> = T extends any[] ? T['length'] : never
type VariantReturnTypes<TMatches> =
  [Extract<TMatches, { same: unknown }>] extends [never] ? ApplicableReturnTypes<TMatches> : SameReturnTypes<TMatches>
type SameReturnTypes<TMatches> = TMatches extends { same: infer R } ? R : never
type ApplicableReturnTypes<TMatches> = TMatches extends { applicable: infer R } ? R : never

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
// Not distributive: a parameter list that is a union of lists (a generic rest parameter erased to its constraint, as in
// `emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>)`) stays one overload, whose positional
// signature checks the arguments against the whole union (R6FE-7, T46).
type Slot<TArguments, TReturnType, TNextArguments, TNextReturnType> = [TArguments] extends [any[]] ?
  (IsEmptySlot<TArguments, TReturnType> extends true ? NoOverload :
    IsSameOverload<TArguments, TReturnType, TNextArguments, TNextReturnType> extends true ? NoOverload :
    Overload<Extract<TArguments, any[]>, TReturnType>) :
  NoOverload
type LastSlot<TArguments, TReturnType> = [TArguments] extends [any[]] ? Overload<Extract<TArguments, any[]>, TReturnType> : NoOverload

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
  TFunction extends new (...args: infer A) => infer R ? ConstructOverloads<TFunction, A, R> :
  NoOverloads

// A type with construct signatures but no call signatures (a class, `new (url: string) => ApiClient`): the overloads
// of its construct signatures (R6FE-3, T47). At run time `new` on a substitute or a member is recorded and answered
// like a call (E23), so the substitute offers call signatures with these parameters, whose setup API takes the
// instance a `new` gives (`Client('u').returns(client)`, `Client.received(1)('u')`), next to the construct signatures
// of `T` itself. The pattern below cannot use method signatures, which TypeScript compares bivariantly, so on
// TypeScript 5.0 and older, which fill the slots of missing overloads with `new (...args: unknown[]) => unknown`, it
// only matches constructors with 8 overloads; there only the last construct signature (`A`, `R`) is taken.
type ConstructOverloads<TFunction, A, R> = AllConstructOverloads<TFunction> extends NoOverloads ?
  [NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, LastSlot<A, R>] :
  AllConstructOverloads<TFunction>
type AllConstructOverloads<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads: {
      new (...args: infer A1): infer R1
      new (...args: infer A2): infer R2
      new (...args: infer A3): infer R3
      new (...args: infer A4): infer R4
      new (...args: infer A5): infer R5
      new (...args: infer A6): infer R6
      new (...args: infer A7): infer R7
      new (...args: infer A8): infer R8
    }
  } ? [
    Slot<A1, R1, A2, R2>, Slot<A2, R2, A3, R3>, Slot<A3, R3, A4, R4>, Slot<A4, R4, A5, R5>,
    Slot<A5, R5, A6, R6>, Slot<A6, R6, A7, R7>, Slot<A7, R7, A8, R8>, LastSlot<A8, R8>
  ] :
  NoOverloads

// `unknown` (not `{}`) when there is no signature, so that `FunctionSubstitute<...> & TValue` is exactly `TValue` for a
// member that is not callable: `{} & undefined` is `never` (TypeScript >= 4.8), which would drop `undefined` from an
// optional property in the assertion view (TD-7).
type PositionalSignature<TOverload, TView extends SubstituteView, TFunction> =
  TOverload extends Overload<any[], any> ?
  PositionalSignatureOf<TOverload['arguments'], TOverload['returnType'], TView, TFunction> :
  unknown
type PositionalSignatureOf<A extends any[], R, V extends SubstituteView, F> = (...args: A) => CallResult<V, A, R, F>

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
type AllArgumentsSignatures<TOverload, TView extends SubstituteView, TFunction> =
  TOverload extends Overload<any[], any> ?
  AllArgumentsSignaturesFor<TOverload['arguments'], TOverload['returnType'], TView, TFunction> :
  unknown
type AllArgumentsSignaturesFor<A extends any[], R, V extends SubstituteView, F> =
  ((allArguments: AllArguments<A>) => CallResult<V, A, R, F>) & TrailingAllArgumentsSignatures<A, R, V, F>

type TrailingAllArgumentsSignatures<A extends any[], R, V extends SubstituteView, F> = [Exclude<A['length'], 0 | 1>] extends [never] ? unknown :
  ((arg0: A[0], allArguments: AllArguments<A>) => CallResult<V, A, R, F>) & ([Exclude<A['length'], 0 | 1 | 2>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], allArguments: AllArguments<A>) => CallResult<V, A, R, F>) & ([Exclude<A['length'], 0 | 1 | 2 | 3>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], allArguments: AllArguments<A>) => CallResult<V, A, R, F>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], allArguments: AllArguments<A>) => CallResult<V, A, R, F>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], arg4: A[4], allArguments: AllArguments<A>) => CallResult<V, A, R, F>) & ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5 | 6>] extends [never] ? unknown :
  ((arg0: A[0], arg1: A[1], arg2: A[2], arg3: A[3], arg4: A[4], arg5: A[5], allArguments: AllArguments<A>) => CallResult<V, A, R, F>))))))

// `TFunction` is the whole member type (see `CallResult`).
type PositionalSignatures<TOverloads extends any[], TView extends SubstituteView, TFunction> =
  PositionalSignature<TOverloads[0], TView, TFunction> & PositionalSignature<TOverloads[1], TView, TFunction> &
  PositionalSignature<TOverloads[2], TView, TFunction> & PositionalSignature<TOverloads[3], TView, TFunction> &
  PositionalSignature<TOverloads[4], TView, TFunction> & PositionalSignature<TOverloads[5], TView, TFunction> &
  PositionalSignature<TOverloads[6], TView, TFunction> & PositionalSignature<TOverloads[7], TView, TFunction>
type AllArgumentsSignaturesOf<TOverloads extends any[], TView extends SubstituteView, TFunction> =
  AllArgumentsSignatures<TOverloads[0], TView, TFunction> & AllArgumentsSignatures<TOverloads[1], TView, TFunction> &
  AllArgumentsSignatures<TOverloads[2], TView, TFunction> & AllArgumentsSignatures<TOverloads[3], TView, TFunction> &
  AllArgumentsSignatures<TOverloads[4], TView, TFunction> & AllArgumentsSignatures<TOverloads[5], TView, TFunction> &
  AllArgumentsSignatures<TOverloads[6], TView, TFunction> & AllArgumentsSignatures<TOverloads[7], TView, TFunction>

// All positional signatures come before the `Arg.all()` signatures, so a call with a single matcher
// (`Arg.any()`, `Arg.is(...)`) resolves against the real parameter lists first (T:TY-10).
type OverloadSignatures<TOverloads extends any[], TView extends SubstituteView, TFunction> =
  PositionalSignatures<TOverloads, TView, TFunction> & AllArgumentsSignaturesOf<TOverloads, TView, TFunction>

// The signatures of `TVariant`, one non-primitive variant of the member type `TFunction`. (Not
// `[TVariant] extends [(...args: any) => any]`: in its true branch TypeScript would add that signature to TVariant.)
type SignaturesOf<TVariant, TView extends SubstituteView, TFunction> =
  OverloadSignatures<Overloads<TVariant>, TView, TFunction> & GenericCallSignature<TVariant, Overloads<TVariant>, TView>

// Generic methods (R6FE-7, T46): `Overloads` sees a generic signature with its type parameters replaced by their
// constraints, so `get<K extends keyof Config>(key: K): Config[K]` becomes `get(key: keyof Config): Config[keyof
// Config]`, and `emit<K>(eventName: Key<K, T>, ...args: Args<K, T>)` of Node's `EventEmitter<T>` has no possible
// arguments at all (`Args<unknown, T>` is `never`). A member with a single signature that is generic therefore also
// gets the signature below, after all others. It takes any arguments with which the member itself can be called, as
// TypeScript checks them against the member's own (generic) signatures, and its result takes what the member returns
// for them (with the type parameters replaced by their constraints, which is all TypeScript infers here). Coming before
// the member's own signatures (`SubstituteOf<T>` intersects the member with `T`), it is also what calls with `any`
// arguments (`Arg.any()`) resolve to: TypeScript first tries the signatures with the subtype relation, under which
// `any` fits a type parameter, but no other parameter type. (Overloaded members do not get it: there TypeScript takes
// the return type of the last overload, and `any` arguments resolve to the first overload that accepts them.)
type GenericCallSignature<F, TOverloads extends any[], V extends SubstituteView> =
  F extends (...args: any) => any ? GenericCallSignatureOf<F, TOverloads, V> : unknown
type GenericCallSignatureOf<F, TOverloads extends any[], V extends SubstituteView> =
  IsGenericSignature<F, TOverloads> extends true ?
  <P extends ArgumentValue[]>(...args: P & CallableWith<F, P>) => CallResult<V, P, CallReturnTypeOf<F, P>, never> :
  unknown
// `true` for a function type with a single call signature that is not the same as the signature `Overloads` sees, i.e.
// a generic one (also, harmlessly, a callable type with other members).
type IsGenericSignature<F, TOverloads extends any[]> =
  TOverloads[6] extends NoOverload ? (TOverloads[7] extends Overload<any[], any> ?
    (Equals<F, (...args: TOverloads[7]['arguments']) => TOverloads[7]['returnType']> extends true ? false : true) :
    false) :
  false
// Includes the primitive types, so that TypeScript keeps the literal types of the arguments (`get('port')`).
type ArgumentValue = string | number | boolean | bigint | symbol | object | null | undefined
type CallableWith<F, P extends any[]> = F extends (...args: P) => any ? unknown : never
type CallReturnTypeOf<F, P extends any[]> = F extends (...args: P) => infer R ? R : never

// Generic code: distributive over `TVariant`, so that for a member type such as `T['add']` with `T extends Calculator`
// TypeScript computes the signatures from the constraint (`Calculator['add']`) when the member is called (T33).
type EachSignatures<TVariant, TView extends SubstituteView, TFunction> =
  TVariant extends unknown ? SignaturesOf<TVariant, TView, TFunction> : never

// Concrete types: the signatures of every variant of the member type in one intersection (one overloaded function type),
// all positional signatures first (T:TY-10). A union of the variants' signatures does not work for variants whose
// parameter lists differ (T42, R5TD-1): `SubstituteOf<T>` intersects the member with `T`, i.e. with each variant's own
// function type, and when TypeScript calls the resulting union it pairs a signature of one variant with a signature of
// the other variant's own function type, whose plain return type has no setup API. With one intersection, every
// variant of the member carries the same signatures, which pair up with each other.
// Each variant is expanded on its own (matching the whole union against the overload pattern is much slower for large
// unions, such as the methods of all lib.dom elements), and identical signatures of several variants are one type, so
// the intersection holds each of them once (see `EachBox`). A member that is not callable in every variant has no
// signatures (as before). `TFunction` passes the whole member type on to the call results (see `CallResult`).
// The positional signatures take an exact number of arguments (see `EachBox`) and are ordered by it, most first
// (`fetch(url, options)` before `fetch(url)`), each group in the order of the variants and their overloads; then the
// signatures for more than 6 arguments, the `Arg.all()` signatures, and last the signatures without parameters. When
// TypeScript 5.3 and older call the union, they pair each signature of one variant with the FIRST signature of the
// other variant that requires no more arguments and whose parameter types accept its own, even one with fewer
// parameters (5.4 and newer look for the same signature first); a signature without parameters accepts any other. With
// `get()` before `get(key)`, `get('k')` resolved to `get(key)` paired with `get()`, and `.returns()` took only what
// both return. In this order a signature is paired with itself (every variant carries the same signatures) or with an
// earlier one whose parameters it shares, whose result usually takes the same values (see `UnionReturnTypes`).
//
// Fast path (T44, R6V-5, R6TD-2): when every overload of every variant returns the same type (`void` for the
// `addEventListener` of all lib.dom elements, `Promise<string>` for `fetch(url)` and `fetch(url, options?)`), the
// parameter lists alone tell the calls apart, and every call returns that type. The member then has one positional
// signature per overload position (`Overloads` slot), whose rest parameter is the union of the parameter lists that
// the variants declare in that position, plus the `Arg.all()` signatures, all returning that type. TypeScript checks
// the arguments against that union as a whole, so they keep their combinations. A callback argument without parameter
// types is typed from the variants' callback types when these differ at most in their `this` type; otherwise it gets
// no contextual type (spec-types/limitations.ts). These signatures are computed from the whole member type, the same
// for every variant, without comparing the variants with each other: `UnionToIntersection` below compares every box
// with every other one, which made large unions slow to check (all lib.dom elements: 1.6 to 1.8 times as long as
// before T42 on TypeScript 3.6 to 3.8).
// The choice is an indexed access as for the kinds in Utilities.ts: where a return type involves a type parameter
// (`(() => T) | ((fallback?: string) => string)` in `Picker<T>`), TypeScript cannot decide `ReturnsAlike` and takes the
// boxes. (The boxed signatures are unwrapped by a conditional type, see `VariantSignatures`.)
type CombinedSignatures<TFunction, TView extends SubstituteView> =
  false extends EachCallable<TFunction> ? unknown :
  SignaturesInBox<{
    boxes: { signatures: SignaturesOfBoxes<UnionToIntersection<EachBox<TFunction, TView, TFunction>>> }
    [fast: number]: { signatures: SameReturnSignatures<TFunction, AllReturnTypes<TFunction>, TView> }
  }[CombinedKind<TFunction>]>
// `any` for the fast path, which takes parameter lists of up to 6 parameters without a rest parameter (see
// `SlotSignature`), `'boxes'` otherwise.
type CombinedKind<TFunction> = ReturnsAlike<TFunction> extends true ?
  (7 extends MaximumArguments<Extract<SlotParameterLists<TFunction, number>, any[]>> ? 'boxes' : any) :
  'boxes'
type EachCallable<TVariant> = TVariant extends unknown ? (Overloads<TVariant> extends NoOverloads ? false : true) : never
type ReturnsAlike<TFunction> = false extends EachReturnsAll<TFunction, AllReturnTypes<TFunction>> ? false : true
// The parameter lists of the overloads in slot `TSlot` of the variants (all slots for `number`). The parameter names
// are kept: removing them (`UnnamedArguments`) costs more than the duplicates it would remove.
type SlotParameterLists<TVariant, TSlot extends number> =
  TVariant extends unknown ? ParameterListsOf<Overloads<TVariant>[TSlot]> : never
type ParameterListsOf<TOverload> = TOverload extends Overload<any[], any> ? TOverload['arguments'] : never
type SameReturnSignatures<F, R, V extends SubstituteView> =
  SlotSignature<SlotParameterLists<F, 0>, R, V> & SlotSignature<SlotParameterLists<F, 1>, R, V> &
  SlotSignature<SlotParameterLists<F, 2>, R, V> & SlotSignature<SlotParameterLists<F, 3>, R, V> &
  SlotSignature<SlotParameterLists<F, 4>, R, V> & SlotSignature<SlotParameterLists<F, 5>, R, V> &
  SlotSignature<SlotParameterLists<F, 6>, R, V> & SlotSignature<SlotParameterLists<F, 7>, R, V> &
  AllArgumentsSignaturesFor<Extract<SlotParameterLists<F, number>, any[]>, R, V, never>
// One signature for the whole union of parameter lists, with the parameters at each position (their types the union of
// the lists' types there; the parameters from the shortest list's length on optional). A rest parameter typed as the
// union of the lists would keep their combinations, but TypeScript compares such signatures only by the type of their
// first element: two of them whose lists start with parameters of the same type count as the same signature, and one
// of them is dropped from the intersection.
type SlotSignature<A, R, V extends SubstituteView> =
  [A] extends [never] ? unknown : SlotSignatureOf<Extract<A, any[]>, R, V>
type SlotSignatureOf<A extends any[], R, V extends SubstituteView> =
  PositionalSignatureOf<UnnamedArgumentsOf<A, MinimumArguments<A>, MaximumArguments<A>>, R, V, never>
type SignaturesOfBoxes<TBoxes> = TBoxes extends SignatureBox ?
  TBoxes[6] & TBoxes[5] & TBoxes[4] & TBoxes[3] & TBoxes[2] & TBoxes[1] & TBoxes['more'] & TBoxes['allArguments'] &
  TBoxes[0] :
  never
type SignatureBox = {
  0: unknown, 1: unknown, 2: unknown, 3: unknown, 4: unknown, 5: unknown, 6: unknown, more: unknown, allArguments: unknown
}
// The signatures of one variant: for each number of arguments `n` from 0 to 6 that an overload accepts, a positional
// signature that takes exactly `n` arguments, the overload's first `n` parameters (T45, R6TD-1); in `more`, the
// overloads that accept more than 6 arguments (also with a rest parameter); and the `Arg.all()` signatures. A call
// that omits optional parameters (`get('k')` of `get(key: string, options?: OptionsV1)` and `get(key: string, options?:
// OptionsV2)`) then resolves to a signature with just the parameters it passes, whose result takes what every variant
// that accepts these arguments returns (see `PrefixCallResult`). `variant` keeps the boxes of variants with different
// overloads apart: TypeScript would otherwise infer only one box for `UnionToIntersection` when the box of one variant
// is assignable to the box of another.
// The parameters of these signatures are tuples without names, and their call results depend only on the parameter
// lists and the whole member type (`CallResult`). So the overloads of several variants with the same parameter list
// (`self(x: string): this` in each variant) give the same signatures. When TypeScript calls the union, it pairs up the
// signatures of all variants; with distinct signatures per variant and overload, a call of a union of 20 variants took
// 10 to 16 seconds to check on TypeScript 4.0 to 4.5.
type EachBox<TVariant, TView extends SubstituteView, TFunction> = TVariant extends unknown ? {
  variant: (overloads: Overloads<TVariant>) => Overloads<TVariant>
  0: PrefixSignatures<Overloads<TVariant>, 0, TView, TFunction>
  1: PrefixSignatures<Overloads<TVariant>, 1, TView, TFunction>
  2: PrefixSignatures<Overloads<TVariant>, 2, TView, TFunction>
  3: PrefixSignatures<Overloads<TVariant>, 3, TView, TFunction>
  4: PrefixSignatures<Overloads<TVariant>, 4, TView, TFunction>
  5: PrefixSignatures<Overloads<TVariant>, 5, TView, TFunction>
  6: PrefixSignatures<Overloads<TVariant>, 6, TView, TFunction>
  more: PrefixSignatures<Overloads<TVariant>, 7, TView, TFunction>
  allArguments: UnionAllArgumentsSignaturesOf<Overloads<TVariant>, TView, TFunction>
} : never
type PrefixSignatures<TOverloads extends any[], TCount extends ArgumentCount, TView extends SubstituteView, TFunction> =
  PrefixSignature<TOverloads[0], TCount, TView, TFunction> & PrefixSignature<TOverloads[1], TCount, TView, TFunction> &
  PrefixSignature<TOverloads[2], TCount, TView, TFunction> & PrefixSignature<TOverloads[3], TCount, TView, TFunction> &
  PrefixSignature<TOverloads[4], TCount, TView, TFunction> & PrefixSignature<TOverloads[5], TCount, TView, TFunction> &
  PrefixSignature<TOverloads[6], TCount, TView, TFunction> & PrefixSignature<TOverloads[7], TCount, TView, TFunction>
// The signature of an overload that takes exactly `TCount` arguments (7: more than 6, with the whole parameter list),
// otherwise `unknown`.
type PrefixSignature<TOverload, TCount extends ArgumentCount, TView extends SubstituteView, TFunction> =
  TOverload extends Overload<any[], any> ?
  (ArgumentCounts[TCount] extends TOverload['arguments'] ?
    PrefixSignatureOf<Extract<PrefixOf<TOverload['arguments'], TCount>, any[]>, TOverload['arguments'], TView, TFunction> :
    unknown) :
  unknown
type ArgumentCount = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
type ArgumentCounts = [[], [any], [any, any], [any, any, any], [any, any, any, any], [any, any, any, any, any],
  [any, any, any, any, any, any], [any, any, any, any, any, any, any]]
// The first `TCount` parameters of a parameter list, as a tuple without names (7: the whole list).
type PrefixOf<A extends any[], TCount extends ArgumentCount> = {
  0: []
  1: [A[0]]
  2: [A[0], A[1]]
  3: [A[0], A[1], A[2]]
  4: [A[0], A[1], A[2], A[3]]
  5: [A[0], A[1], A[2], A[3], A[4]]
  6: [A[0], A[1], A[2], A[3], A[4], A[5]]
  7: A
}[TCount]
type PrefixSignatureOf<P extends any[], A extends any[], V extends SubstituteView, F> =
  (...args: P) => PrefixCallResult<V, P, A, F>
// The result of a call with the arguments `P` that resolves to an overload with the parameters `A`: it takes what the
// variants return whose overloads accept calls with the parameters `A` (see `UnionReturnTypes`), and what those
// return whose overloads accept the arguments `P` (`get('k')` above: `number | string`).
type PrefixCallResult<V extends SubstituteView, P extends any[], A extends any[], F> =
  V extends 'assertion' ? void : SetupResult<V, P, UnionReturnType<F, A> | UnionReturnType<F, P>>
type UnionAllArgumentsSignaturesOf<TOverloads extends any[], TView extends SubstituteView, TFunction> =
  UnionAllArgumentsSignatures<TOverloads[0], TView, TFunction> & UnionAllArgumentsSignatures<TOverloads[1], TView, TFunction> &
  UnionAllArgumentsSignatures<TOverloads[2], TView, TFunction> & UnionAllArgumentsSignatures<TOverloads[3], TView, TFunction> &
  UnionAllArgumentsSignatures<TOverloads[4], TView, TFunction> & UnionAllArgumentsSignatures<TOverloads[5], TView, TFunction> &
  UnionAllArgumentsSignatures<TOverloads[6], TView, TFunction> & UnionAllArgumentsSignatures<TOverloads[7], TView, TFunction>
// A single `Arg.all()` matches every call, so its result takes what any overload of any variant returns (T45, R6TD-1).
type UnionAllArgumentsSignatures<TOverload, TView extends SubstituteView, TFunction> =
  TOverload extends Overload<any[], any> ?
  ((allArguments: AllArguments<UnnamedArguments<TOverload['arguments']>>) =>
    CallResult<TView, UnnamedArguments<TOverload['arguments']>, AllReturnTypes<TFunction>, never>) &
  TrailingAllArgumentsSignatures<UnnamedArguments<TOverload['arguments']>, unknown, TView, TFunction> :
  unknown
// The number of arguments a parameter list requires; 6 stands for 6 or more.
type MinimumArguments<A> =
  [] extends A ? 0 : [any] extends A ? 1 : [any, any] extends A ? 2 : [any, any, any] extends A ? 3 :
  [any, any, any, any] extends A ? 4 : [any, any, any, any, any] extends A ? 5 : 6
// The number of arguments a parameter list takes at most; 7 stands for more than 6, also for a rest parameter.
type MaximumArguments<A extends any[]> =
  [Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5 | 6>] extends [never] ?
    (6 extends A['length'] ? 6 : 5 extends A['length'] ? 5 : 4 extends A['length'] ? 4 : 3 extends A['length'] ? 3 :
      2 extends A['length'] ? 2 : 1 extends A['length'] ? 1 : 0) :
    7
// A parameter list of up to 6 parameters without a rest parameter as a tuple without names: the same parameter list
// declared in several interfaces is then one type (since TypeScript 4.0 a tuple with names is told apart by the
// declarations of its names). Any other parameter list is kept. A union of parameter lists (a rest parameter typed as
// a union of tuples) is converted list by list.
type UnnamedArguments<A extends any[]> = A extends unknown ? UnnamedArgumentsOf<A, MinimumArguments<A>, MaximumArguments<A>> : never
type UnnamedArgumentsOf<A extends any[], TMinimum, TMaximum> =
  TMaximum extends 0 ? [] :
  TMaximum extends 1 ? (TMinimum extends 1 ? [A[0]] : [A[0]?]) :
  TMaximum extends 2 ? (TMinimum extends 2 ? [A[0], A[1]] : TMinimum extends 1 ? [A[0], A[1]?] : [A[0]?, A[1]?]) :
  TMaximum extends 3 ? (
    TMinimum extends 3 ? [A[0], A[1], A[2]] : TMinimum extends 2 ? [A[0], A[1], A[2]?] :
    TMinimum extends 1 ? [A[0], A[1]?, A[2]?] : [A[0]?, A[1]?, A[2]?]) :
  TMaximum extends 4 ? (
    TMinimum extends 4 ? [A[0], A[1], A[2], A[3]] : TMinimum extends 3 ? [A[0], A[1], A[2], A[3]?] :
    TMinimum extends 2 ? [A[0], A[1], A[2]?, A[3]?] : TMinimum extends 1 ? [A[0], A[1]?, A[2]?, A[3]?] :
    [A[0]?, A[1]?, A[2]?, A[3]?]) :
  TMaximum extends 5 ? (
    TMinimum extends 5 ? [A[0], A[1], A[2], A[3], A[4]] : TMinimum extends 4 ? [A[0], A[1], A[2], A[3], A[4]?] :
    TMinimum extends 3 ? [A[0], A[1], A[2], A[3]?, A[4]?] : TMinimum extends 2 ? [A[0], A[1], A[2]?, A[3]?, A[4]?] :
    TMinimum extends 1 ? [A[0], A[1]?, A[2]?, A[3]?, A[4]?] : [A[0]?, A[1]?, A[2]?, A[3]?, A[4]?]) :
  TMaximum extends 6 ? (
    TMinimum extends 6 ? [A[0], A[1], A[2], A[3], A[4], A[5]] : TMinimum extends 5 ? [A[0], A[1], A[2], A[3], A[4], A[5]?] :
    TMinimum extends 4 ? [A[0], A[1], A[2], A[3], A[4]?, A[5]?] : TMinimum extends 3 ? [A[0], A[1], A[2], A[3]?, A[4]?, A[5]?] :
    TMinimum extends 2 ? [A[0], A[1], A[2]?, A[3]?, A[4]?, A[5]?] : TMinimum extends 1 ? [A[0], A[1]?, A[2]?, A[3]?, A[4]?, A[5]?] :
    [A[0]?, A[1]?, A[2]?, A[3]?, A[4]?, A[5]?]) :
  A

// `any` (which selects the number index signature) for a union, `'single'` for any other type. In generic code
// TypeScript cannot decide it and uses `'single'`. A union is told apart by type identity, not by assignability:
// variants that are assignable to each other (`log(message: string): void` and `log(message: string, level?: number):
// void`) still need the combined signatures.
type VariantSignatures<TFunction, TView extends SubstituteView> = SignaturesInBox<{
  single: { signatures: EachSignatures<TFunction, TView, never> }
  [union: number]: { signatures: CombinedSignatures<TFunction, TView> }
}[VariantsKind<TFunction>]>
type SignaturesInBox<TBox> = TBox extends { signatures: infer TSignatures } ? TSignatures : never
type VariantsKind<TFunction> = true extends IsUnion<TFunction, TFunction> ? any : 'single'
type IsUnion<TVariant, TFunction> = TVariant extends unknown ? (Equals<TVariant, TFunction> extends true ? false : true) : never

// Primitives, `never` and `any` are ruled out without distributing over a (possibly very large) union of literals
// (TD-8). Their branch is `any` for `any` (a member typed `any` stays `any`) and `never` otherwise: in generic code
// TypeScript cannot decide the check and uses the union of both branches, where `never` drops out, and an `any` branch
// is left out as well (see `ObjectKind`).
type GuardedSignatures<TFunction, TView extends SubstituteView> =
  [TFunction] extends [Primitive] ? (IsAny<TFunction> extends true ? any : never) :
  VariantSignatures<TFunction, TView>

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
// Construct signatures count as calls (T47): `new` is recorded as a call.
type EachCallKind<TFunction> =
  TFunction extends (...args: any[]) => any ? 'call' : TFunction extends new (...args: any) => any ? 'call' : 'plain'
type GuardedCallKind<TFunction> = [TFunction] extends [Primitive] ? never : EachCallKind<TFunction>

/**
 * `'call'` when `TFunction` (a member type without `null | undefined`) is callable, otherwise `'plain'`. In generic
 * code it is decided by the member's constraint.
 */
export type CallKind<TFunction> = CallKindOf<ObjectKind<TFunction>, TFunction>
type CallKindOf<TKind, TFunction> = TKind extends 'object' ? GuardedCallKind<TFunction> : 'plain'
