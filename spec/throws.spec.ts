import test from 'ava'

import { Substitute, Arg } from '../src/index'

interface Calculator {
  add(a: number, b: number): number
  divide(a: number, b: number): number
  mode: boolean
  fakeSetting: boolean
}

test('throws on a method with arguments', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.divide(Arg.any(), 0).throws(new Error('Cannot divide by 0'))

  t.throws(() => calculator.divide(1, 0), { instanceOf: Error, message: 'Cannot divide by 0' })
})

test('throws on a property being called', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.mode.throws(new Error('Property not set'))

  t.throws(() => calculator.mode, { instanceOf: Error, message: 'Property not set' })
})

test('does not throw on methods that do not match arguments', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.divide(Arg.any(), 0).throws(new Error('Cannot divide by 0'))
  calculator.divide(4, 2).returns(2)

  t.is(2, calculator.divide(4, 2))
  t.throws(() => calculator.divide(1, 0), { instanceOf: Error, message: 'Cannot divide by 0' })
})

test('can set multiple throws for same method with different arguments', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.divide(Arg.any(), 0).throws(new Error('Cannot divide by 0'))
  calculator.divide(Arg.any(), Arg.is(number => !Number.isInteger(number))).throws(new Error('Only integers supported'))

  t.throws(() => calculator.divide(1, 1.135), { instanceOf: Error, message: 'Only integers supported' })
  t.throws(() => calculator.divide(1, 0), { instanceOf: Error, message: 'Cannot divide by 0' })
})
