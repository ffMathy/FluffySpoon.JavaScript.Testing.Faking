// R3TD-7 / T38 `Arg.any('undefined')` fits only parameters (and properties) that accept `undefined`. It used to be
// typed `never`, which fits every parameter. Its type is taken from where it is used: the parameter type when that
// accepts `undefined`, otherwise `undefined` (a compile error there). On its own it is `undefined`.
// `Arg.any.not('undefined')` matches every defined value and still fits any parameter.
import { Substitute, SubstituteOf, Arg, configure, received } from '../src'
import { Argument } from '../src/shared'
import { assert, Equals } from './helpers'

interface Calculator {
  add(a: number, b: number): number
  find(id?: string): string
  maybe(value: number | undefined): number
  anything(value: unknown): void
  save(item: { id: string }): void
  note?: string
  title: string
}
const calculator = Substitute.for<Calculator>()

calculator.find(Arg.any('undefined')).returns('none')
calculator.maybe(Arg.any('undefined')).returns(0)
calculator.anything(Arg.any('undefined'))
calculator.received().find(Arg.any('undefined'))
calculator.didNotReceive().maybe(Arg.any('undefined'))
calculator[received](1).anything(Arg.any('undefined'))
calculator[configure]().find(Arg.any('undefined')).returns('none')
calculator.received().note = Arg.any('undefined')

// @ts-expect-error a number parameter does not accept undefined
calculator.add(Arg.any('undefined'), 2).returns(3)
// @ts-expect-error nor in the assertion view
calculator.received().add(1, Arg.any('undefined'))
// @ts-expect-error nor in the configure view
calculator[configure]().add(Arg.any('undefined'), 2).returns(3)
// @ts-expect-error an object parameter does not accept undefined
calculator.save(Arg.any('undefined'))
// @ts-expect-error a required property does not accept undefined
calculator.received().title = Arg.any('undefined')

// on its own
const missing = Arg.any('undefined')
assert<Equals<typeof missing, undefined>>()
calculator.find(missing)
// @ts-expect-error a number parameter does not accept undefined
calculator.add(missing, 2)

// as a matcher object (spec/regression/Arguments.spec.ts does this)
const matches: boolean = (<Argument<unknown>>Arg.any('undefined')).matches(undefined)

// the inverse fits any parameter
calculator.add(Arg.any.not('undefined'), 2).returns(3)
calculator.save(Arg.any.not('undefined'))
calculator.received().title = Arg.any.not('undefined')
// the other types are unchanged (`Arg.any.not('number')` is typed like `Arg.any('number')`)
calculator.add(Arg.any('number'), Arg.any.not('number'))
// @ts-expect-error a string matcher does not fit a number parameter
calculator.add(Arg.any('string'), 2)

// generic code over a constraint (T33)
export function stub<T extends Calculator>(sub: SubstituteOf<T>) {
  sub.find(Arg.any('undefined')).returns('none')
  // @ts-expect-error a number parameter does not accept undefined
  sub.add(Arg.any('undefined'), 2)
}

export { matches }
