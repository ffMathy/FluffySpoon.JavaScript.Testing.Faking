import test from 'ava'

import { Substitute } from '../../../src'
import { assertRatiosWithin, millisecondsOf } from '../../helpers/timing'

// Round 14: the cost of failure messages whose calls hold values in another order that matching ignores (fix spec E84,
// R13-ADV-1). This file runs in the serial run of the timing-sensitive files (see ava.config.js).

/** The middle value of `values`. */
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]

/** Runs a check that fails (its message is built), and gives its message. */
const failing = (check: () => unknown): string => {
  try {
    check()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected the check to fail')
}

test('R13-ADV-1 (E84) a failing check whose calls hold a Set, or a Map with object keys, in another order costs about as much as one with a plain object in another order', t => {
  const row = (id: number) => ({ id, name: `n${id}`, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: { h: id } })
  const rows = (reversed: boolean) => {
    const all = Array.from({ length: 20 }, (_, index) => row(index))
    return reversed ? all.reverse() : all
  }
  // the same rows in a Set, in a Map with object keys and in a plain object (E72), in another order in the received
  // calls; each call also differs from the expected one in its second argument, so that the order cannot change the
  // message
  const shapes = {
    Set: (reversed: boolean) => new Set(rows(reversed)),
    Map: (reversed: boolean) => new Map(rows(reversed).map(each => [{ id: each.id }, each])),
    object: (reversed: boolean) => {
      const object: Record<string, unknown> = {}
      for (const each of rows(reversed)) object[`r${each.id}`] = each
      return object
    }
  }
  type Shape = keyof typeof shapes
  const checks = {} as Record<Shape, () => string>
  for (const shape of Object.keys(shapes) as Shape[]) {
    const audit = Substitute.for<any>()
    for (let index = 0; index < 50; index++) audit.record(shapes[shape](true), `batch-${index}`)
    checks[shape] = () => failing(() => audit.received(1).record(shapes[shape](false), 'batch-x'))
  }
  // each line in its own order, two levels deep
  t.true(checks.Set().includes("› ✘ @Substitute.record(Set(20) {\n  {\n    id: 19,\n    name: 'n19',"))
  t.true(checks.Map().includes("› ✘ @Substitute.record(Map(20) {\n  { id: 19 } => {\n    id: 19,"))
  // idle, on Node.js 22 (medians of 7 checks): 53a98bc took 13 to 16 ms for the Set and 16 to 18 ms for the Map,
  // against 3.7 to 3.9 ms for the plain object (3.4x to 4.4x), as it compared each received Set and Map with the expected
  // one in any order, printing the sorted texts of their entries at every depth, although the second argument already
  // differed; caec697 took 4 to 6 ms for each (0.8x to 1.5x); round 14 does not compare them in any order there
  const measure = () => {
    const times = { Set: [] as number[], Map: [] as number[], object: [] as number[] }
    for (let run = 0; run < 8; run++) {
      for (const shape of Object.keys(shapes) as Shape[]) {
        const elapsed = millisecondsOf(() => checks[shape]())
        // (the first run warms up)
        if (run > 0) times[shape].push(elapsed)
      }
    }
    return { Set: median(times.Set) / median(times.object), Map: median(times.Map) / median(times.object) }
  }
  assertRatiosWithin(t, measure, 1.5, 'a failing check with a Set or a Map in another order against one with a plain object in another order')
})
