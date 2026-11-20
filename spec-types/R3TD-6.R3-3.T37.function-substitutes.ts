// R3TD-6 / R3-3 / T37 A substitute of a function type, or of an interface with call signatures, is called like the
// function: each call has the setup API (`listener('saved').returns('ack')`), and the assertion and configure views
// are callable too (`listener.received(1)('saved')`, `listener[received](1)('saved')`,
// `listener[configure]()('saved').returns('ack')`).
import { Substitute, SubstituteOf, Arg, received, didNotReceive, configure, mimick, returns, throws } from '../src'
import { assert, Equals, expectType } from './helpers'

type Listener = (event: string) => string
const listener = Substitute.for<Listener>()
listener('saved').returns('ack')
listener('saved').returns('ack', 'again')
listener(Arg.any()).returns('any')
listener(Arg.is(event => event.length > 3)).throws(new Error())
listener(Arg.all()).mimicks(event => event.toUpperCase())
listener('saved')[returns]('ack')
listener('saved')[throws](new Error())
listener.received(1)('saved')
listener.received()(Arg.any())
listener.didNotReceive()('deleted')
listener.didNotReceive()(Arg.all())
listener[received](1)('saved')
listener[didNotReceive]()(Arg.is(event => event === ''))
listener[configure]()('saved').returns('ack')
listener[configure]()(Arg.all()).mimicks(event => event)
listener[mimick](event => event)
const asListener: Listener = listener
const answer: string = listener('saved')
expectType<SubstituteOf<Listener>>(listener)

// @ts-expect-error the configured value keeps the return type
listener('saved').returns(1)
// @ts-expect-error the arguments keep their types
listener(1)
// @ts-expect-error the arguments keep their types in the assertion view
listener.received(1)(1)
// @ts-expect-error the arguments keep their types in the assertion view
listener[received](1)(1)
// @ts-expect-error the arguments keep their types in the configure view
listener[configure]()(1).returns('x')
// @ts-expect-error a call in the assertion view returns nothing
listener.received(1)('saved').returns('x')
// @ts-expect-error the configure view only offers the setup API, not the value
const configured: string = listener[configure]()('saved')
// @ts-expect-error the call has a parameter
listener.received(1)()

// Overloads, a promise and void
interface Format {
  (value: number): string
  (value: string, radix: number): number
}
const format = Substitute.for<Format>()
format(1).returns('1')
format('10', 2).returns(2)
format.received()('10', 2)
format[configure]()(Arg.all()).returns('x')
// @ts-expect-error the overload taking a number returns a string
format(1).returns(1)
// @ts-expect-error no overload takes a string alone
format('10')

type Load = (id: number) => Promise<string>
const load = Substitute.for<Load>()
load(1).resolves('one')
load(Arg.any()).rejects(new Error())
// @ts-expect-error the promise resolves to a string
load(1).resolves(1)

type Notify = () => void
const notify = Substitute.for<Notify>()
notify().returns()
notify.received(2)()

// An interface with a call signature and members
interface Counter {
  (step: number): number
  count: number
  reset(): void
}
const counter = Substitute.for<Counter>()
counter(1).returns(2)
counter.count.returns(5)
counter.reset().returns()
counter.received()(1)
counter.received().reset()
counter.received().count = 3
counter[configure]()(2).returns(4)
counter[configure]().count.returns(6)
const asCounter: Counter = counter
// @ts-expect-error the call returns a number
counter(1).returns('2')

// A function type as a member keeps working as before
interface Emitter { listener: Listener }
const emitter = Substitute.for<Emitter>()
emitter.listener('saved').returns('ack')
emitter.received().listener('saved')

// Types that are not callable get no call signatures
interface Calculator { add(a: number, b: number): number }
const calculator = Substitute.for<Calculator>()
// @ts-expect-error a Calculator is not callable
calculator(1)
// @ts-expect-error not callable in the assertion view either
calculator.received()(1)
assert<Equals<typeof answer, string>>()

export { asListener, asCounter, configured }
