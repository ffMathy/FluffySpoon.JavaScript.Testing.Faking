// R17FE-2 / T83 The type of a check view is exported as `CheckViewOf<T>`: what `received()` / `didNotReceive()` and
// `[received]()` / `[didNotReceive]()` return. A generic helper that opens a check and returns the view can be annotated
// with it, for the string and the symbol forms, which a project built with `declaration: true` (this directory's
// tsconfig) or with `isolatedDeclarations` (spec-types/isolated-declarations) needs. Before T83 the only annotation that
// compiled was `ReturnType<typeof sub.received>`, and the symbol forms had none: `ReturnType<SubstituteOf<T>['received']>`
// and `ReturnType<SubstituteOf<T>[typeof received]>` gave TS2322 in generic code.
// `npm run test:types:min-ts` compiles this file with TypeScript 3.6 and 4.3 too.
import { Arg, CheckViewOf, Substitute, SubstituteOf, didNotReceive, received } from '../../src'

export interface Calculator { add(a: number, b: number): number; total: number; load(): Promise<number> }
export type Listener = (event: string) => void

export function once<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub.received(1) }
export function never<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub.didNotReceive() }
export function onceSymbol<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[received](1) }
export function neverSymbol<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[didNotReceive]() }
export function times<T>(sub: SubstituteOf<T>, count: number): CheckViewOf<T> { return sub[received](count) }
// A constrained type parameter.
export function onceCalculator<T extends Calculator>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[received](1) }
// A concrete type.
export function calculatorView(sub: SubstituteOf<Calculator>): CheckViewOf<Calculator> { return sub.received() }
export class Checks<T> {
  constructor(private readonly sub: SubstituteOf<T>) {}
  once(): CheckViewOf<T> { return this.sub[received](1) }
}

// The views keep their API.
const calculator = Substitute.for<Calculator>()
once(calculator).add(1, 2)
never(calculator).add(Arg.any(), Arg.all())
onceSymbol(calculator).total
neverSymbol(calculator).load()
times(calculator, 2).total = 3
onceCalculator(calculator).add(1, Arg.any())
calculatorView(calculator).add(1, 2)
new Checks(calculator).once().add(1, 2)
const listener = Substitute.for<Listener>()
once(listener)('saved')
onceSymbol(listener)(Arg.any())
const view: CheckViewOf<Calculator> = calculator.received()
const symbolView: CheckViewOf<Calculator> = calculator[didNotReceive]()

