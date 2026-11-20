import { AllArguments, Argument } from '../../shared'
import { ConfigurationResult, OverloadsImplementation, SubstitutionResult } from './SubstitutionLevel'
import { Equals, GenericKind, IsAny, ObjectKind, Primitive, UnionToIntersection } from './Utilities'

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
 * A generic signature whose return type is conditional on a type parameter (`conv<K>(e: K): K extends string ? number :
 * boolean`, `listeners` of Node's `EventEmitter<T>`) does not match the pattern (TypeScript compares it with every
 * slot with its type parameters replaced by `any`); it is matched on its own (R7TD-1, T53).
 * An overloaded function whose last overload can never be called and returns `never` once its type parameters are
 * replaced by their constraints (hono's `Context.get`, see `PossibleOverloads`) matches neither pattern; it is matched
 * by a third one, without that overload (R15FE-2, T78).
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
  TFunction extends (...args: infer A) => infer R ? [NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, LastSlot<A, R>] :
  TFunction extends new (...args: infer A) => infer R ? ConstructOverloads<TFunction, A, R> :
  TFunction extends (...args: any) => any ? PossibleOverloads<TFunction> :
  NoOverloads

// An overload whose parameters cannot take any argument (hono's `Context.get` declares `<Key extends keyof
// ContextVariableMap>(key: Key): ContextVariableMap[Key]` last, and `ContextVariableMap` is `{}` unless an application
// adds to it, so that its `key` is `never` once the type parameter is replaced by its constraint) is left out when the
// setup signatures, the configure view and the `Arg.all()` signatures are built (R15FE-2, T78). Such an overload
// returns `never` once its type parameters are replaced by their constraints (`{}[never]`), which is what TypeScript
// infers for its slot in the patterns of `Overloads`, while it checks an overloaded function against a pattern with
// the type parameters replaced by `any` (`{}[any]`), which `never` does not accept. When it is the last overload,
// neither pattern matched, and the member had no setup API at all (`c.get('user').returns(user)`,
// `c[configure]().get('user')` and `c.get(Arg.all())` did not compile). The pattern below accepts it: each return type
// is inferred in a union with a type that no function returns (`NeverReturn`), which `any` fits. The overloads it finds
// are those of `Overloads`; the ones whose required parameters include `never` are dropped (`DroppedOverload`), and
// the last remaining one moves to the last slot, which carries the signature for a single `Arg.all()`.
// Only functions that the patterns above do not match get here (after the construct signatures, so that the patterns
// of other types are not nested deeper, which TypeScript 3.6 reports as "excessively deep" in generic code), and this
// pattern is only taken when it leaves an overload out: for any other type nothing changes. So a function whose
// impossible overload is not the last one keeps the typing it had: when that overload returns `never`, the second
// pattern above gives the last overload alone the setup API, otherwise the first pattern keeps the impossible
// overload, whose positional signature takes no argument but `never` or `any`.
type PossibleOverloads<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads(...args: infer A1): infer R1 | NeverReturn
    substituteOverloads(...args: infer A2): infer R2 | NeverReturn
    substituteOverloads(...args: infer A3): infer R3 | NeverReturn
    substituteOverloads(...args: infer A4): infer R4 | NeverReturn
    substituteOverloads(...args: infer A5): infer R5 | NeverReturn
    substituteOverloads(...args: infer A6): infer R6 | NeverReturn
    substituteOverloads(...args: infer A7): infer R7 | NeverReturn
    substituteOverloads(...args: infer A8): infer R8 | NeverReturn
  } ? WithPossibleOverloads<[
    PossibleSlot<A1, R1, A2, R2>, PossibleSlot<A2, R2, A3, R3>, PossibleSlot<A3, R3, A4, R4>,
    PossibleSlot<A4, R4, A5, R5>, PossibleSlot<A5, R5, A6, R6>, PossibleSlot<A6, R6, A7, R7>,
    PossibleSlot<A7, R7, A8, R8>, PossibleOverload<LastSlot<A8, R8>>
  ]> :
  NoOverloads
type NeverReturn = { readonly '@fluffy-spoon/substitute:never-return': true }
// Only taken when an overload was left out and another one remains; otherwise the function is typed as before T78.
type WithPossibleOverloads<S extends any[]> =
  DroppedOverload extends S[number] ?
  ([Extract<S[number], Overload<any[], any>>] extends [never] ? NoOverloads : WithoutDroppedLast<S>) :
  NoOverloads
// The slot of an overload that is left out. It is not a `NoOverload`: the function has more than one overload, so
// `IsGenericSignature` must not take the remaining one for the function's only signature (whose own generic signature
// would then be compared with the function's overloads), and the result of a single `Arg.all()` is computed from all
// remaining overloads (`AllArgumentsResult`, which counts only real overloads).
type DroppedOverload = { readonly droppedOverload: true }
type PossibleSlot<A, R, TNextArguments, TNextReturnType> = PossibleOverload<Slot<A, R, TNextArguments, TNextReturnType>>
type PossibleOverload<TSlot> =
  TSlot extends Overload<infer A, any> ? (HasImpossibleParameter<A> extends true ? DroppedOverload : TSlot) : TSlot
// `true` when one of the first 6 parameters is required and of type `never`. (An optional parameter of type `never`
// can be left out; a rest parameter of type `never[]` takes no argument.)
type HasImpossibleParameter<A extends any[]> =
  [] extends A ? false : [A[0]] extends [never] ? true :
  [any] extends A ? false : [A[1]] extends [never] ? true :
  [any, any] extends A ? false : [A[2]] extends [never] ? true :
  [any, any, any] extends A ? false : [A[3]] extends [never] ? true :
  [any, any, any, any] extends A ? false : [A[4]] extends [never] ? true :
  [any, any, any, any, any] extends A ? false : [A[5]] extends [never] ? true :
  false
// The last remaining overload in the last slot, and `DroppedOverload` in the slots from where it was up to the last
// but one, so that the slot before the last never reads as empty. Only `DroppedOverload`s: nothing can be called.
type WithoutDroppedLast<S extends any[]> =
  S[7] extends Overload<any[], any> ? [S[0], S[1], S[2], S[3], S[4], S[5], S[6] extends Overload<any[], any> ? S[6] : DroppedOverload, S[7]] :
  S[6] extends Overload<any[], any> ? [S[0], S[1], S[2], S[3], S[4], S[5], DroppedOverload, S[6]] :
  S[5] extends Overload<any[], any> ? [S[0], S[1], S[2], S[3], S[4], DroppedOverload, DroppedOverload, S[5]] :
  S[4] extends Overload<any[], any> ? [S[0], S[1], S[2], S[3], DroppedOverload, DroppedOverload, DroppedOverload, S[4]] :
  S[3] extends Overload<any[], any> ?
  [S[0], S[1], S[2], DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, S[3]] :
  S[2] extends Overload<any[], any> ?
  [S[0], S[1], DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, S[2]] :
  S[1] extends Overload<any[], any> ?
  [S[0], DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, S[1]] :
  S[0] extends Overload<any[], any> ?
  [DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, DroppedOverload, S[0]] :
  NoOverloads

