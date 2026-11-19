import test from 'ava'

import { Substitute, Arg } from '../../../src'
import { assertRatiosWithin, millisecondsOf } from '../../helpers/timing'

// Round 17: the cost of the look of a matcher (E100) at large arguments (fix spec E109, R16-ADV-2). This file runs in the
// serial run of the timing-sensitive files (see ava.config.js).

/** The middle value of `values`. */
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]

const rows = (count: number, keys = 30) => Array.from({ length: count }, (_, index) => {
  const row: Record<string, number> = {}
  for (let key = 0; key < keys; key++) row[`f${key}`] = index * key
  return row
})

/**
 * Times `runs` runs of each kind by turns (each run gets values made for it beforehand, outside the timing), after a
 * warm-up run, and gives the medians' ratios against `control`.
 */
const ratiosOf = <Kind extends string>(kinds: Record<Kind | 'control', (prepared: unknown) => void>, prepare: () => unknown, runs = 7) => () => {
  const names = Object.keys(kinds) as Array<Kind | 'control'>
  const times = Object.fromEntries(names.map(name => [name, [] as number[]])) as Record<Kind | 'control', number[]>
  for (let run = 0; run <= runs; run++) {
    for (const name of names) {
      const prepared = prepare()
      const elapsed = millisecondsOf(() => kinds[name](prepared))
      // (the first run warms up)
      if (run > 0) times[name].push(elapsed)
    }
  }
  const control = median(times.control)
  const ratios = {} as Record<Kind, number>
  for (const name of names) if (name !== 'control') ratios[name as Kind] = median(times[name]) / control
  return ratios
}

test('R16-ADV-2 (E109) a predicate that drives a callback or reads a substitute it closes over costs as much with a large argument as with a small one', t => {
  // e100walk.js shapes (a) and (b): 300 calls with the same table of 1,000 records of 30 keys (a new table for each
  // run); the control passes a small object. Idle, on Node.js 22 (medians of 7 runs): 8be3a70 walked the whole table
  // on every call, about 2 ms each, 40 to 60 times the control; round 17 walks it once (it then knows that it holds no
  // substitute) and takes about as long as the control
  const calls = 300
  const callback = (table: unknown) => {
    const db = Substitute.for<any>()
    const logger = Substitute.for<any>()
    db.query(Arg.any(), Arg.is((done: any) => { done(null, 1); return true })).returns(undefined)
    for (let index = 0; index < calls; index++) db.query(table, (_error: unknown, count: number) => logger.info('rows', count))
  }
  const closure = (batch: unknown) => {
    const db = Substitute.for<any>()
    const config = Substitute.for<any>()
    config.tenant.returns('t1')
    db.insert(Arg.is((value: any) => value.tenant === config.tenant)).returns(1)
    for (let index = 0; index < calls; index++) db.insert(batch)
  }
  assertRatiosWithin(t, ratiosOf({
    callback: (prepared: any) => callback(prepared.table),
    closure: (prepared: any) => closure(prepared.batch),
    control: () => { callback({ id: 1 }); closure({ tenant: 't1' }) }
  }, () => {
    const table = rows(1000)
    return { table, batch: { tenant: 't1', rows: table } }
  }, 5), 3, 'the same large argument in every call against a small one')
})

test('R16-ADV-2 (E109) a new large table in every call costs no walk of the look when the search for matchers finds only plain records in it', t => {
  // e100walk.js's fresh-array shape: 40 calls, each with a new table of 1,000 records of 30 keys (made beforehand),
  // whose callback logs; the control's callback touches no substitute, so the look asks nothing. Idle, on Node.js 22
  // (medians of 7 runs): 8be3a70 took 1.9 to 2.1 times the control (it walked every table once more); round 17 takes as
  // long as the control (the search for matchers, which every call makes, found that the table holds no substitute)
  const calls = 40
  const run = (tables: unknown[], log: (count: number) => void) => {
    const db = Substitute.for<any>()
    db.query(Arg.any(), Arg.is((done: any) => { done(null, 1); return true })).returns(undefined)
    for (let index = 0; index < calls; index++) db.query(tables[index], (_error: unknown, count: number) => log(count))
  }
  let sum = 0
  assertRatiosWithin(t, ratiosOf({
    logged: (tables: any) => { const logger = Substitute.for<any>(); run(tables, count => logger.info('rows', count)) },
    control: (tables: any) => run(tables, count => { sum += count })
  }, () => Array.from({ length: calls }, () => rows(1000)), 5), 1.4, 'a new table in every call, logged against not logged')
  t.true(sum > 0)
})
