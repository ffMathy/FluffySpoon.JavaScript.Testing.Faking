import test from 'ava'

import { Substitute } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { assertRatiosWithin, millisecondsOf } from '../../helpers/timing'

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

/** The middle value of `values`. */
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]

/** 20 keys, each `{ deep: { deeper: value } }`. */
const leaf = (value: number) => {
  const object: Record<string, unknown> = {}
  for (let key = 0; key < 20; key++) object[`key${key}`] = { deep: { deeper: value } }
  return object
}

test('R11V-5 (E69) a message whose 50 listed calls print alike with 20 arguments holding a Set or a Map costs no more than one whose arguments hold an array', t => {
  // R11V-5's shapes: the data of R10V-1's arguments inside a Set, a Map, or (to compare with) an array; they print alike
  // up to four levels deep
  const shapes = {
    Array: (value: number) => ({ s: [{ a: { b: leaf(value) } }] }),
    Set: (value: number) => ({ s: new Set([{ a: { b: leaf(value) } }]) }),
    Map: (value: number) => ({ s: new Map([['k', { a: { b: leaf(value) } }]]) })
  }
  const checks = {} as Record<keyof typeof shapes, () => unknown>
  for (const [kind, argument] of Object.entries(shapes) as Array<[keyof typeof shapes, (value: number) => unknown]>) {
    const s = Substitute.for<any>()
    for (let index = 0; index < 60; index++) s.f(...Array.from({ length: 20 }, () => argument(0)))
    const expected = Array.from({ length: 20 }, () => argument(1))
    const check = checks[kind] = () => s.received(1).f(...expected)
    // printed two levels deep, as before round 10
    const shown = kind === 'Array' ? '{ s: [ { a: [Object] } ] }' : `{ s: ${kind}(1) { ${kind === 'Map' ? "'k' => " : ''}{ a: [Object] } } }`
    t.true(messageOf(check).includes(`› ✘ @Substitute.f(${shown}, ${shown},`), messageOf(check).slice(0, 400))
  }
  // R12V-3: compared with the same message for arrays, built by turns, so that load slows both alike. Idle, on Node.js
  // 22: 98a8973 took 13 to 19 ms for Sets and Maps (each line printed again three and four levels deep) against about 4
  // ms for arrays (3.3x and 2.7x); 4b1fa69 and round 12 take about as long for all three (0.7x to 1x)
  const measure = () => {
    const times = { Array: [] as number[], Set: [] as number[], Map: [] as number[] }
    for (let run = 0; run < 7; run++) {
      for (const kind of Object.keys(times) as Array<keyof typeof times>) times[kind].push(millisecondsOf(() => messageOf(checks[kind])))
    }
    return { Set: median(times.Set) / median(times.Array), Map: median(times.Map) / median(times.Array) }
  }
  measure() // warm-up
  assertRatiosWithin(t, measure, 1.6, 'a message listing 50 calls with 20 arguments holding a Set or a Map against arrays')
})
