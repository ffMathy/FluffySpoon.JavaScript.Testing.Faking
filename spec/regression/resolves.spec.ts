import test from 'ava'

import { Substitute, Arg } from '../../src'

interface Calculator {
  getMemory(): Promise<number>
  heavyOperation(...args: number[]): Promise<number>
  model: Promise<string>
}

test('resolves a method with no arguments', async t => {
  const calculator = Substitute.for<Calculator>()
  calculator.getMemory().resolves(0)

  t.is(await calculator.getMemory(), 0)
})

test('resolves a method with arguments', async t => {
  const calculator = Substitute.for<Calculator>()
  calculator.heavyOperation(0, 1, 1, 2, 3, 5, 8).resolves(13)

  t.is(await calculator.heavyOperation(0, 1, 1, 2, 3, 5, 8), 13)
})

test('resolves different values in the specified order on a method', async t => {
  const calculator = Substitute.for<Calculator>()
  calculator.heavyOperation(Arg.any('number')).resolves(1, 2, 3)

  t.is(await calculator.heavyOperation(0), 1)
  t.is(await calculator.heavyOperation(0), 2)
  t.is(await calculator.heavyOperation(0), 3)
  t.is(await calculator.heavyOperation(0), 3) // https://github.com/nsubstitute/NSubstitute/blob/master/tests/NSubstitute.Acceptance.Specs/ReturningResults.cs#L37-L42
})

test('resolves a property', async t => {
  const calculator = Substitute.for<Calculator>()
  calculator.model.resolves('Casio FX-82')

  t.is(await calculator.model, 'Casio FX-82')
})

test('resolves different values in the specified order on a property', async t => {
  const calculator = Substitute.for<Calculator>()
  calculator.model.resolves('Casio FX-82', 'TI-84 Plus')

  t.is(await calculator.model, 'Casio FX-82')
  t.is(await calculator.model, 'TI-84 Plus')
  t.is(await calculator.model, 'TI-84 Plus')
})
