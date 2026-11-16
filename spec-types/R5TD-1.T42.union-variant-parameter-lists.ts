// R5TD-1 / T42 A union whose variants declare a method with DIFFERENT parameter lists (an extra optional parameter,
// different parameter types, a generic method in one variant, overloads in one variant) has the setup API on calls of
// that method, as for variants whose parameter lists are the same (T39, R4TD-1.T39.function-union-members.ts):
// `.returns()`, `.resolves()`, `.rejects()`, `.throws()`, `.mimicks()` and the configure view take what any variant
// whose overloads the call can reach returns. Values no variant returns are still rejected.
import { Substitute, Arg, configure, received, didNotReceive, returns } from '../src'
import { expectType } from './helpers'

// API clients of two versions: the newer `fetch` takes an optional second parameter; same return type.
interface Options { timeout: number }
interface ClientV1 { version: 1; fetch(url: string): Promise<string> }
interface ClientV2 { version: 2; fetch(url: string, options?: Options): Promise<string> }
const client = Substitute.for<ClientV1 | ClientV2>()
client.fetch('/a').resolves('ok')
client.fetch(Arg.any()).returns(Promise.resolve('ok'))
client.fetch('/a', { timeout: 1 }).resolves('ok')
client.fetch('/a').rejects(new Error('offline'))
client.fetch(Arg.all()).resolves('ok')
client.fetch('/a', Arg.all()).resolves('ok')
client[configure]().fetch('/a').resolves('ok')
client.received().fetch('/a')
client.received(1).fetch('/a', { timeout: 1 })
client[didNotReceive]().fetch(Arg.any())
const fetched: Promise<string> = client.fetch('/a')
const asClient: ClientV1 | ClientV2 = client
// @ts-expect-error the promise resolves to a string
client.fetch('/a').resolves(1)
// @ts-expect-error the configure view checks the value too
client[configure]().fetch('/a').resolves(1)
// @ts-expect-error the arguments keep their types
client.fetch(1)
// @ts-expect-error the arguments keep their types in the assertion view
client.received().fetch('/a', { timeout: '1' })

// The same return type (`void`), differing parameter lists.
interface LogA { kind: 'a'; log(message: string): void }
interface LogB { kind: 'b'; log(message: string, level?: number): void }
const logger = Substitute.for<LogA | LogB>()
logger.log('x').returns()
logger.log('x').throws(new Error())
logger.log('x', 2).returns()
logger.log(Arg.is(message => message.length > 0)).returns()
logger.log('x')[returns](undefined)
logger[configure]().log('x').returns()
logger.received().log('x')
logger.received().log('x', 1)
// @ts-expect-error `log` returns nothing
logger.log('x').returns(1)
// @ts-expect-error the arguments keep their types
logger.log('x', 'warning')

// Differing return types and differing parameter lists.
interface ReaderA { kind: 'a'; read(path: string): string }
interface ReaderB { kind: 'b'; read(path: string, encoding?: string): Uint8Array }
const reader = Substitute.for<ReaderA | ReaderB>()
reader.read('p').returns('text')
reader.read('p').returns(new Uint8Array())
reader.read('p').returns('text', new Uint8Array())
reader.read('p', 'utf8').returns('text')
reader.read(Arg.any()).returns('text')
reader.read(Arg.all()).returns(new Uint8Array())
reader.read('p').mimicks(path => path)
reader.read('p').mimicks(() => new Uint8Array())
reader[configure]().read('p').returns('text')
reader[configure]().read('p').returns(new Uint8Array())
reader[received](1).read('p')
const read: string | Uint8Array = reader.read('p')
// @ts-expect-error the configured value is a string or a Uint8Array
reader.read('p').returns(1)
// @ts-expect-error the configure view checks the value too
reader[configure]().read('p').returns(1)
// @ts-expect-error the implementation returns a string or a Uint8Array
reader.read('p').mimicks(() => 1)
// @ts-expect-error resolves() is only offered for promises
reader.read('p').resolves('text')
// @ts-expect-error a call in the assertion view returns nothing
reader.received().read('p').returns('text')

// Variants whose parameter lists differ only in optionality.
interface CatA { kind: 'cat'; feed(food: string, amount?: number): 'purr' }
interface DogA { kind: 'dog'; feed(food: string): 'wag' }
const a = Substitute.for<CatA | DogA>()
a.feed('x').returns('purr')
a.feed('x').returns('wag')
const fedA: 'purr' | 'wag' = a.feed('x')
const asA: CatA | DogA = a
// @ts-expect-error the configured value is 'purr' or 'wag'
a.feed('x').returns('moo')

// Variants whose parameter types differ.
interface CatB { kind: 'cat'; pet(where: 'head'): 'purr' }
interface DogB { kind: 'dog'; pet(where: 'head' | 'belly'): 'wag' }
const b = Substitute.for<CatB | DogB>()
b.pet('head').returns('purr')
b.pet('head').returns('wag')
// @ts-expect-error the configured value is 'purr' or 'wag'
b.pet('head').returns('moo')

// A union return type in one variant, overlapping the other.
interface CatC { kind: 'cat'; size(): number | string }
interface DogC { kind: 'dog'; size(): number }
const c = Substitute.for<CatC | DogC>()
c.size().returns(1)
c.size().returns('big')
// @ts-expect-error the configured value is a number or a string
c.size().returns(true)

// Overloads in one variant.
interface CatD { kind: 'cat'; get(key: 'a'): number; get(key: string): string }
interface DogD { kind: 'dog'; get(key: string): boolean }
const d = Substitute.for<CatD | DogD>()
d.get('b').returns('x')
d.get('b').returns(true)
d[configure]().get('b').returns('x')
const asD: CatD | DogD = d
// @ts-expect-error the configured value is what `get(key: string)` returns in either variant
d.get('b').returns(Symbol())

