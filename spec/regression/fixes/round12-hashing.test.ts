import test from 'ava'

import { Substitute } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { assertWithin, millisecondsOf, timeLimit } from '../../helpers/timing'

// Round 12: the cost of failure messages whose lines hold Maps and Sets (fix spec E69, R11V-5). This file runs in the
// serial run of the timing-sensitive files (see ava.config.js).

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

/** The time one failure message takes to build (the best of three, after one to warm up). */
const messageMilliseconds = (check: () => unknown): number => {
  messageOf(check)
  return Math.min(...Array.from({ length: 3 }, () => millisecondsOf(() => messageOf(check))))
}

/** 20 keys, each `{ deep: { deeper: value } }`. */
const leaf = (value: number) => {
  const object: Record<string, unknown> = {}
  for (let key = 0; key < 20; key++) object[`key${key}`] = { deep: { deeper: value } }
  return object
}

test('R11V-5 (E69) a message whose 50 listed calls print alike with 20 arguments holding a Set or a Map takes a few milliseconds', t => {
  // R11V-5's shapes: the data of R10V-1's arguments inside a Set or a Map; they print alike up to four levels deep
  const shapes = {
    Set: (value: number) => ({ s: new Set([{ a: { b: leaf(value) } }]) }),
    Map: (value: number) => ({ s: new Map([['k', { a: { b: leaf(value) } }]]) })
  }
  for (const [kind, argument] of Object.entries(shapes)) {
    const s = Substitute.for<any>()
    for (let index = 0; index < 60; index++) s.f(...Array.from({ length: 20 }, () => argument(0)))
    const expected = Array.from({ length: 20 }, () => argument(1))
    const check = () => s.received(1).f(...expected)
    // printed two levels deep, as before round 10
    const shown = `{ s: ${kind}(1) { ${kind === 'Map' ? "'k' => " : ''}{ a: [Object] } } }`
    t.true(messageOf(check).includes(`› ✘ @Substitute.f(${shown}, ${shown},`), messageOf(check).slice(0, 400))
    // 98a8973: 13 to 19 ms each on an idle machine (each line printed again three and four levels deep); 4b1fa69: 3 to 4 ms
    const limit = timeLimit(10)
    assertWithin(t, messageMilliseconds(check), limit, `one message listing 50 calls with 20 arguments holding a ${kind}`)
  }
})
