// R6FE-7 / T46 Generic methods are never typed `never` on a substitute: setups, checks and the configure view compile,
// also with `Arg.any()` and `Arg.all()`, and values the method cannot return are rejected. (The type parameters are
// replaced by their constraints: see limitations.ts for what that leaves unchecked.)
import { EventEmitter } from 'events'
import { Substitute, Arg, configure, received, didNotReceive } from '../src'

// Node's EventEmitter with an event map.
type OrderEvents = { paid: [orderId: string, amount: number]; cancelled: [orderId: string] }
const emitter = Substitute.for<EventEmitter<OrderEvents>>()
emitter.emit('paid', 'o1', 20).returns(true)
emitter.emit('paid', Arg.any(), Arg.any()).returns(true)
emitter.emit('cancelled', 'o1').returns(false)
emitter[configure]().emit('paid', 'o1', 20).returns(true)
emitter.on('paid', Arg.any()).returns(emitter)
emitter.once('cancelled', (orderId: string) => undefined).returns(emitter)
emitter.listenerCount('paid').returns(2)
emitter.received(1).emit('paid', 'o1', 20)
emitter[received](1).emit('paid', Arg.any(), Arg.any())
emitter[didNotReceive]().emit('cancelled', 'o2')
const asEmitter: EventEmitter<OrderEvents> = emitter
// @ts-expect-error emit returns a boolean
emitter.emit('paid', 'o1', 20).returns('yes')
// @ts-expect-error the amount is a number
emitter.received().emit('paid', 'o1', '20')
// @ts-expect-error the member is callable, not `never`
const notNever: 1 = emitter.emit
// Limitation (R7TD-7 / T50): the number of arguments of a generic method is checked against its parameter list with the
// type parameters replaced by their constraints. `emit(eventName, ...args: Args<K, Events>)` has no possible arguments
// with `K` replaced by its constraint, so the number of event arguments is not checked (their types are): these
// compile although `paid` takes two arguments. Check such a call through the plain type.
emitter.emit('paid', 'o1').returns(true)
emitter.received().emit('paid', 'o1')
emitter[configure]().emit('cancelled', 'o1', 2).returns(true)
// @ts-expect-error the plain type checks the number of arguments
asEmitter.emit('paid', 'o1')

// A hand-written typed emitter.
interface Events { saved: (id: string) => void; failed: (error: Error) => void }
interface Emitter {
  on<E extends keyof Events>(event: E, listener: Events[E]): this
  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean
}
const typed = Substitute.for<Emitter>()
typed.emit('saved', 'id1').returns(true)
typed.emit('saved', Arg.any()).returns(true)
typed.emit(Arg.all()).returns(false)
typed[configure]().emit('saved', 'id1').returns(true)
typed[configure]().emit('saved', Arg.any()).returns(true)
typed.on('saved', Arg.any()).returns(typed)
typed.on(Arg.any(), Arg.any()).returns(typed)
typed[configure]().on(Arg.any(), Arg.any()).returns(typed)
typed.received().emit('saved', 'id1')
typed.received(1).on('saved', Arg.any())
// @ts-expect-error 'saved' takes a string id
typed.emit('saved', 1)
// @ts-expect-error emit returns a boolean
typed.emit('saved', 'id1').returns(1)

// Generic methods whose return type depends on a type parameter.
interface User { name: string; age: number }
interface Repo { find<K extends keyof User>(key: K, value: User[K]): Promise<User[]> }
const repo = Substitute.for<Repo>()
repo.find('age', 30).resolves([])
repo.find(Arg.any(), Arg.any()).resolves([])
repo.find(Arg.all()).resolves([])
repo.received().find('name', Arg.any())
// @ts-expect-error resolves to a list of users
repo.find(Arg.any(), Arg.any()).resolves('none')

interface Config { port: number; host: string; debug: boolean }
interface ConfigService { get<K extends keyof Config>(key: K): Config[K] }
const config = Substitute.for<ConfigService>()
config.get('port').returns(80)
config.get(Arg.any()).returns(80)
config.get(Arg.all()).returns('localhost')
config[configure]().get('host').returns('localhost')
config.received().get(Arg.any())
// @ts-expect-error no member of Config is a symbol
config.get('port').returns(Symbol('80'))
// @ts-expect-error the key is a key of Config
config.get('timeout')

interface Store { first<T>(items: T[]): T; id<T>(value: T): T }
const store = Substitute.for<Store>()
store.first([1, 2]).returns(1)
store.first(Arg.any()).returns(1)
store.id(Arg.any()).returns('x')
store.received().first(Arg.all())

// The parameter list of a signature is taken as a whole (T46), so a rest parameter typed as a union of tuples (which
// `emit(event, ...args: Parameters<Events[E]>)` gives with the constraint) has the setup API too.
interface Logger { log(...args: [string] | [string, number]): boolean }
const logger = Substitute.for<Logger>()
logger.log('a').returns(true)
logger.log('a', 1).returns(false)
logger.log(Arg.any()).returns(true)
logger.log(Arg.all()).returns(true)
logger[configure]().log('a').returns(true)
logger.received(1).log('a', 1)
// @ts-expect-error log returns a boolean
logger.log('a').returns('yes')
// @ts-expect-error the second argument is a number
logger.log('a', 'b')
// @ts-expect-error the first argument is a string
logger.received().log(1)

export { asEmitter, notNever }