// A type with construct signatures but no call signatures (a class, `new (url: string) => ApiClient`): the overloads
// of its construct signatures (R6FE-3, T47). At run time `new` on a substitute or a member is recorded and answered
// like a call (E23), so the substitute offers call signatures with these parameters, whose setup API takes the
// instance a `new` gives (`Client('u').returns(client)`, `Client.received(1)('u')`), next to the construct signatures
// of `T` itself. The patterns below cannot use method signatures, which TypeScript compares bivariantly, and
// TypeScript 5.2 and older fill the slots of missing overloads with `new (...args: unknown[]) => unknown`, which a
// constructor's own signatures do not match: there a pattern only matches a constructor with as many construct
// signatures as it has. So the patterns for 8 down to 2 construct signatures are tried in turn (R7TD-2, T53; TypeScript
// 5.3 and newer match the first), and a constructor with one construct signature (or more than 8) takes the last one.
// (Only for concrete types, see `GenericKind`: in generic code the patterns below 8 made TypeScript 3.6 give up with
// "Type instantiation is excessively deep".)
type ConstructOverloads<TFunction, A, R> =
  ConstructOverloads8<TFunction> extends NoOverloads ? {
    generic: LastConstructOverload<A, R>
    [concrete: number]: ConstructOverloadsBelow8<TFunction, A, R>
  }[GenericKind<TFunction>] :
  ConstructOverloads8<TFunction>
type LastConstructOverload<A, R> = [NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, NoOverload, LastSlot<A, R>]
type ConstructOverloadsBelow8<TFunction, A, R> =
  ConstructOverloads7<TFunction> extends NoOverloads ? ConstructOverloadsBelow7<TFunction, A, R> : ConstructOverloads7<TFunction>
type ConstructOverloadsBelow7<TFunction, A, R> =
  ConstructOverloads6<TFunction> extends NoOverloads ? ConstructOverloadsBelow6<TFunction, A, R> : ConstructOverloads6<TFunction>
type ConstructOverloadsBelow6<TFunction, A, R> =
  ConstructOverloads5<TFunction> extends NoOverloads ? ConstructOverloadsBelow5<TFunction, A, R> : ConstructOverloads5<TFunction>
type ConstructOverloadsBelow5<TFunction, A, R> =
  ConstructOverloads4<TFunction> extends NoOverloads ? ConstructOverloadsBelow4<TFunction, A, R> : ConstructOverloads4<TFunction>
type ConstructOverloadsBelow4<TFunction, A, R> =
  ConstructOverloads3<TFunction> extends NoOverloads ? ConstructOverloadsBelow3<TFunction, A, R> : ConstructOverloads3<TFunction>
type ConstructOverloadsBelow3<TFunction, A, R> =
  ConstructOverloads2<TFunction> extends NoOverloads ? LastConstructOverload<A, R> : ConstructOverloads2<TFunction>
type ConstructOverloads8<TFunction> =
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
type ConstructOverloads7<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads: {
      new (...args: infer A1): infer R1
      new (...args: infer A2): infer R2
      new (...args: infer A3): infer R3
      new (...args: infer A4): infer R4
      new (...args: infer A5): infer R5
      new (...args: infer A6): infer R6
      new (...args: infer A7): infer R7
    }
  } ? [
    NoOverload, Slot<A1, R1, A2, R2>, Slot<A2, R2, A3, R3>, Slot<A3, R3, A4, R4>,
    Slot<A4, R4, A5, R5>, Slot<A5, R5, A6, R6>, Slot<A6, R6, A7, R7>, LastSlot<A7, R7>
  ] :
  NoOverloads
type ConstructOverloads6<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads: {
      new (...args: infer A1): infer R1
      new (...args: infer A2): infer R2
      new (...args: infer A3): infer R3
      new (...args: infer A4): infer R4
      new (...args: infer A5): infer R5
      new (...args: infer A6): infer R6
    }
  } ? [
    NoOverload, NoOverload, Slot<A1, R1, A2, R2>, Slot<A2, R2, A3, R3>,
    Slot<A3, R3, A4, R4>, Slot<A4, R4, A5, R5>, Slot<A5, R5, A6, R6>, LastSlot<A6, R6>
  ] :
  NoOverloads
type ConstructOverloads5<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads: {
      new (...args: infer A1): infer R1
      new (...args: infer A2): infer R2
      new (...args: infer A3): infer R3
      new (...args: infer A4): infer R4
      new (...args: infer A5): infer R5
    }
  } ? [
    NoOverload, NoOverload, NoOverload, Slot<A1, R1, A2, R2>,
    Slot<A2, R2, A3, R3>, Slot<A3, R3, A4, R4>, Slot<A4, R4, A5, R5>, LastSlot<A5, R5>
  ] :
  NoOverloads
type ConstructOverloads4<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads: {
      new (...args: infer A1): infer R1
      new (...args: infer A2): infer R2
      new (...args: infer A3): infer R3
      new (...args: infer A4): infer R4
    }
  } ? [
    NoOverload, NoOverload, NoOverload, NoOverload,
    Slot<A1, R1, A2, R2>, Slot<A2, R2, A3, R3>, Slot<A3, R3, A4, R4>, LastSlot<A4, R4>
  ] :
  NoOverloads
type ConstructOverloads3<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads: {
      new (...args: infer A1): infer R1
      new (...args: infer A2): infer R2
      new (...args: infer A3): infer R3
    }
  } ? [
    NoOverload, NoOverload, NoOverload, NoOverload,
    NoOverload, Slot<A1, R1, A2, R2>, Slot<A2, R2, A3, R3>, LastSlot<A3, R3>
  ] :
  NoOverloads
