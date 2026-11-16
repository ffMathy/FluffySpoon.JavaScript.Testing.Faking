// R4TD-1 / T39 A member whose type is a union of function types with different signatures (`Cat | Dog` whose methods
// return different types, `this`-returning methods in a union, a callback member typed as a union of function types)
// has the setup API, with the union of the variants' return types: `.returns('meow')`, `.resolves(1)`, `.mimicks(...)`
// and the configure view take what any variant returns (a regression in round 4, where they took `never`).
// Generic code is unchanged: see R3TD-1.T33.constrained-generics.ts.
import { Substitute, SubstituteOf, Arg, configure, received, didNotReceive, returns, mimicks, resolves } from '../src'

interface Cat { kind: 'cat'; speak(): 'meow'; load(): Promise<number>; rename(name: string): this; age(): number }
interface Dog { kind: 'dog'; speak(): 'woof'; load(): Promise<string>; rename(name: string): this; age(): number }
const pet = Substitute.for<Cat | Dog>()
pet.speak().returns('meow')
pet.speak().returns('woof', 'meow')
pet.speak()[returns]('woof')
pet.speak().mimicks(() => 'woof')
pet.speak()[mimicks](() => 'meow')
pet.load().resolves(1)
pet.load().resolves('one')
pet.load()[resolves](2)
pet.load().rejects(new Error())
pet.rename('Rex').returns(pet)
pet.rename(Arg.any()).returns(pet)
pet.age().returns(3)
pet[configure]().speak().returns('meow')
pet[configure]().load().resolves(1)
pet[configure]().rename('Rex').returns(pet)
pet.received().speak()
pet.received(1).rename('Rex')
pet[received](1).load()
pet[didNotReceive]().speak()
const said: 'meow' | 'woof' = pet.speak()
const asPet: Cat | Dog = pet

// @ts-expect-error the configured value is one of the variants' return types
pet.speak().returns('moo')
// @ts-expect-error the promise resolves to a number or a string
pet.load().resolves(true)
// @ts-expect-error the implementation returns one of the variants' return types
pet.speak().mimicks(() => 'moo')
// @ts-expect-error the configure view checks the value too
pet[configure]().speak().returns('moo')
// @ts-expect-error resolves() is only offered for promises
pet.speak().resolves('meow')
// @ts-expect-error the arguments keep their types
pet.rename(1)
// @ts-expect-error the arguments keep their types in the assertion view
pet.received().rename(1)
// @ts-expect-error a call in the assertion view returns nothing
pet.received().speak().returns('meow')

// A callback member typed as a union of function types
interface Listeners { onResult: ((result: string) => number) | ((result: string) => string) }
const listeners = Substitute.for<Listeners>()
listeners.onResult('x').returns(1)
listeners.onResult('x').returns('y')
listeners.onResult(Arg.all()).mimicks(result => result.length)
listeners[configure]().onResult('x').returns(1)
listeners.received().onResult('x')
// @ts-expect-error the configured value is a number or a string
listeners.onResult('x').returns(true)
// @ts-expect-error the arguments keep their types
listeners.onResult(1)

// Object unions whose methods differ
type Shape = { kind: 'circle'; area(): number } | { kind: 'text'; area(): string }
const shape = Substitute.for<Shape>()
shape.area().returns(1)
shape.area().returns('x')
shape[configure]().area().returns(2)
// @ts-expect-error the configured value is a number or a string
shape.area().returns(true)
const asShape: Shape = shape

interface Ok { ok: true; get(): string }
interface Fail { ok: false; get(): never }
const outcome = Substitute.for<Ok | Fail>()
outcome.get().returns('x')
outcome.get().throws(new Error())
// @ts-expect-error the configured value is a string
outcome.get().returns(1)

// A substitute of a union of function types
type Handler = ((event: string) => number) | ((event: string) => string)
const handler = Substitute.for<Handler>()
handler('x').returns(1)
handler('x').returns('y')
handler[configure]()('x').returns(2)
handler.received()('x')
// @ts-expect-error the configured value is a number or a string
handler('x').returns(true)

// lib.dom unions
const field = Substitute.for<HTMLInputElement | HTMLSelectElement>()
field.checkValidity().returns(true)
field.cloneNode().returns(document.createElement('input'))
field.setCustomValidity('x').returns()
field.received().addEventListener('change', Arg.any())

// A rest parameter typed as a union of tuples puts both tuples in every overload position of the expansion. The
// signatures of identical positions must stay identical types, so that their intersection collapses; with one
// distinct type per position, type-checking this took minutes (and ran out of memory on TypeScript 5.4).
interface Varargs { log(...args: [string] | [string, number]): boolean }
const varargs = Substitute.for<Varargs>()
const asVarargs: Varargs = varargs
varargs.received().log('a')
varargs.received().log('a', 1)

// Generic code with a union constraint: members whose signature is the same in every variant are configured through
// the constraint (T33). (Members whose signatures differ are a documented limitation, see limitations.ts.)
export function stub<T extends Cat | Dog>(sub: SubstituteOf<T>) {
  sub.age().returns(1)
  sub.kind.returns('cat')
  sub.received().speak()
}

export { said, asPet, asShape, asVarargs }
