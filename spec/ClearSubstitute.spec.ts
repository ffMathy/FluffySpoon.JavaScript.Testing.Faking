import test from 'ava'

import { Substitute, SubstituteOf } from '../src'
import { SubstituteNode } from '../src/SubstituteNode'

interface Calculator {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  divide(a: number, b: number): number
  isEnabled: boolean
}

type InstanceReturningSubstitute<T> = SubstituteOf<T> & {
  [SubstituteNode.instance]: SubstituteNode
}

test('clears everything on a substitute', t => {
  const calculator = Substitute.for<Calculator>() as InstanceReturningSubstitute<Calculator>
  calculator.add(1, 1)
  calculator.received().add(1, 1)
  calculator.clearSubstitute()

  t.is(calculator[SubstituteNode.instance].recorder.records.size, 0)
  t.is(calculator[SubstituteNode.instance].recorder.indexedRecords.size, 0)

  t.throws(() => calculator.received().add(1, 1))

  // explicitly using 'all'
  calculator.add(1, 1)
  calculator.received().add(1, 1)
  calculator.clearSubstitute('all')

  t.is(calculator[SubstituteNode.instance].recorder.records.size, 0)
  t.is(calculator[SubstituteNode.instance].recorder.indexedRecords.size, 0)

  t.throws(() => calculator.received().add(1, 1))
})

test('clears received calls on a substitute', t => {
  const calculator = Substitute.for<Calculator>() as InstanceReturningSubstitute<Calculator>
  calculator.add(1, 1)
  calculator.add(1, 1).returns(2)
  calculator.clearSubstitute('receivedCalls')

  t.is(calculator[SubstituteNode.instance].recorder.records.size, 2)
  t.is(calculator[SubstituteNode.instance].recorder.indexedRecords.size, 2)

  t.throws(() => calculator.received().add(1, 1))
  t.is(calculator.add(1, 1), 2)
})

test('clears return values on a substitute', t => {
  const calculator = Substitute.for<Calculator>() as InstanceReturningSubstitute<Calculator>
  calculator.add(1, 1)
  calculator.add(1, 1).returns(2)
  calculator.clearSubstitute('substituteValues')

  t.is(calculator[SubstituteNode.instance].recorder.records.size, 2)
  t.is(calculator[SubstituteNode.instance].recorder.indexedRecords.size, 2)

  t.notThrows(() => calculator.received().add(1, 1))
  // @ts-expect-error
  t.true(calculator.add(1, 1)[SubstituteNode.instance] instanceof SubstituteNode)
})