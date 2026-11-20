// R17FE-2 / T83 `CheckViewOf<T>` is the type of a check view: what `received()` / `didNotReceive()` and `[received]()` /
// `[didNotReceive]()` return, for the string and the symbol forms, also in generic code (unconstrained, constrained,
// `T | undefined`). See spec-types/declaration-emit/R17FE-2.T83.check-view-type.ts for declaration emit, and
// packaging/package.test.js for `isolatedDeclarations` and the module resolutions that read the emitted declarations.
import { Arg, CheckViewOf, Substitute, SubstituteOf, didNotReceive, received } from '../src'

interface Calculator { add(a: number, b: number): number; total: number }

function once<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub.received(1) }
function never<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub.didNotReceive() }
function onceSymbol<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[received](1) }
function neverSymbol<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[didNotReceive]() }
function onceCalculator<T extends Calculator>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub.received(1) }
function onceCalculatorSymbol<T extends Calculator>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[received](1) }
function onceOptional<T>(sub: SubstituteOf<T | undefined>): CheckViewOf<T | undefined> { return sub[received](1) }
// `ReturnType<typeof sub.received>` keeps working.
function typeofForm<T>(sub: SubstituteOf<T>): ReturnType<typeof sub.received> { return sub.received(1) }
// What a check view of the substitute's own type is.
const typeofView: CheckViewOf<Calculator> = typeofForm(Substitute.for<Calculator>())

const calculator = Substitute.for<Calculator>()
once(calculator).add(1, 2)
never(calculator).add(1, Arg.any())
onceSymbol(calculator).total = 2
neverSymbol(calculator).add(Arg.all())
onceCalculator(calculator).add(1, 2)
onceCalculatorSymbol(calculator).total
onceOptional(Substitute.for<Calculator | undefined>())

// The forms written with the type parameter itself do not compile in generic code (TypeScript cannot resolve the
// string forms' conditional member type there, nor index the substitute type with a symbol); use `CheckViewOf<T>`.
// @ts-expect-error
function stringForm<T>(sub: SubstituteOf<T>): ReturnType<SubstituteOf<T>['received']> { return sub.received(1) }
// @ts-expect-error
function symbolForm<T>(sub: SubstituteOf<T>): ReturnType<SubstituteOf<T>[typeof received]> { return sub[received](1) }

// @ts-expect-error a substitute is not a check view
function notAView<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub }
// @ts-expect-error add takes numbers
once(calculator).add('1', 2)
// @ts-expect-error calls on a check view return nothing
const sum: number = onceSymbol(calculator).add(1, 2)
// @ts-expect-error total is a number
never(calculator).total = 'one'
// @ts-expect-error the view has the members of Calculator only
neverSymbol(calculator).subtract(1, 2)
// @ts-expect-error a view of another type
const otherView: CheckViewOf<{ remove(id: string): void }> = calculator.received()
