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
}

const GUARD_KEY = Symbol.for('@fluffy-spoon/substitute:guard')

const isGuard = (value: unknown): value is LibraryGuard =>
  typeof value === 'object' && value !== null &&
  typeof (value as LibraryGuard).printing === 'number' && typeof (value as LibraryGuard).comparing === 'number'

const sharedGuard = (): LibraryGuard => {
  const own: LibraryGuard = { printing: 0, comparing: 0 }
  // (Node.js 10 has no globalThis)
  const scope: Record<symbol, unknown> | undefined = typeof globalThis === 'object' && globalThis !== null ? globalThis as any
    : typeof global === 'object' && global !== null ? global as any : undefined
  if (scope === undefined) return own
  try {
    const existing = scope[GUARD_KEY]
    if (isGuard(existing)) return existing
    Object.defineProperty(scope, GUARD_KEY, { value: own, writable: false, enumerable: false, configurable: true })
  } catch { /* a global object that cannot take it */ }
  return own
}

export const libraryGuard: LibraryGuard = sharedGuard()