type ConstructOverloads2<TFunction> =
  ({ substituteOverloads: TFunction } & TFunction) extends {
    substituteOverloads: {
      new (...args: infer A1): infer R1
      new (...args: infer A2): infer R2
    }
  } ? [
    NoOverload, NoOverload, NoOverload, NoOverload,
    NoOverload, NoOverload, Slot<A1, R1, A2, R2>, LastSlot<A2, R2>
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
// Only the last overload has the signature for a single `Arg.all()`, whose result is that of all the overloads
// (`TOverloads`, see `AllArgumentsResult`): a call with a single `Arg.all()` matches the calls of every overload. The
// earlier overloads only have the signatures with leading arguments. (Their own signatures for a single `Arg.all()`
// came first before, so such a call resolved to the first overload.)
type TrailingAllArgumentsSignaturesOf<TOverload, TView extends SubstituteView, TFunction> =
  TOverload extends Overload<any[], any> ?
  TrailingAllArgumentsSignatures<TOverload['arguments'], TOverload['returnType'], TView, TFunction> :
  unknown
// (A member with one overload, which has nothing in slot 6 of `Overloads`, gets that overload's result right away; so
// does a generic method, see `IsGenericSignature`.)
type LastAllArgumentsSignatures<TOverload, TView extends SubstituteView, TFunction, TOverloads extends any[]> =
  TOverload extends Overload<any[], any> ?
  ((allArguments: AllArguments<TOverload['arguments']>) => TOverloads[6] extends NoOverload ?
    CallResult<TView, TOverload['arguments'], TOverload['returnType'], TFunction> :
    AllArgumentsResult<TView, TOverloads>) &
  TrailingAllArgumentsSignatures<TOverload['arguments'], TOverload['returnType'], TView, TFunction> :
  unknown

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
  TrailingAllArgumentsSignaturesOf<TOverloads[0], TView, TFunction> & TrailingAllArgumentsSignaturesOf<TOverloads[1], TView, TFunction> &
  TrailingAllArgumentsSignaturesOf<TOverloads[2], TView, TFunction> & TrailingAllArgumentsSignaturesOf<TOverloads[3], TView, TFunction> &
  TrailingAllArgumentsSignaturesOf<TOverloads[4], TView, TFunction> & TrailingAllArgumentsSignaturesOf<TOverloads[5], TView, TFunction> &
  TrailingAllArgumentsSignaturesOf<TOverloads[6], TView, TFunction> & LastAllArgumentsSignatures<TOverloads[7], TView, TFunction, TOverloads>

// All positional signatures come before the `Arg.all()` signatures, so a call with a single matcher
// (`Arg.any()`, `Arg.is(...)`) resolves against the real parameter lists first (T:TY-10).
type OverloadSignatures<TOverloads extends any[], TView extends SubstituteView, TFunction> =
  PositionalSignatures<TOverloads, TView, TFunction> & AllArgumentsSignaturesOf<TOverloads, TView, TFunction>

// A single `Arg.all()` matches every call of the member, whichever overload it calls (R14FE-2, T76). It resolves to the
// last overload's signature for it (see `TrailingAllArgumentsSignaturesOf`), whose result is this one. When the overloads return different types,
// it takes what any overload returns (`.returns()`, `.resolves()`), and `.mimicks()` an implementation that can be
// called with the arguments of every overload and returns what any overload returns. Before, it was
// the result of that first overload only: `pool.query(Arg.all())` of @types/pg took the `Submittable` stream overload,
// so `.resolves(result)` did not compile. When all overloads return the same type (a member with one signature
// included), it is still the first overload's result (`.mimicks()` takes its parameters). (A union of members goes
// through `CombinedSignatures`, whose single `Arg.all()` already takes every variant's value.)
type AllArgumentsResult<V extends SubstituteView, TOverloads extends any[]> =
  false extends EachOverloadReturnsAll<TOverloads[number], OverloadReturnTypes<TOverloads[number]>> ?
  AllOverloadsCallResult<V, TOverloads, OverloadReturnTypes<TOverloads[number]>> :
  OverloadCallResult<V, FirstOverload<TOverloads>>
// The implementation `.mimicks()` takes fits each overload as a function assigned to the member does (R16FE-1, T80):
// it may leave out trailing parameters (`entity => ...` for `remove(entities: Row[], options?)` and `remove(entity:
// Row, options?)`), but not have a parameter that some overload does not pass (`(key: string) => ...` for `get():
// string[]` and `get(key: string): string`). (`(...args: A1 | A2) => R`, as in T76, compares the parameter lists as
// whole tuples, so that an implementation that leaves out a trailing parameter did not fit.) Untyped parameters take
// their types from `OverloadsContextualImplementation`.
type AllOverloadsCallResult<V extends SubstituteView, TOverloads extends any[], R> =
  V extends 'assertion' ? void :
  V extends 'configure' ? ConfigurationResult<R, OverloadsImplementation<TOverloads, R>> :
  SubstitutionResult<R, OverloadsImplementation<TOverloads, R>>
/**
 * `.mimicks()` of a setup that takes the calls of several overloads (`TOverloads`, see `Overloads`), each with the
 * value `R` (R16FE-1, T80): an implementation fits when it can stand in for each of them (an intersection of one
 * function type per overload), as a function assigned to the overloaded member itself does, so it may leave out
 * trailing parameters. `OverloadsContextualImplementation` is one signature that every such implementation fits,
 * which types its parameters from the context on every TypeScript version (TypeScript 4.2 and older give a function
 * passed for an intersection of function types no contextual type: an untyped parameter would be implicitly `any`).
 */
export type OverloadsMimicksFunction<TOverloads, R> =
  <TImplementation extends OverloadsContextual<TOverloads, R>, TMore extends OverloadsContextual<TOverloads, R>[]>(
    implementation: TImplementation & ImplementationFits<TImplementation, EachOverloadImplementation<TOverloads, R>>,
    ...implementations: TMore & ImplementationFits<TMore, EachOverloadImplementation<TOverloads, R>[]>) => void
// The check is not distributive, so a union of implementations (`cond ? good : bad`, `typeof good | typeof bad`) fits
// only when every one of them does, as for a union assigned to the member itself (R17TD-1, T82). An implementation
// that does not fit is intersected with `TEach`, so that the error names the overload it does not fit; a union is not:
// TypeScript 4.3 to 5.4 crash when they give a union of functions intersected with `TEach` as the contextual type of a
// conditional expression ("Cannot read properties of undefined (reading 'flags')"). A union that does not fit gets an
// object type instead, which no function is assignable to.
type ImplementationFits<TImplementation, TEach> =
  [TImplementation] extends [TEach] ? unknown :
  true extends IsUnion<TImplementation, TImplementation> ? { readonly '@fluffy-spoon/substitute:every-implementation-must-fit': TEach } :
  TEach
type OverloadsContextual<TOverloads, R> = TOverloads extends any[] ?
  OverloadsContextualImplementation<OverloadArgumentLists<TOverloads[number]>, R> :
  never
type EachOverloadImplementation<TOverloads, R> = TOverloads extends any[] ? (
  OverloadImplementation<TOverloads[0], R> & OverloadImplementation<TOverloads[1], R> &
  OverloadImplementation<TOverloads[2], R> & OverloadImplementation<TOverloads[3], R> &
  OverloadImplementation<TOverloads[4], R> & OverloadImplementation<TOverloads[5], R> &
  OverloadImplementation<TOverloads[6], R> & OverloadImplementation<TOverloads[7], R>) :
  never
type OverloadImplementation<TOverload, R> =
  TOverload extends Overload<infer A, any> ? ([A] extends [never] ? unknown : (...args: A) => R) : unknown
// One signature that every implementation of the overloads fits (see `OverloadsMimicksFunction`), with the parameter
// types of all overloads at each position (`(args_0: Row[] | Row, args_1?: { chunk?: number })`), and as many
// required parameters as the overload that requires the fewest. It is a method's signature, whose parameters
// TypeScript compares both ways even with `strictFunctionTypes`: an overloaded function (`real.remove`), which fits
// each overload, fits it as well. Overloads with a rest parameter or more than 6 parameters give `any[]`.
type OverloadsContextualImplementation<TLists extends any[], R> = {
  implementation(...args: OverloadsContextualArguments<TLists, MaximumArguments<TLists>>): R
}['implementation']
type OverloadsContextualArguments<TLists extends any[], TMaximum> = TMaximum extends 7 ? any[] :
  UnnamedArgumentsOf<[
    ParameterAt0<TLists>, ParameterAt1<TLists>, ParameterAt2<TLists>, ParameterAt3<TLists>, ParameterAt4<TLists>,
    ParameterAt5<TLists>
  ], MinimumArguments<TLists>, TMaximum>
// The types of the parameter at a position in each of the lists that has one.
type ParameterAt0<A> = A extends any[] ? ([Exclude<A['length'], 0>] extends [never] ? never : A[0]) : never
type ParameterAt1<A> = A extends any[] ? ([Exclude<A['length'], 0 | 1>] extends [never] ? never : A[1]) : never
type ParameterAt2<A> = A extends any[] ? ([Exclude<A['length'], 0 | 1 | 2>] extends [never] ? never : A[2]) : never
type ParameterAt3<A> = A extends any[] ? ([Exclude<A['length'], 0 | 1 | 2 | 3>] extends [never] ? never : A[3]) : never
type ParameterAt4<A> = A extends any[] ? ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4>] extends [never] ? never : A[4]) : never
type ParameterAt5<A> = A extends any[] ? ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5>] extends [never] ? never : A[5]) : never
type OverloadArgumentLists<TOverload> = TOverload extends Overload<infer A, any> ? A : never
type OverloadReturnTypes<TOverload> = TOverload extends Overload<any[], infer R> ? R : never
type EachOverloadReturnsAll<TOverload, TAll> = TOverload extends Overload<any[], infer R> ? ([TAll] extends [R] ? true : false) : never
type OverloadCallResult<V extends SubstituteView, TOverload> =
  TOverload extends Overload<any[], any> ? CallResult<V, TOverload['arguments'], TOverload['returnType'], never> : never
