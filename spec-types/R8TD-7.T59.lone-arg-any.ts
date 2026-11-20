// R8TD-7 / T59 `Arg.any()` stands for ONE argument; `Arg.all()` stands for any arguments. Limitation: TypeScript accepts
// a lone `Arg.any()` for a method with more parameters (it is typed `any`, which also fits the `Arg.all()` signature),
// but such a setup or check only matches calls with that one argument: after `calc.add(1, 2)`,
// `calc.didNotReceive().add(Arg.any())` passes and `calc.add(Arg.any()).returns(3)` does not answer `calc.add(1, 2)`.
// Write `Arg.all()`, or one `Arg.any()` per parameter.
import { Substitute, Arg } from '../src'

interface Calc { add(a: number, b: number): number; log(message: string, level: number, tag: string): void }
const calc = Substitute.for<Calc>()
// what to write
calc.add(Arg.all()).returns(3)
calc.add(Arg.any(), Arg.any()).returns(3)
calc.didNotReceive().add(Arg.all())
calc.didNotReceive().add(Arg.any(), Arg.any())
calc.log('x', Arg.all())
// limitation: compiles, but matches one-argument calls only
calc.add(Arg.any()).returns(3)
calc.didNotReceive().add(Arg.any())
calc.log(Arg.any())
// a typed matcher is not `any`: the number of arguments is checked
// @ts-expect-error add takes two arguments
calc.add(Arg.any('number'))
// @ts-expect-error add takes two arguments
calc.add(Arg.is(x => x > 0))
// @ts-expect-error add takes two arguments
calc.add(1)
