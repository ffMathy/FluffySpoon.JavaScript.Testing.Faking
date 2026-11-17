// R6TD-1 / T45 Concrete unions whose variants declare a method with different parameter lists and different return
// types (T42): which variants a call can reach is decided by the arguments the call passes. A call that omits an
// optional parameter in which the variants differ, a single `Arg.all()`, and calls of a variant with a rest parameter
// take what every variant that accepts these arguments returns. (For `Arg.any()` and untyped `Arg.is()` predicates see
// limitations.ts.)
import { Substitute, SubstituteOf, Arg, configure, received } from '../src'

// Two API versions whose options type changed, together with the return type.
interface OptionsV1 { retries: number }
interface OptionsV2 { timeoutMs: number }
interface ApiV1 { version: 1; get(key: string, options?: OptionsV1): number }
interface ApiV2 { version: 2; get(key: string, options?: OptionsV2): string }
const api = Substitute.for<ApiV1 | ApiV2>()
api.get('k').returns(1)
api.get('k').returns('s')
api[configure]().get('k').returns('s')
api.get(Arg.any()).returns('s')
api.get(Arg.all()).returns('s')
api.get('k', { retries: 1 }).returns(1)
api.get('k', { timeoutMs: 1 }).returns('s')
api.received().get('k')
const fromAnyVersion: number | string = api.get('k')
// @ts-expect-error the configured value is a number or a string
api.get('k').returns(true)
// @ts-expect-error `get(key, options: OptionsV1)` is only declared by ApiV1, which returns a number
api.get('k', { retries: 1 }).returns('s')
// @ts-expect-error `get(key, options: OptionsV2)` is only declared by ApiV2, which returns a string
api.get('k', { timeoutMs: 1 }).returns(1)
// @ts-expect-error the options keep their types
api.get('k', { retries: 'many' })

// A single `Arg.all()` matches every call of every variant.
interface NA { kind: 'a'; m(x: string): 'A' }
interface NB { kind: 'b'; m(x: number): 'B' }
const n = Substitute.for<NA | NB>()
n.m(Arg.all()).returns('A')
n.m(Arg.all()).returns('B')
n[configure]().m(Arg.all()).returns('B')
n.m('s').returns('A')
n.m(1).returns('B')
n.m(Arg.any('number')).returns('B')
n.m(Arg.is((x: number) => x > 1)).returns('B')
// @ts-expect-error a string argument only reaches NA's `m`
n.m('s').returns('B')
// @ts-expect-error a number argument only reaches NB's `m`
n.m(1).returns('A')
// @ts-expect-error the configured value is 'A' or 'B'
n.m(Arg.all()).returns('C')
// @ts-expect-error neither variant takes a boolean
n.m(true)

// A variant with a rest parameter.
interface RA { kind: 'a'; log(...args: string[]): 'A' }
interface RB { kind: 'b'; log(first: string, second?: number): 'B' }
const r = Substitute.for<RA | RB>()
r.log('x').returns('A')
r.log('x').returns('B')
r.log().returns('A')
r.log('x', 'y', 'z').returns('A')
r.log('x', 1).returns('B')
r.log(Arg.all()).returns('A')
r.log(Arg.all()).returns('B')
r.received().log('x', 'y', 'z')
// @ts-expect-error three arguments only reach RA's `log`
r.log('x', 'y', 'z').returns('B')
// @ts-expect-error a number as the second argument only reaches RB's `log`
r.log('x', 1).returns('A')

// Overloads with optional parameters next to an overload that requires them.
interface Plot { kind: 'plot'; draw(x: number, y?: number, z?: number): 'flat'; draw(x: number, y: number, z: number): 'solid' }
interface Sketch { kind: 'sketch'; draw(x: number): 'line' }
const drawing = Substitute.for<Plot | Sketch>()
drawing.draw(1, 2, 3).returns('solid')
drawing.draw(1, 2, 3).returns('flat')
drawing.draw(1).returns('line')
drawing.draw(1).returns('flat')
// @ts-expect-error `draw(x)` with one argument never returns 'solid'
drawing.draw(1).returns('solid')

// Generic code keeps the variant's own signatures (see limitations.ts for union constraints).
export function stubApi<T extends ApiV1>(sub: SubstituteOf<T>) {
  sub.get('k').returns(1)
  sub[received](1).get('k')
}

export { fromAnyVersion }
