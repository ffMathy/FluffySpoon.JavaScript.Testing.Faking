// R15FE-2 / T78 An overload whose parameters become impossible once its type parameters are replaced by their
// constraints (`<Key extends keyof ContextVariableMap>(key: Key): ContextVariableMap[Key]` with an empty
// `ContextVariableMap`, as in hono 4's `Context.get` and `Context.set`) is left out when the setup signatures, the
// configure view and the `Arg.all()` signatures are built. Before, the whole member had no setup API:
// `c.get('user').returns(user)` did not compile (TS2339), the configure view was not callable (TS2349) and
// `c.get(Arg.all())` matched no overload (TS2769). The remaining overloads are typed as other overloaded generic
// methods: their type parameters are replaced by their constraints, so `.returns()` takes the value of any key.
import { Substitute, Arg, configure, received, didNotReceive, SubstituteOf } from '../src'

// The shapes of hono 4 (hono/dist/types/context.d.ts), in short.
interface ContextVariableMap {}
type Env = { Variables?: object }
interface Get<E extends Env> {
  <Key extends keyof E['Variables']>(key: Key): E['Variables'][Key]
  <Key extends keyof ContextVariableMap>(key: Key): ContextVariableMap[Key]
}
interface Set<E extends Env> {
  <Key extends keyof E['Variables']>(key: Key, value: E['Variables'][Key]): void
  <Key extends keyof ContextVariableMap>(key: Key, value: ContextVariableMap[Key]): void
}
declare class Context<E extends Env = any> {
  get: Get<E>
  set: Set<E>
  get var(): Readonly<ContextVariableMap & E['Variables']>
  header(name: string, value?: string): void
}

type User = { id: string }
type AppEnv = { Variables: { user: User; requestId: string } }
const user: User = { id: 'u1' }
const c = Substitute.for<Context<AppEnv>>()

// setups
c.get('user').returns(user)
c.get('requestId').returns('r1')
c.get('user').mimicks(key => user)
c.get(Arg.any()).returns(user)
c.get(Arg.is(key => key === 'user')).returns(user)
c.get(Arg.all()).returns(user)
c.get(Arg.all()).returns('r1')
c[configure]().get('user').returns(user)
c[configure]().get(Arg.all()).returns(user)
c[configure]().set('user', Arg.any()).returns()
c.var.returns({ user, requestId: 'r1' })
// checks
c.received(1).get('user')
c[received](1).get('requestId')
c.didNotReceive().get(Arg.all())
c[didNotReceive]().set('user', Arg.any())
c.received(1).set('user', user)
// the substitute is still a Context
const asContext: Context<AppEnv> = c

// @ts-expect-error not a key of the variables
c.get('nope')
// @ts-expect-error not a key of the variables
c[configure]().get('nope').returns(user)
// @ts-expect-error not a key of the variables
c.received(1).get('nope')
// @ts-expect-error no key holds a number
c.get('user').returns(42)
// @ts-expect-error no key holds a number
c[configure]().get('user').returns(42)
// @ts-expect-error no overload returns a number
c.get(Arg.all()).returns(42)
// @ts-expect-error the key is a string
c.get('user').mimicks((key: number) => user)
// @ts-expect-error `id` is a string
c.received(1).set('user', { id: 1 })
// @ts-expect-error not a user
c.var.returns({ user: 'u1', requestId: 'r1' })

// The same shapes as methods, as a function substitute, with the impossible overload first, and between two others.
interface Empty {}
type Vars = { user: User; requestId: string }
interface Store {
  get<K extends keyof Vars>(key: K): Vars[K]
  get<K extends keyof Empty>(key: K): Empty[K]
}
const store = Substitute.for<Store>()
store.get('user').returns(user)
store[configure]().get('user').returns(user)
store.get(Arg.all()).returns(user)
store.received(1).get('requestId')
// @ts-expect-error not a key
store.get('nope')
// @ts-expect-error no key holds a number
store.get(Arg.all()).returns(42)

const getter = Substitute.for<Get<AppEnv>>()
getter('user').returns(user)
getter[configure]()('user').returns(user)
getter(Arg.all()).returns('r1')
getter.received(1)('user')
// @ts-expect-error no key holds a number
getter('user').returns(42)

interface ImpossibleFirst {
  get<K extends keyof Empty>(key: K): Empty[K]
  get<K extends keyof Vars>(key: K): Vars[K]
}
const first = Substitute.for<ImpossibleFirst>()
first.get('user').returns(user)
first[configure]().get('user').returns(user)
first.get(Arg.all()).returns(user)
// @ts-expect-error no key holds a number
first.get('user').returns(42)

// Limitation: an impossible overload that is not the last one is not left out. When it returns `never` once its type
// parameters are replaced by their constraints, only the last overload has the setup API, as before T78 (use the
// last overload's form, or `Arg.all()`, which takes the last overload's value there).
interface Finder {
  find(id: number): string
  find<K extends keyof Empty>(key: K, extra: Empty[K]): Empty[K]
  find(name: string, exact: boolean): number
}
const finder = Substitute.for<Finder>()
finder.find('n', true).returns(1)
finder[configure]().find('n', true).returns(1)
finder.find(Arg.all()).returns(1)
finder.received(1).find(1)
// @ts-expect-error the first overload has no setup API here (see above)
finder.find(1).returns('a')
// @ts-expect-error find(name, exact) returns a number
finder.find('n', true).returns('a')

// Generic code over the hono shape keeps compiling.
function configureUser<E extends AppEnv>(context: SubstituteOf<Context<E>>) {
  context.header('x', Arg.any())
  context.received(1).header('x')
}
configureUser(c)

export { asContext }