// The overload of the first `Arg.all()` signature in `AllArgumentsSignaturesOf`.
type FirstOverload<T extends any[]> =
  T[0] extends Overload<any[], any> ? T[0] : T[1] extends Overload<any[], any> ? T[1] :
  T[2] extends Overload<any[], any> ? T[2] : T[3] extends Overload<any[], any> ? T[3] :
  T[4] extends Overload<any[], any> ? T[4] : T[5] extends Overload<any[], any> ? T[5] :
  T[6] extends Overload<any[], any> ? T[6] : T[7]

// The signatures of `TVariant`, one non-primitive variant of the member type `TFunction`. (Not
// `[TVariant] extends [(...args: any) => any]`: in its true branch TypeScript would add that signature to TVariant.)
type SignaturesOf<TVariant, TView extends SubstituteView, TFunction> =
  SignaturesOfKind<Overloads<TVariant>, TView, TFunction, TVariant, GenericSignatureKind<TVariant, Overloads<TVariant>>>
type SignaturesOfKind<TOverloads extends any[], TView extends SubstituteView, TFunction, F, TGeneric> =
  TGeneric extends true ?
  GenericPositionalSignature<F, TOverloads[7], TView> & LastAllArgumentsSignatures<TOverloads[7], TView, TFunction, TOverloads> &
  GenericCallSignatureFor<F, TOverloads[7], TView> & GenericTrailingAllArgumentsSignatures<F, TOverloads[7], TView> :
  OverloadSignatures<TOverloads, TView, TFunction>

// Generic methods (R6FE-7, T46): `Overloads` sees a generic signature with its type parameters replaced by their
// constraints, so `get<K extends keyof Config>(key: K): Config[K]` becomes `get(key: keyof Config): Config[keyof
// Config]`, and `emit<K>(eventName: Key<K, T>, ...args: Args<K, T>)` of Node's `EventEmitter<T>` has no possible
// arguments at all (`Args<unknown, T>` is `never`). A member with a single signature that is generic therefore gets
// generic signatures instead of the positional one: first `GenericPositionalSignature`, whose arguments are constrained
// by that parameter list, then the `Arg.all()` signatures, and last `GenericCallSignatureFor`, which takes any
// arguments with which the member itself can be called (for `emit`). Their results take what the member returns for
// the arguments (with the type parameters replaced by their constraints, which is all TypeScript infers here, see
// `CallReturnTypeOf`). Coming before the member's own signatures (`SubstituteOf<T>` intersects the member with `T`),
// they are also what calls with `any` arguments (`Arg.any()`) resolve to: TypeScript first tries the signatures with
// the subtype relation, under which `any` fits a type parameter, but no other parameter type. (Overloaded members do
// not get them: there TypeScript takes the return type of the last overload, and `any` arguments resolve to the first
// overload that accepts them.)
type GenericSignatureKind<F, TOverloads extends any[]> = F extends (...args: any) => any ? IsGenericSignature<F, TOverloads> : false
// The positional signature of a generic method: its parameter list with the type parameters replaced by their
// constraints, as a constraint of the arguments `P`, so that callbacks are typed from it (R7TD-1, T53). Its result
// takes what the method returns for the arguments (see `CallReturnTypeOf`).
// The parameters are `P | TArguments`, not just `P` (R9FE-1, T60): an argument that is itself a generic call
// (`Arg.is(sql => sql.startsWith('S'))`) takes its type from the parameter's type, which TypeScript computes with `P`
// replaced by `never` while it infers `P` (it has no inference for `P` yet), so that `P[0]` alone gave the predicate
// `unknown`. With `P[0] | TArguments[0]` it gets the parameter's type with the type parameters replaced by their
// constraints (`string`). `P` is still inferred from the arguments (`get('port')` keeps `'port'`), and the arguments
// are still checked against its constraint.
type GenericPositionalSignature<F, TOverload extends Overload<any[], any>, V extends SubstituteView> =
  [TOverload['arguments']] extends [never] ? unknown :
  <P extends TOverload['arguments']>(...args: P | TOverload['arguments']) =>
    CallResult<V, P, CallReturnTypeOf<F, P, TOverload['returnType']>, never>
