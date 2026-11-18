// R11FE-1 / R11TD-3 / T68 Typed event emitters: `Arg.all()` after leading arguments of Node's
// `EventEmitter<Events>.emit` compiles in setups, checks and the configure view (`emit('paid', Arg.all())`,
// `emit('paid', 'o1', Arg.all())`); the leading arguments are still checked against the method's own signature. A
// hand-written `emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>)` had them already.
// Limitation (pinned below): an `Arg.is()` predicate WITHOUT a parameter type in the rest arguments of such an `emit`
// does not get the event's parameter type (Node's emitter gives it `unknown`, the hand-written one the union of all
// events' parameters), and the call does not compile. Annotate the predicate: `Arg.is((id: string) => ...)`.
import { EventEmitter } from 'events'
import { Arg, Substitute, configure, didNotReceive, received } from '../src'

type OrderEvents = { paid: [orderId: string, amount: number]; cancelled: [orderId: string] }
const orders = Substitute.for<EventEmitter<OrderEvents>>()
orders.received(1).emit('paid', Arg.all())
orders.received(1).emit('paid', 'o1', Arg.all())
orders[received](1).emit('paid', Arg.all())
orders.didNotReceive().emit('cancelled', Arg.all())
orders[didNotReceive]().emit('cancelled', Arg.all())
orders.emit('paid', Arg.all()).returns(true)
orders.emit('paid', 'o1', Arg.all()).returns(true)
orders[configure]().emit('paid', Arg.all()).returns(true)
orders[configure]().emit('paid', 'o1', Arg.all()).returns(true)
orders.emit('paid', Arg.all()).mimicks(() => true)
orders.emit('paid', Arg.any('string'), Arg.all()).returns(true)
orders.emit('paid', Arg.is((id: string) => id.startsWith('o')), Arg.all()).returns(true)
orders.received(1).emit('paid', Arg.is((id: string) => id === 'o1'), Arg.any())
orders.emit('paid', 'o1', Arg.is((amount: number) => amount > 10)).returns(true)
orders.emit(Arg.all()).returns(true)
// @ts-expect-error emit returns a boolean
orders.emit('paid', Arg.all()).returns('yes')
// @ts-expect-error in the configure view too
orders[configure]().emit('paid', Arg.all()).returns(1)
// @ts-expect-error the order id is a string
orders.emit('paid', 1, Arg.all())
// @ts-expect-error in a check too
orders.received(1).emit('paid', 1, Arg.all())
// @ts-expect-error not an event of OrderEvents
orders.emit('nope', Arg.all())
// @ts-expect-error in a check too
orders.received(1).emit('nope', Arg.all())
// @ts-expect-error nothing may follow Arg.all()
orders.emit('paid', Arg.all(), 'o1')
// @ts-expect-error the predicate takes the order id, a string
orders.emit('paid', Arg.is((id: number) => id > 1), Arg.all())
// @ts-expect-error the order id is not a number
orders.emit('cancelled', Arg.any('number'), Arg.all())
// @ts-expect-error the call returns a boolean with the setup API
const paid: string = orders.emit('paid', Arg.all())

// Several events.
type Two = { saved: [id: string]; failed: [id: string, error: Error] }
const two = Substitute.for<EventEmitter<Two>>()
two.received(1).emit('saved', Arg.all())
two.received(1).emit('failed', 'x', Arg.all())
two.emit('saved', Arg.all()).returns(true)
two.received(1).emit('failed', 'x', Arg.is((e: Error) => e.message === 'm'))

// The hand-written typed emitter (README).
interface Events { saved: (id: string) => void; failed: (error: Error) => void }
interface Emitter { emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean }
const emitter = Substitute.for<Emitter>()
emitter.received(1).emit('saved', Arg.all())
emitter.emit('saved', Arg.all()).returns(true)
emitter[configure]().emit('saved', Arg.all()).returns(true)
emitter.emit('saved', Arg.is((id: string) => id.startsWith('o'))).returns(true)
emitter.received(1).emit('saved', Arg.is((id: string) => id.length > 0))
emitter[configure]().emit('saved', Arg.is((id: string) => id.length > 0)).returns(true)
// @ts-expect-error emit returns a boolean
emitter.emit('saved', Arg.all()).returns(1)
// @ts-expect-error not an event
emitter.emit('nope', Arg.all())
// @ts-expect-error 'saved' takes a string id
emitter.emit('saved', Arg.is((id: number) => id > 0))

// The limitation: a predicate without a parameter type in the rest arguments.
// @ts-expect-error `id` is `string | Error` here, not the `string` of 'saved' (annotate it)
emitter.emit('saved', Arg.is(id => id.startsWith('o'))).returns(true)
// @ts-expect-error likewise in a check
emitter.received(1).emit('saved', Arg.is(id => id.length > 0))
// @ts-expect-error Node's emitter: `id` is `unknown` (annotate it)
orders.emit('paid', Arg.is(id => id.startsWith('o')), 20).returns(true)
// @ts-expect-error likewise in a check
orders.received(1).emit('paid', Arg.is(id => id.length > 0), Arg.any())
// @ts-expect-error likewise before Arg.all()
orders.emit('paid', Arg.is(id => id.startsWith('o')), Arg.all()).returns(true)
