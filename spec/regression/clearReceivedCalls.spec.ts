import test from 'ava'

import { Substitute, SubstituteOf, clearReceivedCalls } from '../../src'
import { SubstituteNode, instance } from '../../src/internals/SubstituteNode'

interface Calculator {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  divide(a: number, b: number): number
  isEnabled: boolean
}

type InstanceReturningSubstitute<T> = SubstituteOf<T> & {
  [instance]: SubstituteNode
}

test('clears received calls on a substitute', t => {
  const calculator = Substitute.for<Calculator>() as InstanceReturningSubstitute<Calculator>
  calculator.add(1, 1)
  calculator.add(1, 1).returns(2)
  calculator[clearReceivedCalls]();

  t.is(calculator[instance].recorder.records.size, 2)
  t.is(calculator[instance].recorder.indexedRecords.size, 2)

  t.throws(() => calculator.received().add(1, 1))
  t.is(2, calculator.add(1, 1))
})