// `Arg.all()` after leading arguments of a generic method whose parameter list has no possible arguments with the type
// parameters replaced by their constraints (`emit(eventName, ...args: Args<K, Events>)` of Node's `EventEmitter<T>`, see
// above), where `AllArgumentsSignaturesOf` has only the signature for a single `Arg.all()` (R11FE-1, T68):
// `emit('paid', Arg.all())`, `emit('paid', 'o1', Arg.all())`. For every position `n` from 1 to 6, a signature takes `n`
// leading arguments and `Arg.all()`; the leading arguments must fit the method's own signature, followed by any
// arguments (`LeadingArgumentsFit`), so an unknown event name or a wrong leading argument does not compile. As for the
// positional calls of such a method, the number of arguments is not checked (the parameter list that would tell it has
// none), so `Arg.all()` after the last parameter compiles here. The result takes what the method returns with the type
// parameters replaced by their constraints. They come last: a matcher of type `any` (`Arg.any()`, or an `Arg.is()`
// typed from an `Arg.all()` parameter) also fits their `Arg.all()` parameter, and an argument such as `Arg.is(amount =>
// ...)` takes its type from the first signature TypeScript tries, `GenericCallSignatureFor`.
type GenericTrailingAllArgumentsSignatures<F, TOverload extends Overload<any[], any>, V extends SubstituteView> =
  [TOverload['arguments']] extends [never] ?
  GenericTrailingAllArgumentsSignaturesFor<F, TOverload['arguments'], TOverload['returnType'], V> :
  unknown
type GenericTrailingAllArgumentsSignaturesFor<F, A extends any[], R, V extends SubstituteView> =
  (<P0 extends ArgumentValue>(
    arg0: P0 & LeadingArgumentsFit<F, (arg0: P0, ...rest: any[]) => any>,
    allArguments: AllArguments<any[]>) => CallResult<V, A, R, never>) &
  (<P0 extends ArgumentValue, P1 extends ArgumentValue>(
    arg0: P0 & LeadingArgumentsFit<F, (arg0: P0, arg1: P1, ...rest: any[]) => any>, arg1: P1,
    allArguments: AllArguments<any[]>) => CallResult<V, A, R, never>) &
  (<P0 extends ArgumentValue, P1 extends ArgumentValue, P2 extends ArgumentValue>(
    arg0: P0 & LeadingArgumentsFit<F, (arg0: P0, arg1: P1, arg2: P2, ...rest: any[]) => any>, arg1: P1, arg2: P2,
    allArguments: AllArguments<any[]>) => CallResult<V, A, R, never>) &
  (<P0 extends ArgumentValue, P1 extends ArgumentValue, P2 extends ArgumentValue, P3 extends ArgumentValue>(
    arg0: P0 & LeadingArgumentsFit<F, (arg0: P0, arg1: P1, arg2: P2, arg3: P3, ...rest: any[]) => any>, arg1: P1,
    arg2: P2, arg3: P3, allArguments: AllArguments<any[]>) => CallResult<V, A, R, never>) &
  (<P0 extends ArgumentValue, P1 extends ArgumentValue, P2 extends ArgumentValue, P3 extends ArgumentValue,
    P4 extends ArgumentValue>(
    arg0: P0 & LeadingArgumentsFit<F, (arg0: P0, arg1: P1, arg2: P2, arg3: P3, arg4: P4, ...rest: any[]) => any>,
    arg1: P1, arg2: P2, arg3: P3, arg4: P4, allArguments: AllArguments<any[]>) => CallResult<V, A, R, never>) &
  (<P0 extends ArgumentValue, P1 extends ArgumentValue, P2 extends ArgumentValue, P3 extends ArgumentValue,
    P4 extends ArgumentValue, P5 extends ArgumentValue>(
    arg0: P0 & LeadingArgumentsFit<F, (arg0: P0, arg1: P1, arg2: P2, arg3: P3, arg4: P4, arg5: P5, ...rest: any[]) => any>,
    arg1: P1, arg2: P2, arg3: P3, arg4: P4, arg5: P5, allArguments: AllArguments<any[]>) => CallResult<V, A, R, never>)
type LeadingArgumentsFit<F, TLeading> = F extends TLeading ? unknown : never
// When the signature takes at least one argument, the first one is a parameter of its own, which carries the check of
// all arguments: a call without arguments would otherwise infer nothing for `P` and check the arguments against its
// constraint, which accepts none.
type GenericCallSignatureFor<F, TOverload extends Overload<any[], any>, V extends SubstituteView> =
  [] extends TOverload['arguments'] ?
  (<P extends ArgumentValue[]>(...args: P & CallableWith<F, P, TOverload['arguments']>) =>
    CallResult<V, P, CallReturnTypeOf<F, P, TOverload['returnType']>, never>) :
  (<P0 extends ArgumentValue, P extends ArgumentValue[]>(
    arg0: P0 & CallableWith<F, Prepend<P0, P>, TOverload['arguments']>, ...args: P) =>
    CallResult<V, Prepend<P0, P>, CallReturnTypeOf<F, Prepend<P0, P>, TOverload['returnType']>, never>)
type Prepend<P0, P extends any[]> =
  ((arg0: P0, ...args: P) => void) extends ((...args: infer L) => void) ? Extract<L, any[]> : never
// `true` for a function type with a single call signature that is generic (R7TD-7, T50): a function type that is not
// the same type as the signature `Overloads` sees (with the type parameters replaced by their constraints), or a
// callable type with other members (`{ <T>(x: T): T; extra: boolean }`) to which that signature with the other members
// is not assignable. (A callable type with other members is never the same type as a function type, and a method's
// parameters are compared both ways, so neither test alone tells generic signatures apart.) A callable type with
// other members whose signature is not generic (`{ (x: string): number; extra: boolean }`) does not get the signature
// below.
type IsGenericSignature<F, TOverloads extends any[]> =
  TOverloads[6] extends NoOverload ? (TOverloads[7] extends Overload<any[], any> ? IsGenericOverload<F, TOverloads[7]> : false) :
  false
type IsGenericOverload<F, TOverload extends Overload<any[], any>> =
  [keyof F] extends [never] ?
  (Equals<F, (...args: TOverload['arguments']) => TOverload['returnType']> extends true ? false : true) :
  [((...args: TOverload['arguments']) => TOverload['returnType']) & Pick<F, keyof F>] extends [F] ? false : true
// Includes the primitive types, so that TypeScript keeps the literal types of the arguments (`get('port')`).
type ArgumentValue = string | number | boolean | bigint | symbol | object | null | undefined
// The arguments `P` fit `F`'s own (generic) signature, as TypeScript checks it when it compares the function types,
// which does not check the number of arguments. That is checked against the parameter list with the type parameters
// replaced by their constraints (`TArguments`): `get('port', 'extra')` and `get()` of `get<K extends keyof Config>(key:
// K)` do not compile (R7TD-7, T50). (Where that list has no possible arguments, as for `emit` of Node's
// `EventEmitter<T>`, whose number of arguments depends on the event, the number is not checked.)
type CallableWith<F, P extends any[], TArguments> = F extends (...args: P) => any ? ArgumentCountFits<P, TArguments> : never
type ArgumentCountFits<P extends any[], TArguments> = [TArguments] extends [never] ? unknown :
  true extends EachArgumentCountFits<P['length'], TArguments> ? unknown : never
