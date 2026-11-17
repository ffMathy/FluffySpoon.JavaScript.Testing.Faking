// R7TD-1 / T53 Generic methods whose return type is conditional on a type parameter (`conv<K>(e: K): K extends string ?
// number : boolean`, `listeners` and `rawListeners` of Node's `EventEmitter<Events>`) have the setup API and are
// callable in the configure view. TypeScript cannot compute such a return type for the arguments of a setup, so the
// configured value is not checked against it (it is `any`); the arguments are checked as for other generic methods.
import { EventEmitter } from 'events'
import { Substitute, Arg, configure, received } from '../src'

interface Converter { conv<K>(e: K): K extends string ? number : boolean }
const converter = Substitute.for<Converter>()
converter.conv('x').returns(1)
converter.conv(1).returns(true)
converter.conv(Arg.any()).returns(1)
converter[configure]().conv('x').returns(1)
converter.received().conv('x')
converter[received](1).conv(Arg.any())
const converted: number = converter.conv('x')
const asConverter: Converter = converter
// @ts-expect-error conv takes one argument
converter.conv('x', 2)
// @ts-expect-error and needs it
converter.conv()

type OrderEvents = { paid: [orderId: string, amount: number]; cancelled: [orderId: string] }
const emitter = Substitute.for<EventEmitter<OrderEvents>>()
emitter.listeners('paid').returns([])
emitter.rawListeners('paid').returns([])
emitter[configure]().listeners('cancelled').returns([])
emitter.received().listeners('paid')
// A listener whose parameters are annotated
emitter.on('paid', (orderId: string, amount: number) => undefined).returns(emitter)
// @ts-expect-error listeners takes one argument
emitter.listeners('paid', 1)

// Limitation: a listener without parameter types gets no contextual type from a generic method (TypeScript cannot
// carry the method's type parameters over to the substitute's signatures). Annotate its parameters, as above.
// @ts-expect-error `orderId` and `amount` implicitly have an `any` type
emitter.on('paid', (orderId, amount) => undefined).returns(emitter)

export { converted, asConverter }
