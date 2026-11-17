// R7FE-1 / T51 Limitation: a method with a parameter declared with a literal type (`once(event: 'drain', ...)`,
// `get(kind: 'user', id)`, `code(c: 1)`, `flag(on: true)`, and `nul(x: null)` from TypeScript 4.0 on), overloaded or
// not, has no setup API when it is called directly on the substitute: TypeScript tries every signature whose
// parameters are declared with literal types before all other signatures, so the call resolves to the interface's own
// declaration. The substitute's signatures cannot be declared that way. Configure such a call through the configure
// view; checks work as usual. Parameters typed with a union of literals or with an enum member are not affected.
import { Substitute, Arg, configure, received, didNotReceive } from '../src'

enum Kind { User = 'user', Group = 'group' }
interface Sink {
  once(event: 'drain', listener: () => void): this
  get(kind: 'user', id: number): string
  code(c: 1): number
  flag(on: true): number
  mode(m: 'r' | 'w'): number
  byKind(k: Kind.User): number
}
const sink = Substitute.for<Sink>()
// @ts-expect-error resolves to the interface's own declaration (`this`)
sink.once('drain', Arg.any()).returns(sink)
sink[configure]().once('drain', Arg.any()).returns(sink)
// @ts-expect-error resolves to the interface's own declaration (`string`)
sink.get('user', 1).returns('ann')
sink[configure]().get('user', 1).returns('ann')
sink[configure]().get('user', Arg.any()).returns('ann')
// @ts-expect-error a number literal as well
sink.code(1).returns(2)
sink[configure]().code(1).returns(2)
// @ts-expect-error a boolean literal as well
sink.flag(true).returns(2)
sink[configure]().flag(true).returns(2)
// checks
sink.received().once('drain', Arg.any())
sink[received](1).get('user', 1)
sink.didNotReceive().code(1)
sink[didNotReceive]().flag(true)
// the configure view keeps the parameter types
// @ts-expect-error 'drain' is the only event
sink[configure]().once('close', Arg.any()).returns(sink)
// @ts-expect-error get returns a string
sink[configure]().get('user', 1).returns(1)
// not affected: unions of literals and enum members
sink.mode('r').returns(1)
sink.byKind(Kind.User).returns(1)
const asSink: Sink = sink

export { asSink }
