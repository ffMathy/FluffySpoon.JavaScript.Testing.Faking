import test from 'ava'
import { Substitute, Arg } from '../../src'
import { SubstituteException } from '../../src/internals/SubstituteException'

interface Calculator {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  divide(a: number, b: number): number
  isEnabled: boolean
}

test('not calling a method correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()

  calculator.didNotReceive().add(1, 1)
  t.throws(() => calculator.received().add(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received().add(Arg.all()), { instanceOf: SubstituteException })
})

test('not getting a property correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()

  calculator.didNotReceive().isEnabled
  t.throws(() => calculator.received(1).isEnabled, { instanceOf: SubstituteException })
  t.throws(() => calculator.received().isEnabled, { instanceOf: SubstituteException })
})

test('not setting a property correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()

  calculator.didNotReceive().isEnabled = true
  t.throws(() => calculator.received(1).isEnabled = true, { instanceOf: SubstituteException })
  t.throws(() => calculator.received().isEnabled = true, { instanceOf: SubstituteException })
})

test('not calling a method with mock correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 1).returns(2)

  calculator.didNotReceive().add(1, 1)
  t.throws(() => calculator.received(1).add(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received().add(Arg.all()), { instanceOf: SubstituteException })
})

test('not getting a property with mock correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.isEnabled.returns(true)

  calculator.didNotReceive().isEnabled
  t.throws(() => calculator.received(1).isEnabled, { instanceOf: SubstituteException })
  t.throws(() => calculator.received().isEnabled, { instanceOf: SubstituteException })
})
