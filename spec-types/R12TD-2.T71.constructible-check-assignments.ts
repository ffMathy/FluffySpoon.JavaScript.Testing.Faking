// R12TD-2 / T71 In a check, a member whose type is a union of function types (one per variant of a concrete union)
// rejects real constructible callables again, as TypeScript rejects them for the union itself: the built-in
// constructors `String`, `Boolean` and `Date`, classes, and hybrids with call and construct signatures. Matchers still
// fit, `Arg.any('function')` included (T67), in every check form. (Round 12's T67 let every value with a construct
// signature through.)
import { Arg, Substitute, didNotReceive, received } from '../src'

interface Cat { kind: 'cat'; speak(loud: boolean): 'meow'; fmt(v: number): string; onEvent: (e: string) => void }
interface Dog { kind: 'dog'; speak(loud: boolean): 'woof'; fmt(v: number): number; onEvent: (e: string) => void }
const pet = Substitute.for<Cat | Dog>()
interface HybridS { (loud: boolean): string; new (loud: boolean): string }
declare const hybrid: HybridS
class Speaker { constructor(loud: boolean) {} }
declare let plainPet: Cat | Dog

// What TypeScript itself says for the union.
// @ts-expect-error String returns a string, not 'meow' | 'woof'
plainPet.speak = String
// @ts-expect-error neither does the hybrid
plainPet.speak = hybrid

// @ts-expect-error String is not a speak of Cat | Dog
pet.received().speak = String
// @ts-expect-error Boolean neither
pet.received().speak = Boolean
// @ts-expect-error Date neither
pet.received().speak = Date
// @ts-expect-error nor a class
pet.received().speak = Speaker
// @ts-expect-error nor a value with call and construct signatures
pet.received().speak = hybrid
// @ts-expect-error symbol form
pet[received]().speak = String
// @ts-expect-error with a count
pet.received(1).speak = hybrid
// @ts-expect-error symbol form with a count
pet[received](1).speak = Date
// @ts-expect-error didNotReceive
pet.didNotReceive().speak = hybrid
// @ts-expect-error symbol form of didNotReceive
pet[didNotReceive]().speak = Boolean
// @ts-expect-error a member whose variants have different parameter lists
pet.received().fmt = hybrid
// @ts-expect-error fmt neither takes String
pet.received().fmt = String

// Matchers fit, as in T67.
pet.received().speak = Arg.any('function')
pet[received]().speak = Arg.any('function')
pet.received(1).speak = Arg.any('function')
pet[received](1).speak = Arg.any('function')
pet.didNotReceive().speak = Arg.any('function')
pet[didNotReceive]().speak = Arg.any('function')
pet.received().fmt = Arg.any('function')
pet.received().onEvent = Arg.any('function')
pet.received().speak = Arg.any()
pet.received().speak = Arg.is(f => typeof f === 'function')
pet.received().speak = Arg.any.not('undefined')
