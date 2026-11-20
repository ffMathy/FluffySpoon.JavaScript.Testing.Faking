// The README examples, written the way they are meant to be used, must type-check.
import { Substitute, Arg, received, SubstituteOf } from '../src'
import { expectType } from './helpers'

interface Calculator {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  divide(a: number, b: number): number
  heavyOperation(...numbers: number[]): Promise<number>
  isEnabled: boolean
}

// Usage
const calculator = Substitute.for<Calculator>()
calculator.add(1, 2).returns(3)
calculator.received().add(1, Arg.any())
calculator.didNotReceive().add(2, 2)

// The substitute can be passed wherever a Calculator is expected.
const asCalculator: Calculator = calculator
expectType<SubstituteOf<Calculator>>(calculator)

// Setting return types
calculator.add(1, 2).returns(4)
calculator.add(1, 2).returns(3, 7, 9)
calculator.isEnabled.returns(true)
calculator.isEnabled.returns(false, true)

// Working with promises
calculator.heavyOperation(1, 2).resolves(4)
calculator.heavyOperation(1, 2).rejects(new Error())
calculator.heavyOperation(1, 2).returns(Promise.resolve(4))
async function awaitsTheConfiguredValue() {
  const result: number = await calculator.heavyOperation(1, 2)
  return result
}

// Verifying calls
const foo: number = calculator.add(1, 2)
calculator.received().add(1, 2)
calculator.received().isEnabled = true
calculator.received(2).isEnabled = Arg.any()
calculator.received().isEnabled = Arg.is(enabled => enabled)
const readEnabled: boolean = calculator.received(1).isEnabled

// Matching specific arguments
calculator.add(Arg.any(), 2).returns(10)
calculator.received().add(1, Arg.is(x => x < 0))
calculator.add(Arg.is(x => { expectType<number>(x); return x > 0 }), 2).returns(1)

// Generic and inverse matchers
const equalToZero = (x: number) => x === 0
calculator.divide(Arg.any('number'), Arg.is.not(equalToZero)).returns(10)
const argIsNotZero = Arg.is.not(equalToZero)
calculator.received(1).divide(argIsNotZero, argIsNotZero)

// Ignoring all arguments
calculator.add(Arg.all()).returns(10)
calculator.received(2).add(Arg.all())

// Partial mocks
class RealCalculator implements Calculator {
  isEnabled = true
  add(a: number, b: number) { return a + b }
  subtract(a: number, b: number) { return a - b }
  divide(a: number, b: number) { return a / b }
  async heavyOperation(...numbers: number[]) { return numbers.length }
}
const realCalculator = new RealCalculator()
const fakeCalculator = Substitute.for<Calculator>()
fakeCalculator.subtract(Arg.all()).mimicks(realCalculator.subtract)
fakeCalculator.add(Arg.is(x => x < 10), Arg.any()).mimicks(realCalculator.add)
fakeCalculator.add(Arg.is(x => x >= 10), Arg.any()).returns(1337)
fakeCalculator.divide(10, 2).mimicks(realCalculator.divide)
fakeCalculator.divide(Arg.all()).returns(1338)
fakeCalculator.isEnabled.mimicks(() => realCalculator.isEnabled)

// Throwing exceptions
calculator.divide(Arg.any(), 0).throws(new Error('Cannot divide by 0'))
calculator.isEnabled.throws(new Error('not available'))

// Names that conflict with the library
class Example {
  received(someNumber: number) { return someNumber }
}
const fake = Substitute.for<Example>()
fake.received(1337) // the class' own method
fake.received(1).returns(2)
fake[received]().received(1337)
fake[received](1).received(Arg.any())

// Overloaded methods
interface Formatter {
  format(value: number): string
  format(value: Date, pattern: string): string
}
const formatter = Substitute.for<Formatter>()
formatter.format(1).returns('1')
formatter.format(new Date(), 'yyyy').returns('2026')
formatter.format(Arg.any()).returns('any number')
formatter.format(Arg.is(date => date.getFullYear() > 2000), Arg.any()).returns('any recent date')
formatter.format(Arg.all()).returns('anything')
formatter.received(2).format(Arg.all())
formatter.received().format(Arg.is(n => n > 1))

// Generic methods (without explicit type arguments, see limitations.ts)
interface Repository {
  get<T>(id: string): T
  save<T extends { id: string }>(entity: T): T
}
const repository = Substitute.for<Repository>()
repository.get('1').returns({ a: 1 })
repository.save(Arg.any()).returns({ id: '1' })
repository.received().get('1')

// Misuse is still rejected
// @ts-expect-error resolves() is only offered for promises
calculator.add(1, 2).resolves(3)
// @ts-expect-error the configured value must have the member's type
calculator.add(1, 2).returns('3')
// @ts-expect-error returns() needs a value
calculator.add(1, 2).returns()
// @ts-expect-error an assertion cannot be configured
calculator.received().add(1, 2).returns(3)
// @ts-expect-error wrong argument type
calculator.add('1', 2)
// @ts-expect-error the predicate must accept the parameter type
calculator.add(Arg.is((x: string) => x.length > 0), 2)
// @ts-expect-error received() takes a count, not a string
calculator.received('2')
// @ts-expect-error a property assertion with a wrong value type
calculator.received().isEnabled = 'yes'

export { asCalculator, foo, readEnabled, awaitsTheConfiguredValue }
