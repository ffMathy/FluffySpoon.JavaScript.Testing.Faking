import { constants } from '../../shared'
import { ConfigureView, TerminatingObject } from './Substitute'
import { HasAnyMember, LibraryMemberName } from './Utilities'

export const received: typeof constants.CONTEXT.received.symbol = constants.CONTEXT.received.symbol
export const didNotReceive: typeof constants.CONTEXT.didNotReceive.symbol = constants.CONTEXT.didNotReceive.symbol
export const mimick: typeof constants.CONTEXT.mimick.symbol = constants.CONTEXT.mimick.symbol
export const clearReceivedCalls: typeof constants.CONTEXT.clearReceivedCalls.symbol = constants.CONTEXT.clearReceivedCalls.symbol
export const configure: typeof constants.CONTEXT.configure.symbol = constants.CONTEXT.configure.symbol

/**
 * The symbol API is always available, also on `SubstituteOf<T>` for a generic `T` (T:TY-3).
 */
type SymbolSubstituteMethods<T> = {
  /** Asserts that the following member access, call or set happened `amount` times (1 or more when omitted). */
  [received](amount?: number): TerminatingObject<T>
  /** Asserts that the following member access, call or set never happened. Same as `[received](0)`. */
  [didNotReceive](): TerminatingObject<T>
  /** Delegates every member access, call or set without a matching substitution to `instance`. */
  [mimick](instance: T): void
  /** Clears the received calls of this substitute; configured substitutions are kept. */
  [clearReceivedCalls](): void
  /** A view of the substitute where every member access or call is a setup (`sub[configure]().add(1, 2).returns(3)`). */
  [configure](): ConfigureView<T>
}

type StringSubstituteMethods<T> = {
  /** Asserts that the following member access, call or set happened `amount` times (1 or more when omitted). */
  received(amount?: number): TerminatingObject<T>
  /** Asserts that the following member access, call or set never happened. Same as `received(0)`. */
  didNotReceive(): TerminatingObject<T>
}

// If `T` has a public or private member named received, didNotReceive, returns, throws, resolves, rejects or
// mimicks, `sub.received` / `sub.didNotReceive` are not offered and the symbol forms `sub[received]()` /
// `sub[didNotReceive]()` must be used (D11). This rules out the ambiguous `sub.received().returns(...)`, which the
// runtime treats as a setup of a member called `received`.
// Distributive over `T`, so that for a type parameter with a constraint (`T extends Calculator`) TypeScript resolves the
// check against the constraint. For an unconstrained type parameter the check cannot be resolved, so only the symbol
// forms are offered.
type StringSubstituteMethodsUnlessConflicting<T> = T extends unknown ?
  (HasAnyMember<T, LibraryMemberName> extends true ? {} : StringSubstituteMethods<T>) :
  never

export type ObjectSubstituteMethods<T> = SymbolSubstituteMethods<T> & StringSubstituteMethodsUnlessConflicting<T>
