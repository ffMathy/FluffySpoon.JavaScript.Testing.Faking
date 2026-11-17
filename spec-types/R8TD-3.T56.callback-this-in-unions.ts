// R8TD-3 / T56 Concrete unions: a callback that annotates its `this` with the type of one variant whose method takes
// it compiles (each call is what one variant declares), in setups and checks, while a callback that no variant takes
// does not. Callbacks without parameter types are still typed from the context.
import { Substitute, received } from '../src'

interface Btn { kind: 'b'; onClick(cb: (this: Btn, n: number) => void): void }
interface Lnk { kind: 'l'; onClick(cb: (this: Lnk, n: number) => void): void }
const widget = Substitute.for<Btn | Lnk>()
widget.onClick(function (this: Btn, n: number) {})
widget.onClick(function (this: Lnk, n: number) {})
widget.onClick(function (this: Btn, n: number) {}).returns()
widget.onClick(function (n) { return this.kind === 'b' && n > 0 })
widget.received().onClick(function (this: Btn, n: number) {})
widget[received](1).onClick(function (this: Lnk, n: number) {})
// @ts-expect-error the callback takes a number
widget.onClick(function (this: Btn, n: string) {})
// @ts-expect-error neither variant's `this`
widget.onClick(function (this: { other: true }, n: number) {})

interface E1 { k: 1; on(cb: (this: E1, x: string) => void): void }
interface E2 { k: 2; on(cb: (this: E2, x: number) => void): void }
const emitter = Substitute.for<E1 | E2>()
emitter.on(function (this: E1, x: string) {})
emitter.on(function (this: E2, x: number) {})
emitter.on((x: string) => undefined)
emitter.received().on(function (this: E2, x: number) {})
// @ts-expect-error no variant takes a callback with E2's `this` and a string
emitter.on(function (this: E2, x: string) {})
// @ts-expect-error no variant takes a callback with E1's `this` and a number
emitter.on(function (this: E1, x: number) {})

// lib.dom elements, whose listener methods declare `this` as the element itself
const field = Substitute.for<HTMLInputElement | HTMLSelectElement>()
field.addEventListener('change', function (this: HTMLInputElement, ev: Event) { return this.value })
field.addEventListener('change', function (this: HTMLSelectElement, ev: Event) { return this.value })
field.addEventListener('change', function (ev) { return this.value })
// @ts-expect-error a listener of strings is not a listener of events
field.addEventListener('change', (ev: string) => ev)
