import test from 'ava'
import { inspect } from 'util'

import { Substitute } from '../../../src'
import { assertRatiosWithin, millisecondsOf } from '../../helpers/timing'

// Round 13: the cost of printing long arrays (fix spec E74, R12-ADV-1). This file runs in the serial run of the
// timing-sensitive files (see ava.config.js).

/** The middle value of `values`. */
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]

/** Runs a check that fails (its message is built). */
const fails = (check: () => unknown): void => {
  try {
    check()
  } catch {
    return
  }
  throw new Error('expected the check to fail')
}

/** An array of `length` items: `item(i)` for the first 20 (the ones that print), the same values again after them. */
const longArray = (length: number, item: (index: number) => unknown): unknown[] => {
  const shown = Array.from({ length: 20 }, (_, index) => item(index))
  return Array.from({ length }, (_, index) => shown[index % 20])
}

test('R12-ADV-1 (E74) printing an array of a million errors costs about as much as printing an array of a million numbers', t => {
  const length = 1000000
  // without stack traces: they are not printed, and capturing them is slow
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  let errors: unknown[]
  try {
    errors = longArray(length, index => new Error(`failed ${index}`))
  } finally {
    Error.stackTraceLimit = limit
  }
  const numbers = longArray(length, index => index)
  /** The ways a long array is printed: a printout of the substitute, a failing check's message, a path label (inspect, JSON). */
  const operationsOf = (items: unknown[]) => {
    const queue = Substitute.for<any>()
    const result = queue.retry(items)
    return {
      String: () => String(queue),
      check: () => fails(() => queue.received(1).retry([])),
      inspect: () => inspect(result),
      JSON: () => JSON.stringify({ result })
    }
  }
  const operations = { errors: operationsOf(errors), numbers: operationsOf(numbers) }
  // printed as 98a8973 printed them: the first items, then how many more there are (a path is cut after 200 characters)
  t.is(operations.errors.inspect(), '@Substitute.retry([ [Error: failed 0], [Error: failed 1], [Error: failed 2], [Error: failed 3], [Error: failed 4], [Error: failed 5], [Error: failed 6], [Error: failed 7], [Error: failed 8], [Error: failed 9], ... 9999… (15 more characters))')
  t.is(operations.numbers.inspect(), '@Substitute.retry([\n  0, 1, 2, 3, 4,\n  5, 6, 7, 8, 9,\n  ... 999990 more items\n])')
  type Operation = keyof typeof operations.errors
  // idle, on Node.js 22 (medians of 5 prints): caec697 took 76 ms (String), 105 ms (check), 74 ms (inspect) and 79 ms
  // (JSON) for errors, as it listed the million keys of the array at each print, against 4 to 6 ms for numbers (11x to
  // 30x in this test); 98a8973 took 3 to 5 ms for both (it allocated a copy of a million items at each print); round 13
  // takes 0.02 to 0.4 ms for both (1.2x to 2x)
  const measure = () => {
    const times = { errors: {} as Record<Operation, number[]>, numbers: {} as Record<Operation, number[]> }
    for (let run = 0; run < 6; run++) {
      for (const kind of ['errors', 'numbers'] as const) {
        for (const operation of Object.keys(operations[kind]) as Operation[]) {
          const elapsed = millisecondsOf(() => {
            for (let print = 0; print < 5; print++) operations[kind][operation]()
          })
          // (the first run warms up)
          if (run > 0) (times[kind][operation] = times[kind][operation] ?? []).push(elapsed)
        }
      }
    }
    const ratios = {} as Record<Operation, number>
    for (const operation of Object.keys(times.errors) as Operation[]) ratios[operation] = median(times.errors[operation]) / median(times.numbers[operation])
    return ratios
  }
  assertRatiosWithin(t, measure, 8, 'printing an array of a million errors against one of a million numbers')
})
