// R12FE-5 / T72 `sub[mimick](instance)` takes a partial instance of an object type (`Partial<T>`), as the runtime
// supports it (members the instance does not have read as `undefined`): `client[mimick]({ baseUrl: '' })` gives
// property assignments that stick. The member types are still checked, and so are excess properties of an object
// literal. A substitute of a function type (or of a type with call or construct signatures), of an array or of a tuple
// takes a whole instance, as before. In generic code the instance is a `T`, as before.
import { Substitute, SubstituteOf, mimick } from '../src'

interface Client { baseUrl: string; timeout?: number; get(path: string): Promise<string> }
const client = Substitute.for<Client>()
client[mimick]({ baseUrl: '' })
client[mimick]({ get: async path => path.toUpperCase() })
client[mimick]({ baseUrl: '', timeout: 1, get: async (path: string) => path })
client[mimick]({})
declare const realClient: Client
client[mimick](realClient)
// @ts-expect-error the member types are checked
client[mimick]({ baseUrl: 1 })
// @ts-expect-error an object literal has no other members
client[mimick]({ baseURL: '' })
// @ts-expect-error an object literal has no other members
client[mimick]({ baseUrl: '', retries: 1 })
// @ts-expect-error methods are checked too
client[mimick]({ get: (path: number) => '' })
// @ts-expect-error not an instance
client[mimick](42)
// @ts-expect-error not an instance
client[mimick](() => 1)
// @ts-expect-error not an instance
client[mimick](null)
const unrelated = { retries: 1 }
// @ts-expect-error an object that has none of the members
client[mimick](unrelated)

// Contextual types for the members of the instance.
interface Calculator { add(a: number, b: number): number; load(): Promise<number> }
const calculator = Substitute.for<Calculator>()
calculator[mimick]({ add: (a, b) => a + b })
// @ts-expect-error add returns a number
calculator[mimick]({ add: (a, b) => a.toFixed() })

// Unions take a partial instance of one of the variants.
interface Cat { kind: 'cat'; meow(): string }
interface Dog { kind: 'dog'; bark(): string }
const pet = Substitute.for<Cat | Dog>()
pet[mimick]({ kind: 'cat' })
pet[mimick]({ bark: () => 'woof' })
// @ts-expect-error not a kind of Cat | Dog
pet[mimick]({ kind: 'cow' })
// @ts-expect-error an object literal has no other members
pet[mimick]({ kind: 'cat', purr: true })

// Function types, types with call or construct signatures, arrays and tuples take a whole instance.
type Listener = (event: string) => string
const listener = Substitute.for<Listener>()
listener[mimick](event => event.toUpperCase())
// @ts-expect-error a listener is a function
listener[mimick]({})
// @ts-expect-error the parameters are checked
listener[mimick]((event: number) => '')
interface Formatter { (value: number): string; locale: string }
const formatter = Substitute.for<Formatter>()
declare const realFormatter: Formatter
formatter[mimick](realFormatter)
// @ts-expect-error the call signature is needed
formatter[mimick]({ locale: 'en' })
class Connection { constructor(public url: string) {} open() { return true } }
const connectionClass = Substitute.for<typeof Connection>()
connectionClass[mimick](Connection)
// @ts-expect-error the construct signature is needed
connectionClass[mimick]({ prototype: Connection.prototype })
const letters = Substitute.for<string[]>()
letters[mimick](['a', 'b'])
// @ts-expect-error no undefined elements
letters[mimick]([undefined])
const pair = Substitute.for<[string, number]>()
pair[mimick](['a', 1])
// @ts-expect-error a tuple needs all its elements
pair[mimick](['a'])
const text = Substitute.for<string>()
text[mimick]('x')
// @ts-expect-error a string substitute mimicks a string
text[mimick](1)

// Generic code: the instance is a `T`.
export function delegate<T>(sub: SubstituteOf<T>, instance: T) {
  sub[mimick](instance)
}
export function delegateClient<T extends Client>(sub: SubstituteOf<T>, instance: T) {
  sub[mimick](instance)
}
export function delegateFunction<T extends (...args: any[]) => unknown>(sub: SubstituteOf<T>, instance: T) {
  sub[mimick](instance)
}
export function delegatePartial<T>(sub: SubstituteOf<T>, instance: Partial<T>) {
  // @ts-expect-error a partial instance needs a concrete type
  sub[mimick](instance)
}
export class Fixture<T> {
  sub = Substitute.for<T>()
  use(instance: T) {
    this.sub[mimick](instance)
  }
}
interface Box<V> { value: V; get(): V }
export function box<V>(sub: SubstituteOf<Box<V>>, value: V) {
  sub[mimick]({ value })
}
