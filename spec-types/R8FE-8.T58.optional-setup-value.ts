// R8FE-8 / T58 `.returns()` and `.resolves()` (and their symbol forms) without an argument configure `undefined`: they
// compile whenever `undefined` is a valid value (`any`, `unknown`, `void`, `undefined`, `T | undefined`), as Koa's
// `next().resolves()` (`Next = () => Promise<any>`). A value type that does not accept `undefined` still needs a value.
import { Substitute, SubstituteOf, configure, returns, resolves } from '../src'

interface Store {
  a(): Promise<any>
  b(): Promise<unknown>
  c(): Promise<void>
  d(): Promise<undefined>
  e(): any
  f(): unknown
  g(): Promise<string | undefined>
  h(): string | undefined
  n(): number
  p(): Promise<number>
  current: string | undefined
  count: number
}
const store = Substitute.for<Store>()
store.a().resolves()
store.b().resolves()
store.c().resolves()
store.d().resolves()
store.e().returns()
store.f().returns()
store.g().resolves()
store.h().returns()
store.current.returns()
store.a()[resolves]()
store.h()[returns]()
store[configure]().g().resolves()
store[configure]().h().returns()
store.g().resolves('x', undefined)
store.p().resolves(1)

type Next = () => Promise<any>
const next = Substitute.for<Next>()
next().resolves()
next[configure]()().resolves()

// @ts-expect-error a number is needed
store.n().returns()
// @ts-expect-error nor with the symbol form
store.n()[returns]()
// @ts-expect-error the promise resolves to a number
store.p().resolves()
// @ts-expect-error nor in the configure view
store[configure]().p().resolves()
// @ts-expect-error a string is needed
store.g().returns()
// @ts-expect-error a number is needed
store.count.returns()
// @ts-expect-error undefined is still not a number
store.n().returns(undefined)

// Generic code: a value is still accepted
export function stub<T>(sub: SubstituteOf<{ load(): Promise<T>; get(): T }>, value: T) {
  sub.load().resolves(value)
  sub.get().returns(value)
}
