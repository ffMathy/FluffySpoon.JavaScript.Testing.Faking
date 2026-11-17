// R7TD-7 / T50 Generic methods check the number of arguments as their own signature does, in setups, checks and the
// configure view; callable types with other members are not generic and get no generic signature. (Node's
// `EventEmitter<T>.emit`, whose number of arguments depends on the event, is the exception: see limitations.ts.)
import { Substitute, Arg, configure, received } from '../src'

interface Config { port: number; host: string }
interface ConfigService { get<K extends keyof Config>(key: K): Config[K]; first<T>(items: T[]): T; id<T>(value: T): T }
const config = Substitute.for<ConfigService>()
config.get('port').returns(80)
config.get(Arg.any()).returns('localhost')
config.received().get('port')
config[configure]().get('host').returns('localhost')
config.first([1]).returns(1)
config.id(1).returns(2)
// @ts-expect-error get takes one argument
config.get('port', 'extra')
// @ts-expect-error get takes one argument
config.get('port', 'extra').returns(1)
// @ts-expect-error in a check either
config.received().get('port', 1)
// @ts-expect-error nor with the symbol form
config[received]().get('port', 1)
// @ts-expect-error nor in the configure view
config[configure]().get('port', 1)
// @ts-expect-error first takes one argument
config.first([1], 2)
// @ts-expect-error id takes one argument
config.id(1, 2, 3)
// @ts-expect-error get needs its argument
config.get()
// @ts-expect-error in the configure view too
config[configure]().get()
// @ts-expect-error the key is a key of Config
config.get('nope')
const asConfig: ConfigService = config
// @ts-expect-error the plain interface rejects it as well
asConfig.get('port', 'extra')

// A generic function type
const ident = Substitute.for<<T>(x: T) => T>()
ident(1).returns(1)
ident('a').returns('b')
ident.received()(1)
ident[configure]()(Arg.any()).returns(2)
// @ts-expect-error the function takes one argument
ident(1, 2)
// @ts-expect-error and needs it
ident()
// @ts-expect-error in a check either
ident.received()(1, 2)

// An optional parameter and a rest parameter
interface Finder { find<T>(id: string, fallback?: T): T; all<T>(...ids: T[]): T[] }
const finder = Substitute.for<Finder>()
finder.find('1').returns(undefined)
finder.find('1', 2).returns(2)
finder.all().returns([])
finder.all(1, 2, 3).returns([1])
// @ts-expect-error find takes at most two arguments
finder.find('1', 2, 3)
// @ts-expect-error and needs the id
finder.find()

// Callable types with other members are not generic: their call signature checks the arguments
interface Fn { (x: string): number; extra: boolean }
interface Host { fn: Fn; plain(x: string): number; h: ((e: string) => void) & { id: number } }
const host = Substitute.for<Host>()
host.fn('a').returns(1)
host.received().fn('a')
host.h('x')
// @ts-expect-error fn takes one argument
host.fn('a', 'b')
// @ts-expect-error fn takes one argument
host.fn('a', 'b').returns(1)
// @ts-expect-error in a check either
host.received().fn('a', 'b')
// @ts-expect-error fn takes a string
host.fn(1)
// @ts-expect-error fn needs its argument
host.fn()
// @ts-expect-error h takes one argument
host.h('x', 'y')
const callable = Substitute.for<Fn>()
callable('a').returns(1)
callable.received()('a')
// @ts-expect-error the function takes one argument
callable('a', 'b')
// @ts-expect-error in a check either
callable.received()('a', 'b')
// @ts-expect-error and needs it
callable()
// @ts-expect-error it returns a number
callable('a').returns('x')

// A conditional return type on a generic function type
type Getter = <K extends 'a' | 'b'>(k: K) => K extends 'a' ? number : string
const getter = Substitute.for<Getter>()
getter('a').returns(1)
getter[configure]()('a').returns(1)
getter.received()('a')
// @ts-expect-error the getter takes one argument
getter('a', 'b')

// Arguments of type `any` (`Arg.any()`): the configured value is checked against what the method returns, also on
// TypeScript 4.1 and older
interface User { name: string; age: number }
interface Repo { find<K extends keyof User>(key: K, value: User[K]): Promise<User[]> }
const repo = Substitute.for<Repo>()
repo.find(Arg.any(), Arg.any()).resolves([])
// @ts-expect-error resolves to a list of users
repo.find(Arg.any(), Arg.any()).resolves('none')
// @ts-expect-error get returns a number or a string
config.get(Arg.any()).returns(Symbol('x'))

export { asConfig }
