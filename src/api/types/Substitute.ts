import { ConfigurationResult, SetupMethods } from './SubstitutionLevel'
import { FunctionSubstitute } from './FunctionSubstitute'

/**
 * The setup API of a member read on a substitute (`sub.isEnabled.returns(true)`). The value itself is not part of it:
 * `SubstituteOf<T>` intersects the members with `T`, which supplies it. Intersecting the value here as well would
 * multiply a large union member type with itself (lib.dom's `HTMLInputElement.autocomplete`, TS2590, TD-8).
 */
export type PropertySubstitute<TValue> = SetupMethods<TValue, () => TValue>

/**
 * The object type whose members the views below map.
 * A type with a string index signature is mapped directly: a homomorphic mapping over it keeps the named members next to
 * the index signature (T:TY-8), whereas `keyof T` is just `string | number`. Any other type is first turned into a plain
 * object type with the same members, so that primitives (`Substitute.for<string>()`) and arrays are mapped member by
 * member too (a homomorphic mapping would return a primitive unchanged and only map the elements of an array).
 */
type Members<T> = string extends keyof T ? T : Pick<T, keyof T>

// The views are mapped with `-?` and expand calls from the member type without `null | undefined`, so optional members
// (`prop?`, `method?()`) are configured and asserted like required ones (T:TY-7).
//
// Members whose type is only `null` and/or `undefined` (`error?: undefined`, `ownerDocument: null`) get no setup API:
// there is nothing to configure, and an object type intersected with `null` would reduce the whole substitute to
// `never` (TD-1, T25). They are `unknown` here, so that `SubstituteOf<T>` gives them their plain type from `T`.
// For a property whose type is an unresolved type parameter (`current: T` in generic code), TypeScript cannot decide
// this check and only keeps what both branches have, i.e. nothing: such a property has no setup API in generic code.
// It is configured through `sub[configure]().current`. (Calls are not affected: their results never meet `T`'s own
// property types, so they keep the setup API in both branches; see `SubstitutionResult`.)
//
// Special members (T:TY-16, D20). At runtime a substitute never exposes `then`, so that it is not a thenable
// (`await sub` resolves to the substitute itself); the typings make `then` `never`. `toJSON` is answered by the
// substitute itself (it serializes the substitute): it keeps its declared type on the substitute (through `& T`) but
// has no setup API, and it cannot be configured or asserted.
// Symbol.toPrimitive and util.inspect.custom are special-cased at runtime as well but are not reflected here.

type SubstituteMember<TValue> = FunctionSubstitute<NonNullable<TValue>, 'substitute'> & PropertySubstitute<TValue>

type SubstituteMembers<T> = {
  [P in keyof T]-?:
    P extends 'then' ? never :
    P extends 'toJSON' ? unknown :
    [NonNullable<T[P]>] extends [never] ? unknown :
    SubstituteMember<T[P]>
}

/** The members of a substitute (without the assertion and configuration methods). */
export type ObjectSubstituteTransformation<T> = SubstituteMembers<Members<T>>

// In the assertion view, a member that is not callable keeps its declared type, including `undefined` for an optional
// property (`sub.received().note = undefined`, TD-7). A callable member offers the assertion signatures (calls return
// nothing) on the member type without `null | undefined`.
type AssertionMember<TValue> = FunctionSubstitute<NonNullable<TValue>, 'assertion'> & TValue

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
 * member type (`sub.received().isEnabled = true`).
 */
export type TerminatingObject<T> = string extends keyof T ? IndexedAssertionMembers<T> : AssertionMembers<T>

type ConfigurationMember<TValue> =
  FunctionSubstitute<NonNullable<TValue>, 'configure'> & ConfigurationResult<TValue, () => TValue>

type ConfigurationMembers<T> = {
  [P in keyof T]-?:
    P extends 'then' ? never :
    P extends 'toJSON' ? never :
    ConfigurationMember<T[P]>
}

/**
 * The object returned by `sub[configure]()`. Member reads and calls on it are always setups, so they only expose the
 * setup API. The string forms (`.returns`, `.throws`, ...) are always offered here: the configured value is never
 * returned from this view, so there is nothing for them to conflict with.
 */
export type ConfigureView<T> = ConfigurationMembers<Members<T>>