type EachArgumentCountFits<TCount, TArguments> = TArguments extends any[] ? (TCount extends TArguments['length'] ? true : false) : never
// What `F` returns for the arguments `P`. TypeScript 4.1 and older infer `any` for arguments of type `any`
// (`Arg.any()`), where the return type with the type parameters replaced by their constraints (`TReturnType`) is taken.
// TypeScript infers the return type from the signature with the type parameters replaced by their constraints, and
// then checks that the signature for these arguments returns that: a return type that is conditional on a type
// parameter (`conv<K>(e: K): K extends string ? number : boolean`, whose `conv('x')` returns a `number` but would be
// inferred as `boolean`) cannot be inferred, and is `any` (R7TD-1, T53).
// Arguments that fit the parameter list with the type parameters replaced by their constraints but not the method's own
// signature (`same(1, 'x')` of `same<T extends string | number>(a: T, b: T): T`, `log(1, 'x')` of `log<T>(a: T, b: T):
// void`) take what that list returns (`TReturnType`), never `any` (R8TD-1, T54): `same(1, 'x').returns({})` and
// `log(1, 'x').returns(5)` do not compile.
// The return type is inferred from the value types of matcher arguments (`keyof Config` for `Arg.is(key => ...)`,
// whose type is `Argument<keyof Config> & keyof Config`, R9FE-1, T60): TypeScript cannot infer it from the matcher types
// themselves when the method uses the type parameter as an index (`Config[K]`), which gave `any`. (Function matchers,
// `Arg.any('function')`, are kept as they are. Unwrapping the arguments for every call costs less than a second
// inference after a failed one, which comparisons of such signatures with a method's own generic signature reach.)
type CallReturnTypeOf<F, P extends any[], TReturnType> = CallReturnTypeFor<F, P, Extract<MatcherValues<P>, any[]>, TReturnType>
type CallReturnTypeFor<F, P extends any[], TValues extends any[], TReturnType> =
  F extends (...args: P) => any ? (F extends (...args: TValues) => infer R ? (IsAny<R> extends true ? TReturnType : R) : any) :
  TReturnType
type MatcherValues<P> = { [K in keyof P]: MatcherValue<P[K]> }
type MatcherValue<T> = T extends (...args: any) => any ? T : T extends Argument<infer V> ? V : T

// Generic code: distributive over `TVariant`, so that for a member type such as `T['add']` with `T extends Calculator`
// TypeScript computes the signatures from the constraint (`Calculator['add']`) when the member is called (T33).
type EachSignatures<TVariant, TView extends SubstituteView, TFunction> =
  TVariant extends unknown ? SignaturesOf<TVariant, TView, TFunction> : never

// Concrete types: the signatures of every variant of the member type in one intersection (one overloaded function type),
// all positional signatures first (T:TY-10). A union of the variants' signatures does not work for variants whose
// parameter lists differ (T42, R5TD-1): `SubstituteOf<T>` intersects the member with `T`, i.e. with each variant's own
// function type, and when TypeScript calls the resulting union it pairs a signature of one variant with a signature of
// the other variant's own function type, whose plain return type has no setup API. With one intersection, every
// variant of the member carries the same signatures, which pair up with each other. A member that is not callable in
// every variant has no signatures (as before). `TFunction` passes the whole member type on to the call results (see
// `CallResult`).
//
// The signatures are made per distinct parameter list (T49, R7TD-5, R7TD-8, R7TD-11), not per variant: from the
// parameter lists of all overloads of all variants (`DistinctParameterLists`), each list gets its own signatures (see
// `ListBox`). A call is therefore checked against each list as a whole, as TypeScript checks a call of the union itself:
// with `move(x: string, y: number)` in one variant and `move(x: number, y: string)` in the other, `move('a', 'b')`
// does not compile. A callback argument without parameter types is typed from the list the call resolves to. The
// results of these signatures depend only on the list and the whole member type, so the variants that declare the
// same list (the same method declared in several interfaces) share its signatures: the number of signatures, and with
// it the cost of type-checking a call, grows with the number of distinct lists, not with the number of variants. (The
// methods of all lib.dom elements have a few distinct lists; 60 variants that declare 2 different lists have 2.)
// The positional signatures take an exact number of arguments (see `ListBox`) and are ordered by it, most first
// (`fetch(url, options)` before `fetch(url)`); then the signatures for more than 6 arguments, the signatures of the
// lists with optional parameters, the `Arg.all()` signatures, and last the signatures without parameters. When
// TypeScript 5.3 and older call the union, they pair each signature of one variant with the FIRST signature of the
// other variant that requires no more arguments and whose parameter types accept its own, even one with fewer
// parameters (5.4 and newer look for the same signature first); a signature without parameters accepts any other. With
// `get()` before `get(key)`, `get('k')` resolved to `get(key)` paired with `get()`, and `.returns()` took only what
// both return. In this order a signature is paired with itself (every variant carries the same signatures) or with an
// earlier one whose parameters it shares, whose result usually takes the same values (see `UnionReturnTypes`).
type CombinedSignatures<TFunction, TView extends SubstituteView> =
  false extends EachCallable<TFunction> ? unknown :
  SignaturesWithThis<CallbackThisTypes<AllParameterLists<TFunction>>, TView, TFunction>
type SignaturesWithThis<TThis, V extends SubstituteView, F> =
  SignaturesOfSlots<TThis, V, F> & OwnThisSignature<TThis, V, F>
type EachCallable<TVariant> = TVariant extends unknown ? (Overloads<TVariant> extends NoOverloads ? false : true) : never
// The boxes of the lists of the earlier overloads, of the last overload but one, and of the last overloads
// (`Overloads` slots), in this order, so that the signatures keep the order of the overloads where it matters most: a
// call that several overloads accept resolves to the first, as with the variants' own overloads (lib.dom's
// `addEventListener(type: keyof HTMLElementEventMap, listener: (this: ..., ev: ...) => any)` before
// `addEventListener(type: string, listener: EventListenerOrEventListenerObject)`). The overloads before the last two
// share one group, in which the order is TypeScript's.
type SignaturesOfSlots<TThis, V extends SubstituteView, F> = SignaturesOfBoxes<[
  BoxesOf<UnionToIntersection<ListBox<DistinctParameterLists<SlotParameterLists<F, EarlierSlot>, TThis>, V, F>>>,
  BoxesOf<UnionToIntersection<ListBox<DistinctParameterLists<SlotParameterLists<F, 6>, TThis>, V, F>>>,
  LastBoxes<TThis, V, F>
]>
type EarlierSlot = 0 | 1 | 2 | 3 | 4 | 5
// The boxes of the last overloads are made variant by variant (the boxes of the lists of several variants are one
// type), so that they are created, and intersected, in the order of the variants: a call that the lists of several
// variants accept (with `Arg.any()`) resolves to the first variant's list, as with the boxes per variant before T49.
// (The boxes of variants that share a list are the same type, which the intersection keeps once.)
type LastBoxes<TThis, V extends SubstituteView, F> = BoxesOf<UnionToIntersection<VariantBoxes<F, TThis, V, F>>>
type VariantBoxes<TVariant, TThis, V extends SubstituteView, F> =
  TVariant extends unknown ? ListBox<DistinctParameterLists<ParameterListOf<Overloads<TVariant>[7]>, TThis>, V, F> : never
