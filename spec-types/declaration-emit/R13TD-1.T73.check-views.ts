// R13TD-1 / T73 Declaration emit of check views. A project built with `declaration: true` (a test-utils package of a
// monorepo, `composite: true`) can export a check view of a substitute, a member read through one, or a function that
// returns one, also for a substitute of a union whose members are unions of function types. Compiled with
// `declaration: true` and `emitDeclarationOnly` by its own tsconfig (spec-types/declaration-emit/tsconfig.json, `npm run
// test:types`); `npm run test:types:min-ts` compiles it the same way against the built typings with old TypeScript
// versions. Round 13 failed here with TS4023 / TS4058 / TS4029
// ("has or is using name 'NotAssignableInstance' ... but cannot be named").
// Not covered, as before round 13: declaration emit of SETUP results and of the configure view
// (`export const s = calc.add(1, 2)`, `export const c = calc[configure]()`), whose setup methods are keyed by the
// library's symbols: TS4023 "has or is using name 'returns'/'throws'/'mimicks'".
import { Substitute, SubstituteOf, didNotReceive, received } from '../../src'

export interface Cat { kind: 'cat'; speak(loud: boolean): 'meow'; fmt(v: number): string; onEvent: (e: string) => void }
export interface Dog { kind: 'dog'; speak(loud: boolean): 'woof'; fmt(v: number, w?: number): number; onEvent: (e: string) => void }
const pet = Substitute.for<Cat | Dog>()

export const view = pet.received()
export const speakView = pet.received().speak
export const symbolView = pet[received]()
export const countedView = pet.received(1)
export const countedSymbolSpeak = pet[received](2).speak
export const negativeView = pet.didNotReceive()
export const negativeSymbolView = pet[didNotReceive]()
export const negativeFmt = pet[didNotReceive]().fmt
export const onEventView = pet.received().onEvent
export function helper(p: SubstituteOf<Cat | Dog>) { return p.didNotReceive() }
export function countedHelper(p: SubstituteOf<Cat | Dog>) { return p[received](1) }
export function speakHelper(p: SubstituteOf<Cat | Dog>) { return p.received().speak }
export class Fixture {
  pet = Substitute.for<Cat | Dog>()
  view = this.pet.received()
}
export const petSubstitute = pet

export interface Calculator { add(a: number, b: number): number; total: number; load(): Promise<number> }
const calculator = Substitute.for<Calculator>()
export const calculatorView = calculator.received()
export const addView = calculator[received]().add
export const calculatorNegativeView = calculator.didNotReceive()
export const calculatorSubstitute = calculator

export type Listener = (event: string) => string
const listener = Substitute.for<Listener>()
export const listenerView = listener.received()
export const listenerSymbolView = listener[received](1)

export function genericView<T>(sub: SubstituteOf<T>) { return sub.received() }
