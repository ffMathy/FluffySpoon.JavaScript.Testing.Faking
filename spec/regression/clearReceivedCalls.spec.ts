import test from 'ava'

import { Substitute, clearReceivedCalls } from '../../src'

interface Calculator {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  divide(a: number, b: number): number
  isEnabled: boolean
}

test('clears received calls on a substitute', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 1)
  calculator.add(1, 1).returns(2)
  calculator[clearReceivedCalls]();

  t.notThrows(() => calculator.didNotReceive().add(1, 1))
  t.throws(() => calculator.received().add(1, 1))
  t.is(2, calculator.add(1, 1))
})
