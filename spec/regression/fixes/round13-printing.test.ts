import test from 'ava'
import { inspect } from 'util'

import { Substitute } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 13: how printouts and failure messages print values (fix spec E74, E78, E79), the findings of round 12
// R12-ADV-1, R12V-2 and R12-ADV-2.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of a failing check, without colours and without its "called at" lines. */
const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message).split('\n').filter(line => !/^\s+called at /.test(line)).join('\n')
  }
  throw new Error('expected the assertion to fail')
}

/** The expected-call line and the listed received calls of a message, each on one line. */
const linesOf = (message: string) => {
  const flat = message.replace(/\n\s*/g, ' ')
  const expected = /matching (.*?), but received/.exec(flat)?.[1]
  const received = message.split('\n› ').slice(1).map(line => line.replace(/\n\s*/g, ' ').replace(/^[✔✘] /, '').replace(/ The substitutes are numbered.*$/, '').trim())
  return { expected, received }
}

/** `length` errors without stack traces (they are not printed, and capturing them is slow). */
const errors = (length: number): Error[] => {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    return Array.from({ length }, (_, index) => new Error(`failed ${index}`))
  } finally {
    Error.stackTraceLimit = limit
  }
}

// ---- E74 (R12-ADV-1): long arrays --------------------------------------------------------------------------------

test('R12-ADV-1 (E74) an array of more than 1,000 items whose first items print in a short form prints them without listing its keys', t => {
  // the keys of an array other than its indices are listed only for an array of at most 1,000 items, as listing them
  // lists every index (a million errors cost a listing of a million keys at each print at caec697)
  const rows = (length: number) => Object.assign(errors(length), { total: length })
  const queue = Substitute.for<any>()
  queue.retry(rows(1000))
  queue.retry(rows(1001))
  const printout = plain(String(queue)).replace(/\s+/g, ' ')
  t.true(printout.includes('[Error: failed 19], ... 980 more items, total: 1000 ])'), printout)
  // as 98a8973 printed it
  t.true(printout.includes('[Error: failed 19], ... 981 more items ])'), printout)
  t.false(printout.includes('total: 1001'), printout)
  // an array that prints as it is shows them, as util.inspect does
  const numbers = Object.assign(Array.from({ length: 1001 }, (_, index) => index), { total: 1001 })
  const other = Substitute.for<any>()
  other.retry(numbers)
  t.true(plain(String(other)).replace(/\s+/g, ' ').includes('... 981 more items, total: 1001 ])'), plain(String(other)))
  // and the copy of a long array prints like the array: its first items, and how many more there are
  const million = Substitute.for<any>()
  const shown = errors(20)
  million.retry(Array.from({ length: 1000000 }, (_, index) => shown[index % 20]))
  const lines = linesOf(messageOf(() => million.received(1).retry([])))
  t.is(lines.received[0].replace(/\s+/g, ' '), `@Substitute.retry([ ${Array.from({ length: 20 }, (_, index) => `[Error: failed ${index}]`).join(', ')}, ... 999980 more items ])`)
  t.is(inspect(million.retry(errors(3))), "@Substitute.retry([ [Error: failed 0], [Error: failed 1], [Error: failed 2] ])")
})
