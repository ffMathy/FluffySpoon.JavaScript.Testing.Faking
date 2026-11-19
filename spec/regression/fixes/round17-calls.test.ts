import test from 'ava'

import { Substitute, Arg } from '../../../src'
import { hashSettings } from '../../../src/internals/utilities/ArgumentHash'

// Round 17: the calls-and-arguments part of the round-16 findings (R16-ADV-2, R16FE-5, R16-ADV-8, R16V-1), decided in
// the fix spec as E109, E116, E117 and E118. The timing tests of E109 are in round17-calls-hashing.test.ts (serial run).

/** Runs `run` with the memos of the argument hash, the search for matchers and the look (E109) off. */
const withoutMemos = <T>(run: () => T): T => {
  hashSettings.memos = false
  try {
    return run()
  } finally {
    hashSettings.memos = true
  }
}

const rows = (count: number, keys = 30) => Array.from({ length: count }, (_, index) => {
  const row: Record<string, number> = {}
  for (let key = 0; key < keys; key++) row[`f${key}`] = index * key
  return row
})

// ---- E109 (R16-ADV-2): the look of a matcher does not walk again what holds no substitute ---------------------------

test('R16-ADV-2 (E109) a predicate\'s callback and the substitutes it closes over are recorded on every call, with the same large argument each time', t => {
  // shape (a): a predicate drives the code under test's callback, which logs; a large table is passed to every call
  const table = rows(1000)
  const db = Substitute.for<any>()
  const logger = Substitute.for<any>()
  logger.info(Arg.all()).returns('first', 'second', 'third')
  const logged: unknown[] = []
  db.query(Arg.any(), Arg.is((callback: any) => { callback(null, 1); return true })).returns('done')
  for (let index = 0; index < 4; index++) t.is(db.query(table, (_error: unknown, count: number) => logged.push(logger.info('rows', count))), 'done')
  t.deepEqual(logged, ['first', 'second', 'third', 'third'], 'the callback\'s calls used up the sequence, as at d417925')
  t.notThrows(() => logger.received(4).info('rows', 1))

  // shape (b): a predicate compares with a value of a substitute it closes over
  const config = Substitute.for<any>()
  config.tenant.returns('t1')
  db.insert(Arg.is((batch: any) => batch.tenant === config.tenant)).returns(1)
  const batch = { tenant: 't1', rows: table }
  for (let index = 0; index < 4; index++) t.is(db.insert(batch), 1)
  // ...and with a new wrapper around the same table every time
  for (let index = 0; index < 3; index++) t.is(db.insert({ tenant: 't1', rows: table }), 1)
  t.notThrows(() => config.received(7).tenant)
  // and with a new table every time (which the search for matchers finds to hold no substitute)
  for (let index = 0; index < 3; index++) t.is(db.insert({ tenant: 't1', rows: rows(300) }), 1)
  t.notThrows(() => config.received(10).tenant)
})

test('R16-ADV-2 (E109) substitutes among the arguments are still looked at on every call: in large tables, class instances, Maps and prototypes', t => {
  const item = Substitute.for<any>()
  item.id.returns(7)
  const store = Substitute.for<any>()
  store.put(Arg.is((value: any) => value.list[value.list.length - 1].item.id === 7)).returns('stored')
  // a large plain table with a substitute at its end, passed again and again (never remembered as holding none)
  const table: any[] = rows(600, 3)
  table.push({ item })
  for (let index = 0; index < 3; index++) t.is(store.put({ list: table }), 'stored')
  // a new table every time
  for (let index = 0; index < 3; index++) t.is(store.put({ list: [...rows(400, 3), { item }] }), 'stored')
  // class instances, and a Map, passed again and again
  class Entity { constructor(public id: number, public item?: unknown) { } }
  const entities: any[] = Array.from({ length: 500 }, (_, index) => new Entity(index))
  entities.push(new Entity(500, item))
  for (let index = 0; index < 3; index++) t.is(store.put({ list: entities }), 'stored')
  const byId = new Map(entities.map(entity => [entity.id, entity]))
  store.keep(Arg.is((value: any) => value.get(500).item.id === 7)).returns('kept')
  for (let index = 0; index < 3; index++) t.is(store.keep(byId), 'kept')
  t.notThrows(() => item.didNotReceive().id)

  // an array that inherits from a substitute (the search for matchers does not vouch for it)
  const base = Substitute.for<any>()
  const tagged: any = rows(300, 2)
  Object.setPrototypeOf(tagged, base)
  store.tag(Arg.is((value: any) => value.tag === undefined || true)).returns('tagged')
  for (let index = 0; index < 2; index++) t.is(store.tag(tagged), 'tagged')
  t.notThrows(() => base.didNotReceive().tag)
  void tagged.tag // the code under test's own read is recorded (so the check above means something)
  t.notThrows(() => base.received(1).tag)
})

