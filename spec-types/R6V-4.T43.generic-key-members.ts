// R6V-4 / T43 Generic code that reaches a member through a generic key of a mapped type (`s[k]` on a
// `SubstituteOf<Record<K, () => number>>`, a handler map indexed by a generic event name): the member keeps its setup
// API, as for any other member in generic code (T26, T33). Only concrete unions take the combined signatures of T42.
import { Substitute, SubstituteOf, Arg, configure } from '../src'

export function f3<K extends string>(s: SubstituteOf<Record<K, () => number>>, k: K) {
  s[k]().returns(1)
  s[k]().returns(1, 2)
  s[k]().mimicks(() => 3)
  s[k]().throws(new Error())
  s[configure]()[k]().returns(1)
  // @ts-expect-error the member returns a number
  s[k]().returns('x')
  // @ts-expect-error the configure view checks the value too
  s[configure]()[k]().returns('x')
  // @ts-expect-error resolves() is only offered for promises
  s[k]().resolves(1)
}

export function f3b<K extends string>(s: SubstituteOf<Record<K, (x: string) => Promise<number>>>, k: K) {
  s[k]('a').resolves(1)
  s[k]('a').rejects(new Error())
  s[k](Arg.any()).resolves(2)
  s[k](Arg.all()).returns(Promise.resolve(3))
  // @ts-expect-error the promise resolves to a number
  s[k]('a').resolves('x')
  // @ts-expect-error the argument is a string
  s[k](1)
}

// A handler map keyed by a generic event name.
type Handlers<E extends string> = { [P in E]: (payload: string) => boolean }
export function f4<E extends string>(h: SubstituteOf<Handlers<E>>, e: E) {
  h[e]('p').returns(true)
  h[e](Arg.is(payload => payload.length > 0)).returns(false)
  h[configure]()[e]('p').returns(true)
  // @ts-expect-error the handler returns a boolean
  h[e]('p').returns('yes')
}

// The same with a concrete union of keys, and with a generic key of a concrete interface.
type Api = Record<'a' | 'b', () => number>
export function f5(s: SubstituteOf<Api>, k: 'a' | 'b') {
  s[k]().returns(1)
  // @ts-expect-error the member returns a number
  s[k]().returns('x')
}
interface Repo { find(): number; count(): number }
export function f6<K extends keyof Repo>(s: SubstituteOf<Repo>, k: K) {
  s[k]().returns(1)
}

// A generic record of members passed through a helper.
export function stubAll<K extends string>(s: SubstituteOf<Record<K, () => string>>, keys: K[]) {
  for (const key of keys) s[key]().returns(key)
}
stubAll(Substitute.for<Record<'x' | 'y', () => string>>(), ['x', 'y'])
