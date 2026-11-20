import test from 'ava'

import { Substitute } from '../../../src'

// Round 14: failure messages whose calls hold values in another order that matching ignores (fix spec E84, R13-ADV-1).

/** Runs a check that fails (its message is built), and gives its message. */
const failing = (check: () => unknown): string => {
  try {
    check()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('expected the check to fail')
}

test('R13-ADV-1 (E84) a failing check whose calls hold a Set, or a Map with object keys, in another order prints each line in its own order', t => {
  const row = (id: number) => ({ id, name: `n${id}`, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: { h: id } })
  const rows = (reversed: boolean) => {
    const all = Array.from({ length: 20 }, (_, index) => row(index))
    return reversed ? all.reverse() : all
  }
  // the same rows in a Set and in a Map with object keys, in another order in the received calls; each call also differs
  // from the expected one in its second argument, so that the order cannot change the message
  const shapes = {
    Set: (reversed: boolean) => new Set(rows(reversed)),
    Map: (reversed: boolean) => new Map(rows(reversed).map(each => [{ id: each.id }, each]))
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
})
