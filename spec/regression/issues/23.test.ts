import test from 'ava'

import { Substitute, Arg, received, mimicks } from '../../../src'

interface CalculatorInterface {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  divide(a: number, b: number): number
  isEnabled: boolean
}

test('issue 23: mimick received should not call method', t => {
  const mockedCalculator = Substitute.for<CalculatorInterface>()

  let calls = 0

  mockedCalculator.add(Arg.all()).mimicks((a, b) => {
    t.deepEqual(++calls, 1, 'mimick called twice')
    return a + b
  })

  mockedCalculator.add(1, 1) // ok

  mockedCalculator.received(1).add(1, 1) // not ok, calls mimick func
})
