// R9TD-1 / R9TD-2 / R9TD-5 / T62 Concrete unions, completing T56 and T57:
// - a call with a callback that annotates `this` with one variant's type returns that variant's value with the setup
//   API on every TypeScript version, also when it omits an optional parameter (on TypeScript 3.6 to 4.1 it was
//   `never`, which took no setup and was assignable to anything);
// - each call is checked against one variant's parameter list as a whole: callbacks with the `this` types of
//   different variants in one call do not compile (TypeScript rejects that call of the union itself);
// - in a check, assigning a function to a member whose type is a union of function types does not compile, as for
//   any other callable member (README, Typing limitations), and as TypeScript rejects a function the union rejects.
import { Substitute, configure, didNotReceive, received } from '../src'

interface Btn { kind: 'b'; onClick(cb: (this: Btn, n: number) => void, options?: { once: boolean }): 'b' }
interface Lnk { kind: 'l'; onClick(cb: (this: Lnk, n: number) => void, options?: { once: boolean }): 'l' }
const widget = Substitute.for<Btn | Lnk>()
widget.onClick(function (this: Btn, n: number) {}).returns('b')
widget.onClick(function (this: Lnk, n: number) {}, { once: true }).returns('l')
widget[configure]().onClick(function (this: Btn, n: number) {}).returns('b')
widget.received().onClick(function (this: Lnk, n: number) {})
// @ts-expect-error the call returns what Btn's onClick returns, with the setup API
const clicked: boolean = widget.onClick(function (this: Btn, n: number) {})
// @ts-expect-error Btn's onClick returns 'b'
widget.onClick(function (this: Btn, n: number) {}).returns(true)
// @ts-expect-error in the configure view too
widget[configure]().onClick(function (this: Btn, n: number) {}).returns(true)

interface A1 { k: 1; on(cb: (this: A1, x: string) => void, option: number): number }
interface B1 { k: 2; on(cb: (this: B1, x: string) => void, option: string): string }
const ab = Substitute.for<A1 | B1>()
ab.on(function (this: A1, x: string) {}, 1).returns(1)
ab.on(function (this: B1, x: string) {}, 'x').returns('y')
// @ts-expect-error A1's on returns a number
const on: boolean = ab.on(function (this: A1, x: string) {}, 1)
// @ts-expect-error A1's on takes a number option
ab.on(function (this: A1, x: string) {}, 'x')

interface C1 { k: 1; both(a: (this: C1) => void, b: (this: C1) => void): void }
interface C2 { k: 2; both(a: (this: C2) => void, b: (this: C2) => void): void }
const c = Substitute.for<C1 | C2>()
c.both(function (this: C1) {}, function (this: C1) {})
c.both(function (this: C2) {}, function (this: C2) {})
c.both(function (this: C1) {}, () => undefined)
c.received().both(function (this: C2) {}, function (this: C2) {})
// @ts-expect-error no variant takes callbacks with C1's and C2's `this`
c.both(function (this: C1) {}, function (this: C2) {})
// @ts-expect-error in checks neither
c.received().both(function (this: C2) {}, function (this: C1) {})
// @ts-expect-error nor in the configure view
c[configure]().both(function (this: C1) {}, function (this: C2) {})

// A variant whose callbacks take different `this` types keeps its own combination.
interface M1 { k: 1; pair(a: (this: M1) => void, b: (this: Window) => void): void }
interface M2 { k: 2; pair(a: (this: M2) => void, b: (this: Window) => void): void }
const m = Substitute.for<M1 | M2>()
m.pair(function (this: M1) {}, function (this: Window) {})
m.pair(function (this: M2) {}, function (this: Window) {})
// @ts-expect-error the second callback takes a Window
m.pair(function (this: M1) {}, function (this: M1) {})

interface Cat { kind: 'cat'; speak(loud: boolean): 'meow' }
interface Dog { kind: 'dog'; speak(loud: boolean): 'woof' }
const pet = Substitute.for<Cat | Dog>()
pet.received().speak(true)
pet[received](1).speak(true)
pet.didNotReceive().speak(false)
// @ts-expect-error a function that returns nothing is not a speak of Cat | Dog
pet.received().speak = () => {}
// @ts-expect-error symbol form
pet[received]().speak = () => {}
// @ts-expect-error didNotReceive
pet.didNotReceive().speak = () => {}
// @ts-expect-error symbol form
pet[didNotReceive]().speak = () => {}
// @ts-expect-error with a count
pet.received(1).speak = () => 1
// @ts-expect-error in a check, a callable member also has the call signatures that take Arg.all()
pet.received().speak = () => 'meow'
