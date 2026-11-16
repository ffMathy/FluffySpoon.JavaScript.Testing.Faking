// Type-level helpers shared by the public typings.
// Keep these compatible with old TypeScript versions: no `as` clauses in mapped types, no template literal types,
// no variadic tuples and no `infer X extends Y` (see `npm run test:types:min-ts`).

export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

export type IsNever<T> = [T] extends [never] ? true : false

export type IsAny<T> = 0 extends (1 & T) ? true : false

/**
 * The non-nullish primitive types. They are not callable, and the typings assume that they have no members named like
 * the library's methods.
 */
export type Primitive = string | number | boolean | bigint | symbol

// Kinds: generic code
// -------------------
// In generic code (`SubstituteOf<T>` with `T extends Calculator`) a member type such as `T['total']` is a type
// parameter, and TypeScript cannot decide a conditional type on it. When such a deferred conditional type is used (a
// property of it is read, it is called, ...), TypeScript resolves it through its constraint:
// - a conditional type whose checked type is a naked type parameter (distributive) is computed with the constraint
//   of the checked type, e.g. `T['total']` becomes `number`;
// - any other conditional type stands for the union of its two branches, except that a branch of type `any` is left
//   out.
// The typings use both rules to decide in generic code what they decide for concrete types (T33). A "kind" is a
// conditional type that gives `any` for the case generic code should not take, and a string literal otherwise; a
// distributive conditional type over the kind then picks the type. For a concrete `any` kind, that conditional type
// gives the union of both branches.

/**
 * `any` for primitives (also `never` and `any` themselves), `'object'` for any other type. In generic code it is
 * `'object'`.
 */
export type ObjectKind<T> = [T] extends [Primitive] ? any : 'object'

/**
 * `any` for a type that is only `null` and/or `undefined` (or `never`), `'value'` otherwise. In generic code it is
 * `'value'`.
 */
export type ValueKind<T> = [NonNullable<T>] extends [never] ? any : 'value'

/**
 * `'indexed'` for a type with a string index signature, `'plain'` otherwise. In generic code it is decided by the
 * constraint of the type parameter (`'plain'` for an unconstrained one).
 */
export type IndexKind<T> = IndexKindOf<T & {}>
type IndexKindOf<T> = T extends unknown ? (string extends keyof T ? 'indexed' : 'plain') : never

/** The names the library uses: these are the names whose presence in a type the typings check. */
export type LibraryMemberName = 'received' | 'didNotReceive' | 'returns' | 'throws' | 'resolves' | 'rejects' | 'mimicks'

// The keys of T without those that only exist through a string index signature.
type KnownKeys<T> = string extends keyof T ?
  { [K in keyof T]: string extends K ? never : number extends K ? never : K }[keyof T] :
  keyof T

// A private member is not part of `keyof T`, but a public member with the same name cannot coexist with it: the
// intersection reduces to `never` (TypeScript >= 3.9). The probes have to be written out: the reduction does not
// happen for the properties of a mapped type such as `{ [P in K]: unknown }`.
type PrivateMemberProbe = {
  received: { received: unknown }
  didNotReceive: { didNotReceive: unknown }
  returns: { returns: unknown }
  throws: { throws: unknown }
  resolves: { resolves: unknown }
  rejects: { rejects: unknown }
  mimicks: { mimicks: unknown }
}

/**
 * `true` when `T` has a public or private member named `K`, otherwise `false`. A protected member does not count (it
 * does not clash with a public member of the same name), and neither does an index signature. The check is not
 * distributive: for a union `T` it is `true` only when every member of the union has `K`.
 */
export type HasMember<T, K extends LibraryMemberName> =
  IsAny<T> extends true ? true :
  [K] extends [KnownKeys<T>] ? true :
  [T & PrivateMemberProbe[K]] extends [never] ? true :
  false

/** `true` when `T` has a member with at least one of the names in `K`. */
export type HasAnyMember<T, K extends LibraryMemberName> =
  true extends (K extends LibraryMemberName ? HasMember<T, K> : never) ? true : false
