import { constants } from '../../shared'
import { ConfigureView, TerminatingObject } from './Substitute'
import { HasAnyMember, LibraryMemberName } from './Utilities'

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
 * matching substitution goes to `instance`; calls are still recorded for assertions. Symbol-only: a string `mimick` is
 * always an ordinary member of the substituted type.
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
  [received](amount?: number): TerminatingObject<T>
  /** Asserts that the following member access, call or set never happened. Same as `[received](0)`. */
  [didNotReceive](): TerminatingObject<T>
  /**
   * Delegates every member access, call or set without a matching substitution to `instance`. Calls are still
   * recorded, and explicit substitutions take precedence.
   */
  [mimick](instance: T): void
  /** Clears the received calls of this substitute (and its auto-substitutes); configured substitutions are kept. */
  [clearReceivedCalls](): void
  /**
   * A view of the substitute where every member access or call is a setup, never a real call:
   * `sub[configure]().add(1, 2).returns(3)`.
   */
  [configure](): ConfigureView<T>
}

type StringSubstituteMethods<T> = {
  /**
   * Asserts that the following member access, call or set happened `amount` times (1 or more when omitted).
   * Throws a `SubstituteException` when it did not. `amount` must be a non-negative integer.
   * `sub[received]()` is the symbol form.
   */
  received(amount?: number): TerminatingObject<T>
  /**
   * Asserts that the following member access, call or set never happened. Same as `received(0)`.
   * `sub[didNotReceive]()` is the symbol form.
   */
  didNotReceive(): TerminatingObject<T>
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