type BoxesOf<TBoxes> = TBoxes extends SignatureBox ? TBoxes : SignatureBox
type SignaturesOfBoxes<B extends SignatureBox[]> =
  FieldOfBoxes<B, 6> & FieldOfBoxes<B, 5> & FieldOfBoxes<B, 4> & FieldOfBoxes<B, 3> & FieldOfBoxes<B, 2> &
  FieldOfBoxes<B, 1> & FieldOfBoxes<B, 'more'> & FieldOfBoxes<B, 'full'> & FieldOfBoxes<B, 'allArguments'> &
  FieldOfBoxes<B, 0>
type FieldOfBoxes<B extends SignatureBox[], K extends keyof SignatureBox> = B[0][K] & B[1][K] & B[2][K]
type SignatureBox = {
  0: unknown, 1: unknown, 2: unknown, 3: unknown, 4: unknown, 5: unknown, 6: unknown, more: unknown, full: unknown,
  allArguments: unknown
}

// The parameter lists of the overloads of the variants of `TFunction` (in some slots, see above), as tuples without
// parameter names (`UnnamedArguments`): the same parameter list declared in several interfaces is then one type (since
// TypeScript 4.0 a tuple with names is told apart by the declarations of its names). Callback parameters that declare
// a `this` type get the `this` types of all such callbacks of the member (`CallbackThisTypes`): lib.dom's elements
// each declare `addEventListener(type, listener: (this: HTMLAnchorElement, ev: ...) => any)` with their own `this`
// type, and without this their parameter lists would all be different. (A callback without parameter types in a call
// of a union such as `HTMLInputElement | HTMLSelectElement` then has `this` typed as either element.)
type DistinctParameterLists<TLists, TThis> = TLists extends any[] ?
  UnnamedArguments<[TThis] extends [never] ? TLists : Extract<WithCallbackThis<TLists, TThis>, any[]>> :
  never
type AllParameterLists<TFunction> =
  SlotParameterLists<TFunction, EarlierSlot> | SlotParameterLists<TFunction, 6> | SlotParameterLists<TFunction, 7>
type SlotParameterLists<TVariant, TSlot extends number> = TVariant extends unknown ? ParameterListOf<Overloads<TVariant>[TSlot]> : never
type ParameterListOf<TOverload> = TOverload extends Overload<any[], any> ? TOverload['arguments'] : never
// Not distributive over a parameter's own type (`keyof HTMLElementEventMap` is a union of many literals); `any` gives
// no `this` type (`unknown extends any`).
type CallbackThisTypes<TLists> = TLists extends any[] ? CallbackThisTypesOf<TLists>[number] : never
type CallbackThisTypesOf<TList> = { [P in keyof TList]-?: CallbackThisType<TList[P]> }
type CallbackThisType<TParameter> =
  [TParameter] extends [(this: infer TThis, ...args: any[]) => any] ? (unknown extends TThis ? never : TThis) : never
type WithCallbackThis<TList, TThis> = { [P in keyof TList]: WithThis<TList[P], TThis> }
type WithThis<TParameter, TThis> =
  [TParameter] extends [(this: infer TOwnThis, ...args: infer A) => infer R] ?
  (unknown extends TOwnThis ? TParameter : CallbackWithThis<TThis, UnnamedArguments<Extract<A, any[]>>, R>) :
  TParameter
// A separate alias, so that the callbacks of several variants that differ only in their `this` type give one type.
type CallbackWithThis<TThis, A extends any[], R> = (this: TThis, ...args: A) => R

// A callback whose `this` is annotated with the type of one variant (`function (this: Btn, n: number) {}`) does not fit
// a callback with all the `this` types of the member (`TThis`, the signatures above), as `this` is compared
// contravariantly. Such calls resolve to one more signature (R8TD-3, T56), which takes the parameter lists of the
// variants as they declare them: with `onClick(cb: (this: Btn, n: number) => void)` in one variant and `onClick(cb:
// (this: Lnk, n: number) => void)` in the other, `onClick` takes `function (this: Btn, n: number)` and `function (this:
// Lnk, n: number)`, while with `on(cb: (this: E1, x: string) => void)` and `on(cb: (this: E2, x: number) => void)`,
// `on(function (this: E2, x: string) {})` does not compile. A call is checked against each list as a whole, as
// TypeScript checks a call of the union itself: with `both(a: (this: C1) => void, b: (this: C1) => void)` and the same
// with `C2`, `both(function (this: C1) {}, function (this: C2) {})` does not compile (R9TD-2, T62). Its parameter list
// is the constraint of its type parameter, which TypeScript only computes when a call gets to this signature, and being
// generic, it is left out when TypeScript compares the signatures of the variants of a union, which made such unions of
// callbacks very slow to check on TypeScript 3.6 for lib.dom's elements.
// (The lists are passed in: computing them in the constraint made TypeScript 3.6 and 4.1 report "Type instantiation is
// excessively deep" for the call. The checks for `never` test `TThis & {}`, not `[TThis]`: TypeScript 4.1 and older
// decided `[TThis] extends [never]` too early, while `TThis` was still a type parameter.)
type OwnThisSignature<TThis, V extends SubstituteView, F> = (TThis & {}) extends never ? unknown :
  <P extends ArgumentValue[]>(...args: P & OwnThisArguments<P, AllParameterLists<F>>) =>
    OwnThisCallResult<V, P, F>
// The arguments `P` fit one of the lists of the variants. Only checked for calls that pass a callback with a `this` type
// of its own: calls with `Arg.any()` arguments, which TypeScript tries with this signature first, do not compute these
// lists.
// (The lists are wrapped in a tuple, so that TypeScript computes them only when it checks the arguments, not when it
// infers `P` for a call with `Arg.any()` arguments. TypeScript 3.9 and 4.0 decide `[P] extends [...]` already when
// they check this declaration (with `skipLibCheck` off), with `any` for the type parameters: `OwnThisLists` stops at
// `any`, which otherwise made them report "Type instantiation is excessively deep".)
// A call whose last argument is `Arg.all()` (`onClick(function (this: Btn, n: number) {}, Arg.all())`) fits when its
// leading arguments fit the first parameters of one of the lists, and that list has a parameter where `Arg.all()` is
// passed, as for the other `Arg.all()` signatures (R11TD-4, T70): `AllArgumentsLists` are those leading parameters
// followed by `Arg.all()`, after 1 to 6 parameters.
type OwnThisArguments<P extends any[], TAllLists> =
  (CallbackThisTypes<P> & {}) extends never ? never :
  [P] extends [OwnThisLists<TAllLists> | AllArgumentsLists<OwnThisLists<TAllLists>>] ? unknown : never