test('R16-ADV-2 (E109) an object whose prototype is the substitute asked about is still walked: a substitute among its own values is looked at', t => {
  // 8be3a70 stopped at the prototype and never walked the object's own values
  const base = Substitute.for<any>()
  const item = Substitute.for<any>()
  item.id.returns(7)
  const value = Object.create(base)
  value.inner = item
  const store = Substitute.for<any>()
  store.put(Arg.is((v: any) => v.tag !== null && v.inner.id === 7)).returns('stored')
  t.is(store.put(value), 'stored')
  t.notThrows(() => base.didNotReceive().tag)
  t.notThrows(() => item.didNotReceive().id)
})

test('R16-ADV-2 (E109) the arguments that are not walked still count towards the 32,768 items of a look', t => {
  // 32 arrays of 1,023 numbers: 32,768 items and keys, as many as a look lists; the substitute in the next argument is
  // beyond the bound, so the predicate's read of it is recorded, as at 8be3a70 (where the first argument was walked)
  const full: Record<string, number[]> = {}
  for (let key = 0; key < 32; key++) full[`k${key}`] = Array.from({ length: 1023 }, (_, index) => index)
  const owner = Substitute.for<any>()
  owner.name.returns('ann')
  const store = Substitute.for<any>()
  store.put(Arg.any(), Arg.is((value: any) => value.owner.name === 'ann')).returns('stored')
  t.is(store.put(full, { owner }), 'stored')
  t.is(store.put(full, { owner }), 'stored', 'also once the table is remembered')
  t.notThrows(() => owner.received(2).name)
  // with one array less, the substitute is within the bound and looked at
  const fewer = { ...full }
  delete fewer.k31
  const other = Substitute.for<any>()
  other.name.returns('ann')
  t.is(store.put(fewer, { owner: other }), 'stored')
  t.is(store.put(fewer, { owner: other }), 'stored')
  t.notThrows(() => other.didNotReceive().name)
})

test('R16-ADV-2 (E109) documented limitation: a remembered container that gains a substitute later is not looked through (with the memos off, it is)', t => {
  for (const memos of [true, false]) {
    const run = () => {
      const item = Substitute.for<any>()
      item.id.returns(7)
      // (the predicate reads a substitute that it closes over, so that the look walks the arguments on every call)
      const config = Substitute.for<any>()
      config.enabled.returns(true)
      const store = Substitute.for<any>()
      store.put(Arg.is((value: any) => config.enabled && value.list.length > 0 &&
        (value.list[value.list.length - 1].item === undefined || value.list[value.list.length - 1].item.id === 7))).returns('stored')
      // plain records (remembered by the search for matchers) and class instances (remembered by the look)
      class Entity { constructor(public id: number, public item?: unknown) { } }
      const lists = [rows(300, 3) as any[], Array.from({ length: 300 }, (_, index) => new Entity(index)) as any[]]
      for (const list of lists) {
        t.is(store.put({ list }), 'stored')
        t.is(store.put({ list }), 'stored')
        t.is(store.put({ list }), 'stored')
        list.push({ item }) // changed after it was passed (not supported, amended D15)
        t.is(store.put({ list }), 'stored')
      }
      return item
    }
    const item = memos ? run() : withoutMemos(run)
    if (memos) t.notThrows(() => item.received(2).id, 'not looked through: the predicate\'s reads are recorded')
    else t.notThrows(() => item.didNotReceive().id, 'looked through')
  }
})

test('R16-ADV-2 (E109) a proxy among the arguments is walked on every call, never remembered', t => {
  const item = Substitute.for<any>()
  item.id.returns(7)
  let target: any[] = rows(400, 3)
  const list = new Proxy([] as any[], {
    get: (_, key) => Reflect.get(target, key),
    has: (_, key) => Reflect.has(target, key),
    ownKeys: () => Reflect.ownKeys(target),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
    }
  })
  const store = Substitute.for<any>()
  store.put(Arg.is((value: any) => value.list.length > 0)).returns('stored')
  t.is(store.put({ list }), 'stored')
  t.is(store.put({ list }), 'stored')
  target = [...rows(400, 3), { item }]
  store.put(Arg.is((value: any) => value.list[400] === undefined || value.list[400].item.id === 7)).returns('again')
  t.is(store.put({ list }), 'again')
  t.notThrows(() => item.didNotReceive().id)
})

test('R16-ADV-2 (E109) the E100 cases are unchanged: two copies, re-entrancy, runner matchers and checks', t => {
  // a check leaves no trace at all (E95), also with a large argument passed before
  const table = rows(500)
  const db = Substitute.for<any>()
  const logger = Substitute.for<any>()
  db.query(table, (_error: unknown, count: number) => logger.info('rows', count))
  t.notThrows(() => db.received(1).query(Arg.any(), Arg.is((callback: any) => { callback(null, 1); return true })))
  t.notThrows(() => logger.didNotReceive().info(Arg.all()))
  // re-entrancy: a real call from a predicate's callback is matched in a look of its own
  const audit = Substitute.for<any>()
  const user = Substitute.for<any>()
  user.id.returns(5)
  audit.write(Arg.is((entry: any) => entry.user.id === 5)).returns('written')
  db.run(Arg.is((callback: any) => { callback(audit); return true })).returns('ran')
  t.is(db.run((log: any) => log.write({ user, table })), 'ran')
  t.notThrows(() => audit.received(1).write(Arg.any()))
  t.notThrows(() => user.didNotReceive().id)
})
