// R7TD-5 / R7TD-8 / R7TD-11 / T49 Concrete unions whose variants declare a method with different parameter lists check a
// call against each variant's parameter list as a whole, also when every variant returns the same type: no combination
// of arguments that no variant accepts compiles, in setups, checks and the configure view. Callbacks without parameter
// types are typed from the parameter list the call resolves to. (spec-types/R6V-5.R6TD-2.T44.check-cost.js checks the
// type-check cost of the union of all lib.dom elements.)
import { Substitute, Arg, configure, received, didNotReceive } from '../src'

// R7TD-5: every variant returns the same type (`void`, `Promise<void>`)
interface Left { side: 'left'; move(x: string, y: number): void; save(name: string, data: string): Promise<void> }
interface Right { side: 'right'; move(x: number, y: string): void; save(id: number): Promise<void> }
const shape = Substitute.for<Left | Right>()
shape.move('a', 1)
shape.move(1, 'b').returns()
shape.received().move('a', 1)
shape[configure]().move(1, 'b').returns()
shape.save('n', 'd').resolves()
shape.save(1).resolves()
shape.move('a', Arg.any())
shape.move(Arg.all())
// @ts-expect-error neither variant takes (string, string)
shape.move('a', 'b')
// @ts-expect-error neither variant takes (number, number)
shape.move(1, 2)
// @ts-expect-error in a check either
shape.received().move('a', 'b')
// @ts-expect-error nor with didNotReceive()
shape.didNotReceive().move(1, 2)
// @ts-expect-error nor with the symbol form
shape[didNotReceive]().move(1, 2)
// @ts-expect-error nor in the configure view
shape[configure]().move('a', 'b').returns()
// @ts-expect-error Left.save needs the data
shape.save('n').resolves()
// @ts-expect-error Right.save takes one argument
shape.save(1, 'd').resolves()
const asShape: Left | Right = shape

// One variant returns `any`
interface LeftAny { side: 'left'; move(x: string, y: number): any }
interface RightVoid { side: 'right'; move(x: number, y: string): void }
const mixed = Substitute.for<LeftAny | RightVoid>()
mixed.move('a', 1)
// @ts-expect-error neither variant takes (string, string)
mixed.move('a', 'b')

// The variants return different types (as before)
interface LeftR { side: 'left'; move(x: string, y: number): 'L'; save(name: string, data: string): 'L' }
interface RightR { side: 'right'; move(x: number, y: string): 'R'; save(id: number): 'R' }
const shapeR = Substitute.for<LeftR | RightR>()
shapeR.move('a', 1).returns('L')
shapeR.save(1).returns('R')
// @ts-expect-error neither variant takes (string, string)
shapeR.move('a', 'b')
// @ts-expect-error in a check either
shapeR[received]().move('a', 'b')
// @ts-expect-error Left.save needs the data
shapeR.save('n')

// Variants that differ in the number of parameters
interface A { kind: 'a'; g(x: string, y: string): void; h(x: string): boolean }
interface B { kind: 'b'; g(x: number): void; h(x: number, y?: number): boolean }
const ab = Substitute.for<A | B>()
ab.g('x', 'y')
ab.g(1)
ab.h('x').returns(true)
ab.h(1, 2).returns(false)
// @ts-expect-error B.g takes one argument
ab.g(1, 'y')
// @ts-expect-error A.g takes two
ab.g('x')
// @ts-expect-error A.h takes one argument
ab.h('x', 2)
// @ts-expect-error in a check either
ab.received(1).h('x', 2)

// The same method declared in two interfaces (identical parameter lists): one signature
interface LogA { kind: 'a'; log(message: string, level?: number): void }
interface LogB { kind: 'b'; log(message: string, level?: number): void }
const logger = Substitute.for<LogA | LogB>()
logger.log('x').returns()
logger.log('x', 1)
logger.received().log('x', Arg.any())
// @ts-expect-error the level is a number
logger.log('x', 'warn')

// R7TD-8: callbacks without parameter types are typed from the list the call resolves to, also in unions of two
// variants whose callback types differ in their parameter types
interface WsV1 { version: 1; on(cb: (data: string) => void): void }
interface WsV2 { version: 2; on(cb: (data: Uint8Array) => void): void }
const socket = Substitute.for<WsV1 | WsV2>()
socket.on(data => undefined)
socket.on(data => data.length).returns()
socket.received().on(Arg.any())
const media = Substitute.for<HTMLInputElement | HTMLVideoElement>()
media.addEventListener('click', event => event.preventDefault())
media.addEventListener('click', event => event.preventDefault()).returns()
// @ts-expect-error a listener of strings is not a listener of events
media.addEventListener('click', (event: string) => event)
// Parameters declared with literal types in a union (C's `on` alone: see spec-types/R7FE-1.T51.literal-parameters.ts)
interface C { kind: 'c'; on(event: 'x', cb: (e: string) => void): number }
interface D { kind: 'd'; on(event: 'x' | 'y', cb: (e: string) => void): number }
const cd = Substitute.for<C | D>()
cd.on('x', Arg.any()).returns(1)
cd.on('x', (e: string) => e.length).returns(1)
cd.on('y', e => e.length).returns(1)
// @ts-expect-error the listener methods return numbers
cd.on('y', e => e.length).returns('1')
// @ts-expect-error neither variant has a 'z' event
cd.on('z', e => e.length)

// The union of all lib.dom elements: a callback without parameter types is typed as well
type AnyElement = HTMLElementTagNameMap[keyof HTMLElementTagNameMap]
const anyElement = Substitute.for<AnyElement>()
anyElement.addEventListener('click', event => event.preventDefault())
anyElement.addEventListener('click', event => event.preventDefault()).returns()
anyElement.removeEventListener('keydown', event => event.type)
anyElement.received().addEventListener('click', Arg.any())

export { asShape }