type OwnThisLists<TAllLists> = IsAny<TAllLists> extends true ? any[] : TAllLists
type AllArgumentsLists<TLists> = TLists extends any[] ? AllArgumentsListsOf<TLists> : never
type AllArgumentsListsOf<A extends any[]> = [Exclude<A['length'], 0 | 1>] extends [never] ? never :
  [A[0], AllArgumentsAny] | ([Exclude<A['length'], 0 | 1 | 2>] extends [never] ? never :
  [A[0], A[1], AllArgumentsAny] | ([Exclude<A['length'], 0 | 1 | 2 | 3>] extends [never] ? never :
  [A[0], A[1], A[2], AllArgumentsAny] | ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4>] extends [never] ? never :
  [A[0], A[1], A[2], A[3], AllArgumentsAny] | ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5>] extends [never] ? never :
  [A[0], A[1], A[2], A[3], A[4], AllArgumentsAny] | ([Exclude<A['length'], 0 | 1 | 2 | 3 | 4 | 5 | 6>] extends [never] ? never :
  [A[0], A[1], A[2], A[3], A[4], A[5], AllArgumentsAny])))))
type AllArgumentsAny = AllArguments<any>
// The result takes what the overloads return whose parameter lists take the arguments `P` (the variant whose `this`
// type the callback declares: `onClick(function (this: Btn, n: number) {})` returns what `Btn`'s `onClick` returns),
// or, when every overload returns the same type, that type (see `UnionReturnType`; the per-overload result of a union
// of all lib.dom elements, whose listener methods all return `void`, was too complex for TypeScript to represent).
// (Not `PrefixCallResult`, which was `never` on TypeScript 4.1 and older when the call omits optional parameters,
// R9TD-1, T62.)
type OwnThisCallResult<V extends SubstituteView, P extends any[], F> =
  V extends 'assertion' ? void : SetupResult<V, P, OwnThisReturnType<F, P>>
type OwnThisReturnType<F, P> = {
  same: { returnType: AllReturnTypes<F> }
  [differs: number]: { returnType: OwnThisReturnTypes<F, P> }
}[ReturnsKind<F, AllReturnTypes<F>>]['returnType']
type OwnThisReturnTypes<F, P> = F extends unknown ? OverloadReturnTypeFor<Overloads<F>[number], P> : never
type OverloadReturnTypeFor<TOverload, P> =
  TOverload extends Overload<infer A, infer R> ? ([P] extends [A | AllArgumentsListsOf<A>] ? R : never) : never

// The signatures of one distinct parameter list `A`: for each number of arguments `n` from 0 to 6 that the list
// accepts, a positional signature that takes exactly `n` arguments, its first `n` parameters (T45, R6TD-1); in `more`,
// the signature for more than 6 arguments (also with a rest parameter); in `full`, the signature with the whole list;
// and the `Arg.all()` signatures. A call that omits optional parameters (`get('k')` of `get(key: string, options?:
// OptionsV1)` and `get(key: string, options?: OptionsV2)`) then resolves to a signature with just the parameters it
// passes, whose result takes what every variant that accepts these arguments returns (see `PrefixCallResult`). `list`
// keeps the boxes of different lists apart: TypeScript would otherwise infer only one box for `UnionToIntersection`
// when the box of one list is assignable to the box of another.
type ListBox<A, TView extends SubstituteView, TFunction> = A extends any[] ? {
  list: (list: A) => A
  0: PrefixSignature<A, 0, TView, TFunction>
  1: PrefixSignature<A, 1, TView, TFunction>
  2: PrefixSignature<A, 2, TView, TFunction>
  3: PrefixSignature<A, 3, TView, TFunction>
  4: PrefixSignature<A, 4, TView, TFunction>
  5: PrefixSignature<A, 5, TView, TFunction>
  6: PrefixSignature<A, 6, TView, TFunction>
  more: PrefixSignature<A, 7, TView, TFunction>
  full: FullSignature<A, TView, TFunction>
  allArguments: UnionAllArgumentsSignaturesFor<A, TView, TFunction>
} : never
// The signature of a parameter list for exactly `TCount` arguments (7: more than 6, with the whole list), otherwise
// `unknown`.
type PrefixSignature<A extends any[], TCount extends ArgumentCount, TView extends SubstituteView, TFunction> =
  ArgumentCounts[TCount] extends A ? PrefixSignatureOf<Extract<PrefixOf<A, TCount>, any[]>, A, TView, TFunction> : unknown
// The signature of a parameter list with all its parameters (the optional ones included). Calls resolve to the
// signatures above first; these make sure that when TypeScript calls the union, it finds the same parameter list as
// a variant's own method among the substitute's signatures and leaves the plain method out. (TypeScript tries a
// signature whose parameters have literal types, such as `read(path: string, encoding?: 'buffer')`, first.)
type FullSignature<A extends any[], TView extends SubstituteView, TFunction> = PrefixSignatureOf<A, A, TView, TFunction>
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
// The result of a call with the arguments `P` that resolves to a signature of the parameter list `A`: it takes what the
// variants return whose overloads accept calls with the parameters `A` (see `UnionReturnTypes`), and what those
// return whose overloads accept the arguments `P` (`get('k')` above: `number | string`).
type PrefixCallResult<V extends SubstituteView, P extends any[], A extends any[], F> =
  V extends 'assertion' ? void : SetupResult<V, P, UnionReturnType<F, A> | UnionReturnType<F, P>>
// A single `Arg.all()` matches every call, so its result takes what any overload of any variant returns (T45, R6TD-1).
type UnionAllArgumentsSignaturesFor<A extends any[], V extends SubstituteView, F> =
  ((allArguments: AllArguments<A>) => CallResult<V, A, AllReturnTypes<F>, never>) &
  TrailingAllArgumentsSignatures<A, unknown, V, F>

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
/**
 * `any` for a union (told apart from its variants by type identity), `'single'` for any other type. In generic code
 * TypeScript cannot decide it and uses `'single'`.
 */
export type VariantsKind<TFunction> = true extends IsUnion<TFunction, TFunction> ? any : 'single'
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

/**
 * `'call'` when `TFunction` (a member type without `null | undefined`) is callable, otherwise `'plain'`. In generic
 * code it is decided by the member's constraint.
 */
export type CallKind<TFunction> = CallKindOf<ObjectKind<TFunction>, TFunction>
type CallKindOf<TKind, TFunction> = TKind extends 'object' ? EachCallKind<TFunction> : 'plain'
