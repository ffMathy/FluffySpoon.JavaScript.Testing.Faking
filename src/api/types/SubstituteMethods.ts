import { constants } from '../../shared'
import { CheckViewOf, ConfigureView } from './Substitute'
import { GenericKind, HasAnyMember, LibraryMemberName } from './Utilities'

/**
 * Starts an assertion: `sub[received]()` (1 or more times) or `sub[received](n)` (exactly `n` times), followed by the
 * member access, call or property set to check, e.g. `calculator[received](2).add(1, Arg.any())`.
 * The symbol form always works, also when the substituted type has its own member called `received`, and in generic
 * code.
 */
export const received: typeof constants.CONTEXT.received.symbol = constants.CONTEXT.received.symbol
/**
 * Starts an assertion that the following member access, call or property set never happened:
 * `sub[didNotReceive]().add(1, 2)`. Same as `sub[received](0)`.
 */
export const didNotReceive: typeof constants.CONTEXT.didNotReceive.symbol = constants.CONTEXT.didNotReceive.symbol
/**
 * Makes a substitute delegate to a real instance: `sub[mimick](instance)`. Every member access, call or set without a
 * matching substitution goes to `instance`; calls are still recorded for assertions. For an object type, `instance`
 * may have only some of the members (`client[mimick]({ baseUrl: '' })`). Symbol-only: a string `mimick` is always an
 * ordinary member of the substituted type.
 */
export const mimick: typeof constants.CONTEXT.mimick.symbol = constants.CONTEXT.mimick.symbol
/**
 * Clears the calls received so far by a substitute (and its auto-substitutes): `sub[clearReceivedCalls]()`. The
 * configured substitutions are kept.
 */
export const clearReceivedCalls: typeof constants.CONTEXT.clearReceivedCalls.symbol = constants.CONTEXT.clearReceivedCalls.symbol
/**
 * Gives a view of a substitute in which every member access or call is a setup, never a real call:
 * `sub[configure]().add(1, 3).returns(1337)`. Use it to re-configure a call whose literal arguments already match an
 * existing substitution (a plain `sub.add(1, 3)` would return the configured value instead).
 */
export const configure: typeof constants.CONTEXT.configure.symbol = constants.CONTEXT.configure.symbol

/**
 * The symbol API is always available, also on `SubstituteOf<T>` for a generic `T` (T:TY-3).
 */
type SymbolSubstituteMethods<T> = {
  /**
   * Asserts that the following member access, call or set happened `amount` times (1 or more when omitted).
   * Throws a `SubstituteException` when it did not. `amount` must be a non-negative integer.
   */
  [received](amount?: number): CheckViewOf<T>
  /** Asserts that the following member access, call or set never happened. Same as `[received](0)`. */
  [didNotReceive](): CheckViewOf<T>
  /**
   * Delegates every member access, call or set without a matching substitution to `instance`. Calls are still
   * recorded, and explicit substitutions take precedence. For an object type, `instance` may have only some of the
   * members (`client[mimick]({ baseUrl: '' })`); the others read as `undefined`. For a function type it is a function.
   */
  [mimick](instance: MimickInstance<T>): void
  /** Clears the received calls of this substitute (and its auto-substitutes); configured substitutions are kept. */
  [clearReceivedCalls](): void
  /**
   * A view of the substitute where every member access or call is a setup, never a real call:
   * `sub[configure]().add(1, 2).returns(3)`.
   */
  [configure](): ConfigureView<T>
}

// The instance `[mimick]()` takes (R12FE-5, T72). The runtime delegates to whatever members the instance has, so for an
// object type a partial instance is enough: `Partial<T>`, which keeps the check of the member types and the
// excess-property check of an object literal. `T` itself is kept where `Partial<T>` would loosen the check:
// - for a type with call or construct signatures (assignable to `Function`): `Partial<T>` would drop the signatures,
//   and any object would fit;
// - for an array or tuple: `Partial<T>` would allow `undefined` elements;
// - for a type that has no required members (`{} extends T`: `unknown`, `{}`, `object`, `any`): `Partial<T>` is the
//   same or looser.
// A union is handled per variant (`Cat | Dog` takes `Partial<Cat> | Partial<Dog>`). In generic code the instance is a
// `T`, as before: the choice is an indexed access whose key (`GenericKind`) is `any` for a concrete type, which selects
// the number index signature, and `'generic'` for a type parameter, as in Utilities.ts. (A distributive conditional
// type on `T` would not accept a value of type `T` there.) The key is taken without `null | undefined`: `keyof (T |
// undefined)` is `never` even for a type parameter, which would make `SubstituteOf<T | undefined>` and `SubstituteOf<T |
// null>` count as concrete, and a `T` would not fit the deferred per-variant type then (R13TD-4, T74). A concrete
// `Thing | undefined` still takes a partial instance.
type MimickInstance<T> = { generic: T, [concrete: number]: EachMimickInstance<T> }[GenericKind<NonNullable<T>>]
type EachMimickInstance<T> = T extends unknown ?
  ({} extends T ? T : T extends Function | readonly unknown[] ? T : Partial<T>) :
  never

type StringSubstituteMethods<T> = {
  /**
   * Asserts that the following member access, call or set happened `amount` times (1 or more when omitted).
   * Throws a `SubstituteException` when it did not. `amount` must be a non-negative integer.
   * `sub[received]()` is the symbol form.
   */
  received(amount?: number): CheckViewOf<T>
  /**
   * Asserts that the following member access, call or set never happened. Same as `received(0)`.
   * `sub[didNotReceive]()` is the symbol form.
   */
  didNotReceive(): CheckViewOf<T>
}

// If `T` has a public or private member named received, didNotReceive, returns, throws, resolves, rejects or
// mimicks, `sub.received` / `sub.didNotReceive` are not offered and the symbol forms `sub[received]()` /
// `sub[didNotReceive]()` must be used (D11). This rules out the ambiguous `sub.received().returns(...)`, which the
// runtime treats as a setup of a member called `received`.
// The check is distributive over `TCheck` (`T & {}`), so that for a type parameter TypeScript resolves it through the
// parameter's constraint (`T extends Calculator` is checked against Calculator). An unconstrained type parameter gets
// the constraint `{}` from the `& {}`: nothing conflicts, so generic helpers keep the string forms, as in 2.0.0-beta.4
// (V2-2, TD-2, T26). The conflict rule applies where it can be decided: for concrete types and constraints.
type StringSubstituteMethodsUnlessConflicting<TCheck, T> = TCheck extends unknown ?
  (HasAnyMember<TCheck, LibraryMemberName> extends true ? {} : StringSubstituteMethods<T>) :
  never

export type ObjectSubstituteMethods<T> = SymbolSubstituteMethods<T> & StringSubstituteMethodsUnlessConflicting<T & {}, T>
