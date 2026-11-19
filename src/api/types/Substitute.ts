import { ConfigurationResult, SetupMethods } from './SubstitutionLevel'
import { CallKind, FunctionSubstitute, VariantsKind } from './FunctionSubstitute'
import { GenericKind, IndexKind, IsUnion, ValueKind } from './Utilities'

/**
 * The setup API of a member read on a substitute (`sub.isEnabled.returns(true)`). The value itself is not part of it:
 * `SubstituteOf<T>` intersects the members with `T`, which supplies it. Intersecting the value here as well would
 * multiply a large union member type with itself (lib.dom's `HTMLInputElement.autocomplete`, TS2590, TD-8).
 */
export type PropertySubstitute<TValue> = SetupMethods<TValue, () => TValue>

/**
 * The object type whose keys the views below map.
 * A type with a string index signature is mapped directly: a homomorphic mapping over it keeps the named members next to
 * the index signature (T:TY-8), whereas `keyof T` is just `string | number`. Any other type is first turned into a plain
 * object type with the same members, so that primitives (`Substitute.for<string>()`) and arrays are mapped member by
 * member too (a homomorphic mapping would return a primitive unchanged and only map the elements of an array), and so
 * that a union (`Cat | Dog`) is mapped as one object type with the members its variants have in common.
 * In generic code it is the type parameter itself: there `T['total']` accepts the values of the constraint's member type
 * (`sub.total.returns(1)` with `T extends Calculator`, T33), and `Pick<T, keyof T>['total']` does not. The choice is an
 * indexed access whose key is `any` for the plain object type: an object type indexed with `any` gives its string index
 * signature, and in generic code, where `MembersKind` cannot be decided, TypeScript leaves out its `any` branch and
 * takes `T`. (`MembersKind` is not distributive, so a union is not split.)
 */
type Members<T> = { indexed: IndexedMembers<T>, [plain: string]: Pick<T, keyof T> }[MembersKind<T>]
type MembersKind<T> = string extends keyof T ? 'indexed' : any

// A union of types with a string index signature (`{ kind: 'a'; [key: string]: unknown; speak(): 'meow' } | { kind:
// 'b'; ...; speak(): 'woof' }`, R6TD-3, T48): the homomorphic mapping would map each variant on its own, so that
// `speak` had the setup API of each variant's `speak` and `.returns()` took only what both return (`never`). Such a
// union is mapped as one type instead: its named members, each with the union of the variants' member types (which
// then takes the combined signatures of T39/T42), next to its string index signature. The choice is an indexed access
// as for the kinds in Utilities.ts; in generic code, where `IsUnion` cannot be decided, it is `T` itself.
type IndexedMembers<T> = { indexed: T, [union: number]: IndexedUnionMembers<T> }[IndexedUnionKind<T>]
type IndexedUnionKind<T> = IsUnion<T> extends true ? any : 'indexed'
type IndexedUnionMembers<T> = { [P in NamedKeys<T>]: T[P] } & { [key: string]: StringIndexOf<T> }
type StringIndexOf<T> = T extends { [key: string]: infer V } ? V : never
// The keys of the members of `T` that are declared by name (`keyof T` of a type with a string index signature is just
// `string | number`). They are inferred from a mapping of `T` whose values are the keys, with a target mapped over the
// keys of that mapping, which every TypeScript version infers them from (R7TD-3, T53: a target mapped over `keyof T`
// worked on 4.2 and older only, a target with a string index signature on 4.4 and newer, and neither on 4.3).
type NamedKeys<T> = NamedKeyMapping<T> extends { [P in keyof NamedKeyMapping<T>]: infer K } ? Extract<K, PropertyKey> : never
type NamedKeyMapping<T> = { [P in keyof T]: string extends P ? never : number extends P ? never : P }

// The views are mapped with `-?` and expand calls from the member type without `null | undefined`, so optional members
// (`prop?`, `method?()`) are configured and asserted like required ones (T:TY-7).
//
// Members whose type is only `null` and/or `undefined` (`error?: undefined`, `ownerDocument: null`) get no setup API:
// there is nothing to configure, and an object type intersected with `null` would reduce the whole substitute to
// `never` (TD-1, T25). They are `unknown` here, so that `SubstituteOf<T>` gives them their plain type from `T`.
// In generic code that check cannot be decided, and the member gets the setup API (`ValueKind`): a property whose type
// is the type parameter itself (`current: T`) can be configured there as well (T26, T33).
//
// Special members (T:TY-16, D20). At runtime a substitute never exposes `then`, so that it is not a thenable
// (`await sub` resolves to the substitute itself); the typings make `then` `never`. `toJSON` is answered by the
// substitute itself (it serializes the substitute): it keeps its declared type on the substitute (through `& T`) but
// has no setup API, and it cannot be configured or asserted.
// The other keys the runtime special-cases (Symbol.toPrimitive, util.inspect.custom, the well-known symbols, ...) are
// not reflected here.

