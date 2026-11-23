/**
 * E63 (R10-ADV-2): whether the library is printing values (failure messages, printouts, paths) or comparing them
 * (util.isDeepStrictEqual), in ANY copy of the package loaded in this realm. util.inspect and util.isDeepStrictEqual
 * probe the values they look at (`href`, `protocol` and `auth` of URLs, Node.js 20's KeyObject symbols), and such a
 * probe reaches a substitute when the value inherits from one (`class Plugin extends sdk.Base`). It is the library's
 * probe, not the code under test's, so the substitute records nothing (E46, E57). With two copies of the package
 * (duplicate installs, a module registry reset between tests), the value can be printed or compared by one copy and
 * inherit from a substitute of the other. So the copies share one guard: an object kept on the global object under a
 * registered symbol, which the first copy loaded creates and every later copy finds. A check reads one property of it.
 * Where the global object cannot take it (frozen), each copy keeps its own.
 */
export type LibraryGuard = {
  /** How many prints of any copy are under way (see withPrintGuard). */
  printing: number
  /** How many comparisons of any copy are under way (see literalEquals). */
  comparing: number
  /**
   * E95 (R14FE-1): how many looks of any copy are under way in which nothing done to substitutes leaves a trace: a
   * matcher (an Arg.is predicate, a test runner's asymmetricMatch or a sinon matcher's test) in a check, a setup or any
   * other matching against recorded calls (see evaluateArgument), and E100 a substitute that a matcher looks at answering
   * (see Look.lookedPeek).
   */
  matching: number
  /**
   * E100 (R15-ADV-4): while a real call of the code under test is matched against setups with matchers, the values those
   * matchers look at (see Look): only what is done to these substitutes leaves no trace. Undefined otherwise.
   */
  looking: ArgumentLook | undefined
  /**
   * E71 (R11V-4): while a failure message is built with its roots numbered (E52, see Paths.withRootNumbers), the numbers
   * of the roots shown so far, so that a substitute of another copy among the arguments is numbered in the same message.
   */
  rootNumbers?: Map<object, number>
  /**
   * E113 (R16V-3): the functions that `x.bind(...)` gave on a substitute of any copy (see the engine's createBoundProxy).
   * They answer the library's substitute marker, but they are no substitute. Created by the first copy that needs it
   * (copies of earlier versions do not mark theirs).
   */
  boundFunctions?: WeakSet<object>
}

/**
 * E100 (R15-ADV-4): the values that the matchers of one real call look at while the call is matched against setups (see
 * Look). Kept on the shared guard, so that a substitute of another copy among them is looked at too.
 */
export type ArgumentLook = {
  /** The call's arguments. */
  args: readonly unknown[]
  /** The substitutes (proxies, of any copy) among them and among what looked substitutes answered (walked when first asked). */
  reached: Set<object> | undefined
  /** The objects walked so far, each one once. */
  seen: Set<object>
  /** The look under way when this one began (a real call made by code that a matcher runs, see Look). */
  outer: ArgumentLook | undefined
}

const GUARD_KEY = Symbol.for('@fluffy-spoon/substitute:guard')

const isGuard = (value: unknown): value is LibraryGuard =>
  typeof value === 'object' && value !== null &&
  typeof (value as LibraryGuard).printing === 'number' && typeof (value as LibraryGuard).comparing === 'number'

const sharedGuard = (): LibraryGuard => {
  const own: LibraryGuard = { printing: 0, comparing: 0, matching: 0, looking: undefined, rootNumbers: undefined }
  // (Node.js 10 has no globalThis)
  const scope: Record<symbol, unknown> | undefined = typeof globalThis === 'object' && globalThis !== null ? globalThis as any
    : typeof global === 'object' && global !== null ? global as any : undefined
  if (scope === undefined) return own
  try {
    const existing = scope[GUARD_KEY]
    if (isGuard(existing)) {
      // (made by an earlier version of the library, which does not share the numbering)
      if (!('rootNumbers' in existing)) existing.rootNumbers = undefined
      if (typeof existing.matching !== 'number') existing.matching = 0
      if (!('looking' in existing)) (existing as LibraryGuard).looking = undefined
      return existing
    }
    Object.defineProperty(scope, GUARD_KEY, { value: own, writable: false, enumerable: false, configurable: true })
  } catch { /* a global object that cannot take it */ }
  return own
}

export const libraryGuard: LibraryGuard = sharedGuard()
