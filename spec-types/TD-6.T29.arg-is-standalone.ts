// TD-6 / T29 A matcher created on its own from an annotated predicate (README "Matching specific arguments") takes its
// type from the predicate. spec-types/min-ts/consumer.ts checks the same pattern with TypeScript 3.6.
import { Substitute, Arg } from '../src'
import { assert, Equals, expectType } from './helpers'

interface Calculator {
  add(a: number, b: number): number
  divide(a: number, b: number): number
}
const calculator = Substitute.for<Calculator>()

const negative = Arg.is((x: number) => x < 0)
calculator.divide(negative, negative).returns(1)
calculator.received().divide(negative, Arg.any())
expectType<number>(negative)

const notZero = Arg.is.not((x: number) => x === 0)
calculator.divide(1, notZero).returns(2)

const explicit = Arg.is<number>(x => x > 0)
calculator.add(explicit, 1)

// in argument position the predicate's parameter type still comes from the parameter
calculator.add(Arg.is(a => { assert<Equals<typeof a, number>>(); return a > 1 }), Arg.any()).returns(1)

// @ts-expect-error a string matcher does not fit a number parameter
calculator.divide(Arg.is((x: string) => x === ''), 1)