type SubstituteMember<TValue> = FunctionSubstitute<NonNullable<TValue>, 'substitute'> & PropertySubstitute<TValue>

// For a concrete `any` kind (a member that is only null/undefined) this is `SubstituteMember<TValue> | unknown`, which
// is `unknown`.
type SubstituteMemberOf<TKind, TValue> = TKind extends 'value' ? SubstituteMember<TValue> : unknown

// Keys that exist only through a string index signature (T41, R4TD-3): in the mappings below their template is
// instantiated with `P = string`. In generic code (`T extends { [key: string]: number; port: number }`, `sub.timeout`),
// `TMembers[P]` is then `T[string]`, and TypeScript never lets a value be written to `T[string]` of a type parameter (a
// subtype could have a narrower index signature): `.returns(5)` would take nothing. There the member is computed by a
// conditional type distributive over `TMembers`, which TypeScript resolves with the constraint when the member is used
// (`.returns()` takes the constraint's index signature type, `number`). For a union constraint that is computed per
// variant. For a concrete type nothing changes (`GenericKind` is `any`, which selects the number index signature).
type IndexSignatureMember<TMembers, P extends keyof TMembers> = {
  generic: EachSubstituteMember<TMembers, P>
  [concrete: number]: SubstituteMemberOf<ValueKind<TMembers[P]>, TMembers[P]>
}[GenericKind<TMembers>]
type EachSubstituteMember<TMembers, P extends keyof TMembers> =
  TMembers extends unknown ? SubstituteMemberOf<ValueKind<TMembers[P]>, TMembers[P]> : never

type SubstituteMembers<TMembers> = {
  [P in keyof TMembers]-?:
    P extends 'then' ? never :
    P extends 'toJSON' ? unknown :
    string extends P ? IndexSignatureMember<TMembers, P> :
    SubstituteMemberOf<ValueKind<TMembers[P]>, TMembers[P]>
}

/** The members of a substitute (without the assertion and configuration methods), each with its setup API. */
export type ObjectSubstituteTransformation<T> = SubstituteMembers<Members<T>>

// Unions whose variants declare a member as only null/undefined (T36, R3TD-4):
//   { data: string[]; error: null } | { data: null; error: Error }
//   { ok: true; value: string; error?: undefined } | { ok: false; value?: undefined; error: Error }
// The members above are mapped from the members the variants have in common, so `data` has the setup API of
// `string[] | null`. `SubstituteOf<T>` intersects them with `T`, i.e. with each variant, and in the variant where
// `data` is `null` the setup API meets `null`. That gives `never`, and TypeScript drops a variant that has a `never`
// member which is `null` or a literal in one of the intersected types. When every variant has such a member, the whole
// substitute became `never`.
// The patch below gives such a member the type `never` itself in that variant. TypeScript keeps a variant in which one
// of the intersected types declares the member as `never`, so every variant is kept. The member then reads as the
// setup API intersected with the other variants' types (`result.data` is `string[]` with `.returns(...)`), and each
// variant of the substitute is still assignable to that variant of `T`.

// The members that are only null/undefined in `TVariant` but not in every variant of `T`.
type VariantNullKeys<TVariant, T> = {
  [P in keyof TVariant]-?:
    [NonNullable<TVariant[P]>] extends [never] ? (P extends keyof T ? ([NonNullable<T[P]>] extends [never] ? never : P) : never) :
    never
}[keyof TVariant]

// `unknown` for a type that is not a union (and in generic code, where the check cannot be decided).
type VariantPatch<TVariant, T> = [T] extends [TVariant] ? unknown : { [P in VariantNullKeys<TVariant, T>]: never }

/** For a union `T`, a union of one patch per variant (see above); `unknown` for any other type. */
export type UnionVariantPatch<T> = UnionVariantPatchOf<T & {}, T>
type UnionVariantPatchOf<TVariant, T> = TVariant extends unknown ? VariantPatch<TVariant, T> : never

// In the assertion view, a member that is not callable keeps its declared type, including `undefined` for an optional
// property (`sub.received().note = undefined`, TD-7). A callable member offers the assertion signatures (calls return
// nothing) on the member type without `null | undefined`.
// The choice is an indexed access rather than a conditional type: in generic code TypeScript checks a value assigned
// to it against the member type of the constraint (`sub.received().total = 1` with `T extends Calculator`, T33), which
// it never does for a conditional type.
type AssertionMember<TValue> = {
  call: AssertionCallMember<TValue>
  plain: TValue
}[AssertionKind<ValueKind<TValue>, TValue>]

