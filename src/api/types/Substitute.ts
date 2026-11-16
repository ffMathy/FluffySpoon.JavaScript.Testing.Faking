import { ConfigurationResult, SetupMethods } from './SubstitutionLevel'
import { CallKind, FunctionSubstitute } from './FunctionSubstitute'
import { IndexKind, ValueKind } from './Utilities'

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
 * The member types are read from `T` itself (`Member<T, P>`), not from this object type: in generic code `T['total']`
 * accepts the values of the constraint's member type, `Pick<T, keyof T>['total']` does not (T33).
 */
type Members<T> = { indexed: T, plain: Pick<T, keyof T> }[IndexKind<T>]

type Member<T, P> = T[P & keyof T]

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

type SubstituteMembers<TMembers, T> = {
  [P in keyof TMembers]-?:
    P extends 'then' ? never :
    P extends 'toJSON' ? unknown :
    SubstituteMemberOf<ValueKind<Member<T, P>>, Member<T, P>>
}

/** The members of a substitute (without the assertion and configuration methods), each with its setup API. */
export type ObjectSubstituteTransformation<T> = SubstituteMembers<Members<T>, T>

// In the assertion view, a member that is not callable keeps its declared type, including `undefined` for an optional
// property (`sub.received().note = undefined`, TD-7). A callable member offers the assertion signatures (calls return
// nothing) on the member type without `null | undefined`.
// The choice is an indexed access rather than a conditional type: in generic code TypeScript checks a value assigned
// to it against the member type of the constraint (`sub.received().total = 1` with `T extends Calculator`, T33), which
// it never does for a conditional type.
type AssertionMember<TValue> = {
  call: FunctionSubstitute<NonNullable<TValue>, 'assertion'> & TValue
  plain: TValue
}[AssertionKind<ValueKind<TValue>, TValue>]

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
 * member type (`sub.received().isEnabled = true`).
 */
export type TerminatingObject<T> = { indexed: IndexedAssertionMembers<T>, plain: AssertionMembers<T> }[IndexKind<T>]

type ConfigurationMember<TValue> =
  FunctionSubstitute<NonNullable<TValue>, 'configure'> & ConfigurationResult<TValue, () => TValue>

type ConfigurationMembers<TMembers, T> = {
  [P in keyof TMembers]-?:
    P extends 'then' ? never :
    P extends 'toJSON' ? never :
    ConfigurationMember<Member<T, P>>
}

/**
 * The object returned by `sub[configure]()`. Member reads and calls on it are always setups, so they only expose the
 * setup API. The string forms (`.returns`, `.throws`, ...) are always offered here: the configured value is never
 * returned from this view, so there is nothing for them to conflict with.
 */
export type ConfigureView<T> = ConfigurationMembers<Members<T>, T>
