import test from 'ava'
import { inspect } from 'util'

import { Substitute } from '../../../src'

// Round 13: printing long arrays (fix spec E74, R12-ADV-1).

/** An array of `length` items: `item(i)` for the first 20 (the ones that print), the same values again after them. */
const longArray = (length: number, item: (index: number) => unknown): unknown[] => {
  const shown = Array.from({ length: 20 }, (_, index) => item(index))
  return Array.from({ length }, (_, index) => shown[index % 20])
}

test('R12-ADV-1 (E74) a path label with a long array of errors or numbers prints its first items and how many more there are', t => {
  // longer than ARRAY_KEYS_LIMIT (1,000), so that the array's other keys are not listed
  const length = 2000
  const errors = longArray(length, index => new Error(`failed ${index}`))
  const numbers = longArray(length, index => index)
  const labelOf = (items: unknown[]) => inspect(Substitute.for<any>().retry(items))
  // printed as 98a8973 printed them: the first items, then how many more there are (a path is cut after 200 characters)
  t.is(labelOf(errors), '@Substitute.retry([ [Error: failed 0], [Error: failed 1], [Error: failed 2], [Error: failed 3], [Error: failed 4], [Error: failed 5], [Error: failed 6], [Error: failed 7], [Error: failed 8], [Error: failed 9], ... 1990… (13 more characters))')
  t.is(labelOf(numbers), '@Substitute.retry([\n  0, 1, 2, 3, 4,\n  5, 6, 7, 8, 9,\n  ... 1990 more items\n])')
})
