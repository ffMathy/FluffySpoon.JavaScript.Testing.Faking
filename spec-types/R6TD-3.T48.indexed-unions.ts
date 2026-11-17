// R6TD-3 / T48 Concrete unions whose variants have a string index signature take the union of the variants' return
// types too (T39, T42), as unions without one do: the union is mapped as one type, not variant by variant.
import { Substitute, SubstituteOf, Arg, configure, received } from '../src'

interface IA { kind: 'a'; [key: string]: unknown; speak(): 'meow' }
interface IB { kind: 'b'; [key: string]: unknown; speak(): 'woof' }
const pet = Substitute.for<IA | IB>()
pet.speak().returns('meow')
pet.speak().returns('woof')
pet[configure]().speak().returns('meow')
pet.received().speak()
pet[received](1).speak()
pet.kind.returns('a')
pet.other.returns(1)
const asPet: IA | IB = pet
// @ts-expect-error the configured value is 'meow' or 'woof'
pet.speak().returns('moo')
// @ts-expect-error the configure view checks the value too
pet[configure]().speak().returns('moo')

// Different parameter lists.
interface JA { kind: 'a'; [key: string]: unknown; read(path: string): string }
interface JB { kind: 'b'; [key: string]: unknown; read(path: string, encoding?: string): Uint8Array }
const reader = Substitute.for<JA | JB>()
reader.read('p').returns('x')
reader.read('p').returns(new Uint8Array())
reader.read('p', 'utf8').returns(new Uint8Array())
// @ts-expect-error the configured value is a string or a Uint8Array
reader.read('p').returns(1)

// Records of function types.
type Handlers = Record<string, (x: string) => number> | Record<string, (x: string) => string>
const handlers = Substitute.for<Handlers>()
handlers.foo('x').returns(1)
handlers.foo('x').returns('s')
handlers.bar(Arg.any()).returns(2)
// @ts-expect-error the configured value is a number or a string
handlers.foo('x').returns(true)

// The same variants on their own still work as before (T:TY-8).
const one = Substitute.for<IA>()
one.speak().returns('meow')
one.kind.returns('a')
// @ts-expect-error IA's `speak` returns 'meow'
one.speak().returns('woof')

// Generic code keeps the constraint's members (T41).
export function stubSpeak<T extends IA>(sub: SubstituteOf<T>) {
  sub.speak().returns('meow')
}

export { asPet }
