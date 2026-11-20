// R7FE-8 / T52 `.resolves()` / `.rejects()` (and their symbol forms) are offered for members that may return a promise:
// `void | Promise<void>` (lifecycle hooks, handlers, middleware), `T | Promise<T>` and `PromiseLike<T>`. They take what
// the promises of the return type resolve to.
import { Substitute, configure, resolves, rejects } from '../src'

interface Hooks {
  onInit(): void | Promise<void>
  load(): string | Promise<string>
  like(): PromiseLike<number>
  maybe(): Promise<number> | undefined
  mixed(): Promise<number> | PromiseLike<string> | boolean
  plain(): string
  thenable(): { then(cb: (v: number) => void): void }
}
const hooks = Substitute.for<Hooks>()
hooks.onInit().resolves()
hooks.onInit().resolves(undefined)
hooks.onInit().rejects(new Error('failed'))
hooks.onInit().returns(undefined)
hooks.onInit().returns(Promise.resolve())
hooks.load().resolves('x')
hooks.load().returns('x')
hooks.load()[resolves]('y')
hooks.load()[rejects](new Error('failed'))
hooks.like().resolves(1)
hooks.like().returns(Promise.resolve(1))
hooks.maybe().resolves(1)
hooks.mixed().resolves(1, 'one')
hooks[configure]().load().resolves('x')
hooks[configure]().onInit().rejects(new Error('failed'))
// @ts-expect-error load's promise resolves to a string
hooks.load().resolves(1)
// @ts-expect-error like's promise resolves to a number
hooks.like().resolves('1')
// @ts-expect-error in the configure view either
hooks[configure]().load().resolves(1)
// @ts-expect-error mixed's promises resolve to numbers or strings
hooks.mixed().resolves(true)
// @ts-expect-error a member that never returns a promise has no resolves()
hooks.plain().resolves('x')
// @ts-expect-error nor rejects()
hooks.plain().rejects(new Error('failed'))
// @ts-expect-error an object with a `then` method that is not a thenable of PromiseLike's shape has no resolves()
hooks.thenable().resolves(1)
const asHooks: Hooks = hooks

export { asHooks }