// A member whose type is a union of function types (one per variant of a union `T`, such as lib.dom's
// `addEventListener` in the union of all elements) is not intersected with that union: TypeScript would distribute
// the intersection over the variants and compare the signatures of every variant with those of every other one when
// the member is called, which made checks of such members slow to type-check (R8TD-8, T57). The signatures of the
// assertion view already take every parameter list of every variant (see `FunctionSubstitute`), and the member's own
// signatures return what is checked anyway. The member type is kept when it has properties of its own or includes
// `null | undefined`. (`VariantsKind` is `'single'` in generic code.)
// Instead, such a member gets a construct signature (`NotAssignable`), which no function has: assigning a function to
// it in a check (`pet.received().speak = () => {}`) does not compile, as for any other callable member, whose call
// signatures that take `Arg.all()` reject a function with parameters, and as TypeScript rejects a function that does
// not fit the union (R9TD-5, T62). A call signature would have done that as well, but made calls of such members
// costlier to type-check; a construct signature is not looked at for calls. It returns a branded type that only `any`
// is assignable to, so that the function matcher `Arg.any('function')`, which is typed as any function or constructor
// (constructing `any`), still fits (R11TD-2, T67), while a real constructor does not: `String`, `Boolean`, `Date` or a
// class construct instances that lack the brand, and are rejected as TypeScript rejects them for the union (R12TD-2,
// T71). (`unknown` would accept every constructor, `never` would reject `Arg.any('function')`.)
type AssertionCallMember<TValue> = {
  single: FunctionSubstitute<NonNullable<TValue>, 'assertion'> & TValue
  [union: number]: FunctionSubstitute<NonNullable<TValue>, 'assertion'> & UnionAssertionRest<TValue>
}[VariantsKind<NonNullable<TValue>>]
type UnionAssertionRest<TValue> =
  [keyof NonNullable<TValue>] extends [never] ? ([Extract<TValue, null | undefined>] extends [never] ? NotAssignable : TValue) : TValue
type NotAssignable = new (...args: never[]) => NotAssignableInstance
declare const notAssignable: unique symbol
interface NotAssignableInstance { readonly [notAssignable]: true }

// For a concrete `any` kind (a member that is only null/undefined) this is `CallKind<never> | 'plain'`, i.e. `'plain'`.
type AssertionKind<TKind, TValue> = TKind extends 'value' ? CallKind<NonNullable<TValue>> : 'plain'

type AssertionMemberOf<T, P extends keyof T> =
  P extends 'then' ? never :
  P extends 'toJSON' ? never :
  AssertionMember<T[P]>

// For a type with a string index signature, the homomorphic mapping (with `-?`) keeps the named members next to the
// index signature (T:TY-8); `-?` removes `undefined` from optional named members there.
type IndexedAssertionMembers<T> = { [P in keyof T]-?: AssertionMemberOf<T, P> }

// Every other type is mapped over its keys without copying the modifiers (the key set is not written as `keyof T`):
// all members are required, and an optional property keeps `undefined` in its type, which `-?` would remove.
type AssertionMembers<T> = { [P in Extract<keyof T, PropertyKey>]: AssertionMemberOf<T, P> }

/**
 * The object returned by `received()` / `didNotReceive()`: calls return nothing, property reads and writes keep the
 * member type (`sub.received().isEnabled = true`). A substitute of a function type is callable here as well
 * (`listener.received(1)('saved')`, T37).
 */
export type TerminatingObject<T> =
  { indexed: IndexedAssertionMembers<T>, plain: AssertionMembers<T> }[IndexKind<T>] &
  FunctionSubstitute<NonNullable<T>, 'assertion'>

type ConfigurationMember<TValue> =
  FunctionSubstitute<NonNullable<TValue>, 'configure'> & ConfigurationResult<TValue, () => TValue>

// See `IndexSignatureMember`.
type IndexSignatureConfiguration<TMembers, P extends keyof TMembers> = {
  generic: EachConfigurationMember<TMembers, P>
  [concrete: number]: ConfigurationMember<TMembers[P]>
}[GenericKind<TMembers>]
type EachConfigurationMember<TMembers, P extends keyof TMembers> =
  TMembers extends unknown ? ConfigurationMember<TMembers[P]> : never

type ConfigurationMembers<TMembers> = {
  [P in keyof TMembers]-?:
    P extends 'then' ? never :
    P extends 'toJSON' ? never :
    string extends P ? IndexSignatureConfiguration<TMembers, P> :
    ConfigurationMember<TMembers[P]>
}

/**
 * The object returned by `sub[configure]()`. Member reads and calls on it are always setups, so they only expose the
 * setup API. The string forms (`.returns`, `.throws`, ...) are always offered here: the configured value is never
 * returned from this view, so there is nothing for them to conflict with. A substitute of a function type is callable
 * here as well (`listener[configure]()('saved').returns('ack')`, T37).
 */
export type ConfigureView<T> = ConfigurationMembers<Members<T>> & FunctionSubstitute<NonNullable<T>, 'configure'>
