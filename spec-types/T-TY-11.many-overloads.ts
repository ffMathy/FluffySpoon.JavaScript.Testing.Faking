// T:TY-11 Methods with up to 8 overloads keep the substitute typing on every overload. (With more than 8 overloads,
// only the last 8 have it; that limit is documented.)
import { Substitute, Arg, configure } from '../src'

interface A { a: 1 } interface B { b: 1 } interface C { c: 1 } interface D { d: 1 }
interface E { e: 1 } interface F { f: 1 } interface G { g: 1 } interface H { h: 1 }

interface Six {
  f(a: string): string[]
  f(a: number): number[]
  f(a: boolean): boolean[]
  f(a: symbol): symbol[]
  f(a: Date): Date[]
  f(a: RegExp): RegExp[]
}
const six = Substitute.for<Six>()
six.f('x').returns(['x'])
six.f(1).returns([1])
six.f(true).returns([true])
six.f(Symbol.iterator).returns([Symbol.iterator])
six.f(new Date()).returns([])
six.f(/x/).returns([/x/])
six.f(Arg.all()).returns(['any'])
six.received().f('x')
six.received().f(/x/)

interface Eight {
  g(a: A): 'A'
  g(a: B): 'B'
  g(a: C): 'C'
  g(a: D): 'D'
  g(a: E): 'E'
  g(a: F): 'F'
  g(a: G): 'G'
  g(a: H): 'H'
}
const eight = Substitute.for<Eight>()
eight.g({ a: 1 }).returns('A')
eight.g({ d: 1 }).returns('D')
eight.g({ h: 1 }).returns('H')

// @ts-expect-error each overload keeps its own return type
six.f('x').returns([1])
// @ts-expect-error each overload keeps its own return type
eight.g({ a: 1 }).returns('B')

// Overloads whose parameters are declared with literal types (`f(a: 'x')`, `f(a: null)`) are tried first by TypeScript,
// before any other signature, so a direct call resolves to the interface's own declaration and has no setup API.
// The [configure]() view has no such declarations: use it to configure these overloads.
interface Events {
  on(event: 'data', listener: (chunk: string) => void): this
  on(event: 'end', listener: () => void): this
  get(key: null): undefined
  get(key: string): string
}
const events = Substitute.for<Events>()
events[configure]().on('data', Arg.any()).returns(events)
events[configure]().on('end', Arg.any()).returns(events)
events[configure]().get(null).returns(undefined)
events.get('k').returns('v')
events.received().on('data', Arg.any())
