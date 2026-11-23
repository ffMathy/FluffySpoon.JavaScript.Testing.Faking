// R16TD-1 (documented typing, pinned for the README's T78 text) Which overloads that no argument fits once their type
// parameters are replaced by their constraints (`<K extends keyof {}>(key: K, ...)`) are left out, and what the
// others give. The same on TypeScript 3.6 to 7.0.2, strict or not.
// (1) The LAST overload, returning `never` once its type parameters are replaced (`{}[K]`, hono's `Context.get`): left
//     out (T78, see R15FE-2.T78.impossible-overloads.ts).
// (2) Such an overload that is NOT the last one: TypeScript cannot match the member's overloads one by one, so the
//     member is typed by its last overload alone, as a generic method (T46). Its setups, its configure view and its
//     checks take the last overload's arguments, and also ANY arguments, as many as the last overload takes, that the
//     member can be called with: the impossible overload takes every argument there (its parameters are `never`,
//     which TypeScript compares both ways for a method). `.returns()` takes what the last overload returns. A call
//     with another number of arguments resolves to the member's own overloads, without the setup API.
// (3) Such an overload that returns something else once its type parameters are replaced (`: string`), wherever it
//     is: not left out; its own signature takes no argument, but a single `Arg.all()` takes its return type as well.
import { Arg, Substitute, SubstituteOf, configure, received } from '../src'

interface ContextVariableMap {}
type Variables = { user: { id: string }; requestId: string }

// (2) in the middle
interface Finder {
  find(id: number): string
  find<K extends keyof {}>(key: K, extra: {}[K]): {}[K]
  find(name: string, exact: boolean): number
}
const finder = Substitute.for<Finder>()
finder.find('ann', true).returns(1)
finder.find(Arg.all()).returns(1)
// any two arguments:
finder.find(1, 2).returns(1)
finder.find({}, []).returns(1)
finder[configure]().find(1, 2).returns(1)
finder.received(1).find('ann', 'not a boolean')
finder[received](1).find(1, 2)
// @ts-expect-error .returns() takes what the last overload returns
finder.find(1, 2).returns('a')
// @ts-expect-error one argument: the member's own first overload, without the setup API
finder.find(1).returns('a')
// @ts-expect-error three arguments
finder.find(1, 2, 3)
// @ts-expect-error a single Arg.all() takes the last overload's value
finder.find(Arg.all()).returns('a')
// the cast for the other overloads
;(finder as unknown as SubstituteOf<{ find(id: number): string }>).find(1).returns('a')

// (2) first
interface Get2 {
  <Key extends keyof ContextVariableMap>(key: Key): ContextVariableMap[Key]
  <Key extends keyof Variables>(key: Key): Variables[Key]
}
const c2 = Substitute.for<{ get: Get2 }>()
c2.get('user').returns({ id: 'u' })
// any one argument:
c2.get('nope').returns({ id: 'u' })
c2[configure]().get('nope').returns('r')
c2.received(1).get('nope')
// @ts-expect-error no variable holds a number
c2.get('user').returns(1)
// @ts-expect-error two arguments
c2.get('user', 'extra')

// (2) with fewer parameters than the last overload: only calls with the last overload's number of arguments
interface Finder2 {
  find<K extends keyof {}>(key: K): {}[K]
  find(name: string, exact: boolean): number
}
const finder2 = Substitute.for<Finder2>()
finder2.find('ann', true).returns(1)
finder2.find(1, 2).returns(1)
// @ts-expect-error one argument
finder2.find(123)

// (3)
type V = { user: { id: string }; n: number }
interface G1 {
  get<K extends keyof V>(k: K): V[K]
  get<K extends keyof ContextVariableMap>(k: K): string
}
const g1 = Substitute.for<G1>()
g1.get('n').returns(1)
g1[configure]().get('n').returns(1)
g1.get(Arg.all()).returns('only the impossible overload returns a string')
// @ts-expect-error no overload takes the key
g1.get('zzz')
// @ts-expect-error in checks neither
g1.received(1).get('zzz')
// @ts-expect-error nor in the configure view
g1[configure]().get('zzz')
interface G2 {
  get<K extends keyof {}>(k: K): string
  get<K extends keyof V>(k: K): V[K]
}
const g2 = Substitute.for<G2>()
g2.get('user').returns({ id: 'u' })
g2.get(Arg.all()).returns('only the impossible overload returns a string')
// @ts-expect-error no overload takes the key
g2.get('zzz')
// @ts-expect-error in checks neither
g2.received(1).get('zzz')
