import test from 'ava'
import { Substitute, Arg } from '../../src'
import { SubstituteException } from '../../src/SubstituteException'

interface Calculator {
  add(a: number, b: number): number
  multiply(a: number, b?: number): number
  isEnabled: boolean
}

test('calling a method twice correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 1)
  calculator.add(1, 1)

  calculator.received(2).add(1, 1)
  calculator.received().add(1, 1)
  t.throws(() => calculator.received(0).add(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(1).add(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(2).add(1, 0), { instanceOf: SubstituteException })
  t.throws(() => calculator.received().add(1, 0), { instanceOf: SubstituteException })
})

test('calling a method twice correctly asserts the call count each time', t => {
  const calculator = Substitute.for<Calculator>()

  calculator.add(1, 1)
  calculator.received(1).add(1, 1)

  calculator.add(1, 1)
  calculator.received(2).add(1, 1)

  t.throws(() => calculator.received(1).add(1, 1), { instanceOf: SubstituteException })
})

test('calling a method with optional arguments correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.multiply(1)
  calculator.multiply(1, 1)
  calculator.multiply(2, 1)

  calculator.received(1).multiply(1)
  calculator.received(1).multiply(1, 1)
  calculator.received(0).multiply(2)
  calculator.received(1).multiply(2, 1)

  t.throws(() => calculator.received(0).multiply(1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(0).multiply(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(2).multiply(1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(2).multiply(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(1).multiply(2), { instanceOf: SubstituteException })
})

test('getting a property twice correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.isEnabled
  calculator.isEnabled

  calculator.received(2).isEnabled
  calculator.received().isEnabled
  t.throws(() => calculator.received(0).isEnabled, { instanceOf: SubstituteException })
  t.throws(() => calculator.received(1).isEnabled, { instanceOf: SubstituteException })
})

test('setting a property twice correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.isEnabled = true
  calculator.isEnabled = true

  calculator.received(2).isEnabled = true
  calculator.received().isEnabled = true
  t.throws(() => calculator.received(0).isEnabled = true, { instanceOf: SubstituteException })
  t.throws(() => calculator.received(1).isEnabled = true, { instanceOf: SubstituteException })
  t.throws(() => calculator.received(2).isEnabled = false, { instanceOf: SubstituteException })
  t.throws(() => calculator.received().isEnabled = false, { instanceOf: SubstituteException })
})

test('calling a method twice with mock correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 1).returns(2)
  calculator.add(1, 1)
  calculator.add(1, 1)

  calculator.received(2).add(1, 1)
  calculator.received().add(1, 1)
  t.throws(() => calculator.received(0).add(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(1).add(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received(2).add(1, 0), { instanceOf: SubstituteException })
  t.throws(() => calculator.received().add(1, 0), { instanceOf: SubstituteException })
})

test('calling a method with mock based on Arg correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(Arg.all()).returns(0)
  calculator.add(1, 1)

  calculator.received().add(Arg.all())
  calculator.received().add(Arg.any(), Arg.any())
  calculator.received().add(Arg.any('number'), Arg.any('number'))
  calculator.received().add(1, 1)
  t.throws(() => calculator.received().add(1, 0), { instanceOf: SubstituteException })
})

test('getting a property twice with mock correctly asserts the call count', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.isEnabled.returns(true)
  calculator.isEnabled
  calculator.isEnabled

  calculator.received(2).isEnabled
  calculator.received().isEnabled
  t.throws(() => calculator.received(0).isEnabled, { instanceOf: SubstituteException })
  t.throws(() => calculator.received(1).isEnabled, { instanceOf: SubstituteException })
})

test('calling a method with Arg correctly asserts the call count with Arg', t => {
  // #18: receive with arg https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/issues/18
  const calculator = Substitute.for<Calculator>()
  calculator.add(Arg.all())

  calculator.received(1).add(Arg.all())
  calculator.received().add(Arg.all())
  t.throws(() => calculator.received(0).add(1, 1), { instanceOf: SubstituteException })
})

test('calling a method does not interfere with other properties or methods call counts', t => {
  // #51: All functions share the same state https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/issues/51
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 1)

  calculator.received(0).multiply(1, 1)
  calculator.received(0).multiply(Arg.all())
  calculator.received(0).isEnabled

  t.throws(() => calculator.received().multiply(1, 1), { instanceOf: SubstituteException })
  t.throws(() => calculator.received().multiply(Arg.all()), { instanceOf: SubstituteException })
})