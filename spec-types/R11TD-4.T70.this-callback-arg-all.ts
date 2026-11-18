// R11TD-4 / T70 Concrete unions: `Arg.all()` after a callback that annotates `this` with one variant's type compiles in
// setups, checks and the configure view, when the leading arguments fit the first parameters of that variant's
// parameter list and the list has a parameter where `Arg.all()` is passed. The result takes what that variant returns.
import { Arg, Substitute, configure, received } from '../src'

interface Btn { kind: 'b'; onClick(cb: (this: Btn, n: number) => void, options?: { once: boolean }): 'b' }
interface Lnk { kind: 'l'; onClick(cb: (this: Lnk, n: number) => void, options?: { once: boolean }): 'l' }
const widget = Substitute.for<Btn | Lnk>()
widget.onClick(function (this: Btn, n: number) { }, Arg.all()).returns('b')
widget.onClick(function (this: Lnk, n: number) { }, Arg.all()).returns('l')
widget.received().onClick(function (this: Btn, n: number) { }, Arg.all())
widget[received](1).onClick(function (this: Lnk, n: number) { }, Arg.all())
widget.didNotReceive().onClick(function (this: Btn, n: number) { }, Arg.all())
widget[configure]().onClick(function (this: Btn, n: number) { }, Arg.all()).returns('b')
widget.onClick(function (this: Btn, n: number) { }, Arg.all()).mimicks(() => 'b')
// @ts-expect-error Btn's onClick returns 'b'
widget.onClick(function (this: Btn, n: number) { }, Arg.all()).returns('l')
// @ts-expect-error in the configure view too
widget[configure]().onClick(function (this: Lnk, n: number) { }, Arg.all()).returns('b')
// @ts-expect-error the callback takes a number
widget.onClick(function (this: Btn, n: string) { }, Arg.all())
// @ts-expect-error in a check too
widget.received().onClick(function (this: Btn, n: string) { }, Arg.all())
// @ts-expect-error Arg.all() after the last parameter
widget.onClick(function (this: Btn, n: number) { }, { once: true }, Arg.all())
// @ts-expect-error nothing may follow Arg.all()
widget.onClick(function (this: Btn, n: number) { }, Arg.all(), { once: true })
// @ts-expect-error the call returns 'b' with the setup API, not a boolean
const clicked: boolean = widget.onClick(function (this: Btn, n: number) { }, Arg.all())

// Variants with different parameter lists: `Arg.all()` must be at a parameter of the variant whose `this` the
// callback declares.
interface A { k: 'a'; on(cb: (this: A, x: string) => void): 'ra' }
interface B { k: 'b'; on(cb: (this: B, x: string) => void, extra: number): 'rb' }
const ab = Substitute.for<A | B>()
ab.on(function (this: B, x: string) { }, Arg.all()).returns('rb')
ab.received(1).on(function (this: B, x: string) { }, Arg.all())
// @ts-expect-error A's on takes no argument after the callback
ab.on(function (this: A, x: string) { }, Arg.all())
// @ts-expect-error B's on returns 'rb'
ab.on(function (this: B, x: string) { }, Arg.all()).returns('ra')

// Several callbacks: each one with the same variant's `this`.
interface C1 { k: 1; both(a: (this: C1) => void, b: (this: C1) => void, c?: number): 1 }
interface C2 { k: 2; both(a: (this: C2) => void, b: (this: C2) => void, c?: number): 2 }
const c = Substitute.for<C1 | C2>()
c.both(function (this: C1) { }, Arg.all()).returns(1)
c.both(function (this: C1) { }, function (this: C1) { }, Arg.all()).returns(1)
// @ts-expect-error no variant takes callbacks with C1's and C2's `this`
c.both(function (this: C1) { }, function (this: C2) { }, Arg.all())