// Overloads in both variants.
interface StoreA { kind: 'a'; get(): string[]; get(key: string): string }
interface StoreB { kind: 'b'; get(): number[]; get(key: string, fallback?: number): number }
const store = Substitute.for<StoreA | StoreB>()
store.get().returns(['a'])
store.get().returns([1])
store.get('k').returns('v')
store.get('k').returns(1)
store.get('k', 2).returns(1)
// @ts-expect-error `get()` returns an array
store.get().returns('v')
// @ts-expect-error `get(key)` returns a string or a number
store.get('k').returns(['v'])

// A generic method in one variant.
interface CatE { kind: 'cat'; id<T>(x: T): T }
interface DogE { kind: 'dog'; id(x: string): string }
const e = Substitute.for<CatE | DogE>()
e.id('x').returns('y')

// `any` return in one variant.
interface CatF { kind: 'cat'; raw(): any }
interface DogF { kind: 'dog'; raw(): string }
const f = Substitute.for<CatF | DogF>()
f.raw().returns(1)
// The same with the variant returning `any` declared second (the call then resolves to the other variant's signature).
interface DogF2 { kind: 'dog'; raw(): string }
interface CatF2 { kind: 'cat'; raw(): any }
const f2 = Substitute.for<CatF2 | DogF2>()
f2.raw().returns(1)
f2[configure]().raw().returns(1)

// `void` and `number`.
interface CatG { kind: 'cat'; run(): void }
interface DogG { kind: 'dog'; run(): number }
const g = Substitute.for<CatG | DogG>()
g.run().returns(1)
g.run().returns(undefined)
// @ts-expect-error the configured value is a number or undefined
g.run().returns('x')

// `Arg.all()`, also after leading arguments.
interface CatH { kind: 'cat'; log(a: string, b: number): 'c' }
interface DogH { kind: 'dog'; log(a: string, b: number): 'd' }
const h = Substitute.for<CatH | DogH>()
h.log('a', Arg.all()).returns('c')
h.log(Arg.all()).returns('d')
h.received().log('a', Arg.all())
h.log('a', 1).throws(new Error())
// @ts-expect-error the configured value is 'c' or 'd'
h.log(Arg.all()).returns('e')
// @ts-expect-error the configured value is 'c' or 'd'
h.log('a', Arg.all()).returns('e')
// @ts-expect-error resolves() is only offered for promises
h.log('a', 1).resolves('c')

// Promises in the variants.
interface CatI { kind: 'cat'; load(): Promise<number> }
interface DogI { kind: 'dog'; load(): Promise<string> | undefined }
const i = Substitute.for<CatI | DogI>()
i.load().resolves(1)
i.load().returns(undefined)
i.load().rejects(new Error())

// Three variants with the same parameter list.
interface W1 { k: 1; m(): 'a' }
interface W2 { k: 2; m(): 'b' }
interface W3 { k: 3; m(): 'c' }
const w = Substitute.for<W1 | W2 | W3>()
w.m().returns('c')
w[configure]().m().returns('a')
w[received](1).m()
// @ts-expect-error the configured value is 'a', 'b' or 'c'
w.m().returns('d')
// @ts-expect-error the configure view checks the value too
w[configure]().m().returns('d')

// Three variants with differing parameter lists.
interface V1 { k: 1; m(): 'a' }
interface V2 { k: 2; m(x?: string): 'b' }
interface V3 { k: 3; m(x: string, y?: number): 'c' }
const v = Substitute.for<V1 | V2 | V3>()
v.m().returns('a')
v.m().returns('b')
v.m('x').returns('b')
v.m('x').returns('c')
v[configure]().m().returns('a')
v[received](1).m()
// @ts-expect-error a call without arguments reaches only `m()` and `m(x?)`
v.m().returns('c')
// @ts-expect-error the configured value is 'b' or 'c'
v.m('x').returns('d')
// @ts-expect-error the configure view checks the value too
v[configure]().m().returns('d')

// Variants whose methods require different numbers of arguments. (TypeScript 5.3 and older paired the call
// `f('s', 1)` with `f(a)` as well, which `.returns('y')` then had to satisfy too; see `CombinedSignatures`.)
interface CatJ { kind: 'cat'; f(a: string): 'x' }
interface DogJ { kind: 'dog'; f(a: string, b: number): 'y' }
const j = Substitute.for<CatJ | DogJ>()
j.f('s').returns('x')
j.f('s', 1).returns('y')
j.f(Arg.any(), Arg.any()).returns('y')
j[configure]().f('s', 1).returns('y')
j.received().f('s', 1)
// @ts-expect-error a call with one argument reaches only `f(a)`
j.f('s').returns('y')

// A substitute of a union of function types whose parameter lists differ.
type Handler = ((event: string) => number) | ((event: string, retry?: boolean) => string)
const handler = Substitute.for<Handler>()
handler('x').returns(1)
handler('x').returns('y')
handler[configure]()('x').returns(2)
handler.received()('x')
// @ts-expect-error the configured value is a number or a string
handler('x').returns(true)

// A callback member typed as a union of function types whose parameter lists differ.
interface Listeners { onResult: ((result: string) => number) | ((result: string, index?: number) => string) }
const listeners = Substitute.for<Listeners>()
listeners.onResult('x').returns(1)
listeners.onResult('x').returns('y')
listeners[configure]().onResult('x').returns(2)
// @ts-expect-error the configured value is a number or a string
listeners.onResult('x').returns(true)

expectType<'purr' | 'wag'>(a.feed('x'))
export { fetched, asClient, read, fedA, asA, asD }
