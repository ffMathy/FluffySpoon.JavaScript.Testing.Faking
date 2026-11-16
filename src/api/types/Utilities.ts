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
