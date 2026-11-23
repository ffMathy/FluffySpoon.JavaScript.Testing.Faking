import test, { ExecutionContext } from 'ava'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 17: the calls-and-arguments part of the round-16 findings (R16-ADV-2, R16FE-5, R16-ADV-8, R16V-1), decided in
// the fix spec as E109, E116, E117 and E118.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of the SubstituteException that `check` throws (failing the test if it throws none or another error). */
const failureOf = (t: ExecutionContext, check: () => void, label?: string): string => {
  try {
    check()
  } catch (error) {
    if (error instanceof SubstituteException) return plain(error.message)
    throw error
  }
  t.fail(`the check passed, but it should have failed${label === undefined ? '' : `: ${label}`}`)
  return ''
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
  // and with a new table every time
  for (let index = 0; index < 3; index++) t.is(db.insert({ tenant: 't1', rows: rows(300) }), 1)
  t.notThrows(() => config.received(10).tenant)
})

test('R16-ADV-2 (E109) substitutes among the arguments are still looked at on every call: in large tables, class instances, Maps and prototypes', t => {
  const item = Substitute.for<any>()
  item.id.returns(7)
  const store = Substitute.for<any>()
  store.put(Arg.is((value: any) => value.list[value.list.length - 1].item.id === 7)).returns('stored')
  // a large plain table with a substitute at its end, passed again and again
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

  // an array that inherits from a substitute
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

test('R16-ADV-2 (E109) a container that gains a substitute after it was passed is looked through', t => {
  const item = Substitute.for<any>()
  item.id.returns(7)
  // (the predicate reads a substitute that it closes over, so that the look walks the arguments on every call)
  const config = Substitute.for<any>()
  config.enabled.returns(true)
  const store = Substitute.for<any>()
  store.put(Arg.is((value: any) => config.enabled && value.list.length > 0 &&
    (value.list[value.list.length - 1].item === undefined || value.list[value.list.length - 1].item.id === 7))).returns('stored')
  // plain records and class instances
  class Entity { constructor(public id: number, public item?: unknown) { } }
  const lists = [rows(300, 3) as any[], Array.from({ length: 300 }, (_, index) => new Entity(index)) as any[]]
  for (const list of lists) {
    t.is(store.put({ list }), 'stored')
    t.is(store.put({ list }), 'stored')
    t.is(store.put({ list }), 'stored')
    list.push({ item }) // changed after it was passed (not supported, amended D15)
    t.is(store.put({ list }), 'stored')
  }
  t.notThrows(() => item.didNotReceive().id, 'looked through')
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

// ---- E117 (R16-ADV-8): an async predicate nested in an object or array is a usage error -----------------------------

const asyncUsage = { instanceOf: TypeError, message: /returned a promise \(or another thenable\), but an Arg\.is predicate must return whether the value matches synchronously/ }

test('R16-ADV-8 (E117) an async Arg.is predicate inside an object or an array throws the documented TypeError, as at the top level', async t => {
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => { rejections.push(reason) }
  process.on('unhandledRejection', onRejection)
  try {
    // in the call of the code under test that a setup with it is compared with
    const repo = Substitute.for<any>()
    repo.save({ id: Arg.is((async () => true) as any) }).returns(1)
    t.throws(() => repo.save({ id: 1 }), asyncUsage)
    repo.list([Arg.is((async () => true) as any)]).returns(2)
    t.throws(() => repo.list([1]), asyncUsage)
    repo.deep({ a: [{ b: Arg.is((async (value: any) => (await Promise.resolve(value)).missing.field) as any) }] }).returns(3)
    t.throws(() => repo.deep({ a: [{ b: 1 }] }), asyncUsage)
    // in checks, of any form
    const service = Substitute.for<any>()
    service.save({ id: 1 })
    service.list([1, 2])
    t.throws(() => service.received(1).save({ id: Arg.is((async () => true) as any) }), asyncUsage)
    t.throws(() => service.didNotReceive().save({ id: Arg.is((async () => false) as any) }), asyncUsage)
    t.throws(() => service[received](1).list([1, Arg.is((async () => true) as any)]), asyncUsage)
    t.throws(() => service[didNotReceive]().list([Arg.is((async () => true) as any), Arg.all()]), asyncUsage)
    await new Promise(resolve => setTimeout(resolve, 20))
    t.deepEqual(rejections, [], 'the rejected promises were handled')
  } finally {
    process.removeListener('unhandledRejection', onRejection)
  }
})

test('R16-ADV-8 (E117) a nested predicate that throws is still a non-match, and a throwing getter of the value is read as often as before (E102)', t => {
  const repo = Substitute.for<any>()
  repo.save({ id: Arg.is(() => { throw new Error('boom') }) }).returns(1)
  t.not(repo.save({ id: 1 }), 1)
  const message = failureOf(t, () => repo.received(1).save({ id: Arg.is(() => { throw new Error('boom') }) }))
  t.true(message.includes('boom'), message)
  let reads = 0
  const value = { get id() { reads++; throw new Error('not loaded') } }
  const other = Substitute.for<any>()
  other.load({ id: Arg.any() }).returns('loaded')
  t.not(other.load(value), 'loaded')
  t.is(reads, 1, 'once, by the comparison with the setup (E102)')
})

// ---- E118 (R16V-1): a revoked function proxy is not one of the library's proxies -----------------------------------

test('R16V-1 (E118) a revoked function proxy as a configured answer, an argument or a member value never crashes', t => {
  const { proxy: connection, revoke } = Proxy.revocable(function connection() { }, {})
  const pool = Substitute.for<any>()
  pool.acquire().returns(connection)
  t.is(pool.acquire(), connection)
  revoke()
  t.is(pool.acquire(), connection, 'a configured answer is handed back as it is')
  const loader = Substitute.for<any>()
  loader.load(Arg.any()).returns(connection)
  t.is(loader.load(1), connection)
  loader.find(1).returns(connection)
  t.is(loader.find(1), connection)
  loader.current.returns(connection)
  t.is(loader.current, connection)
  loader.make(Arg.any()).mimicks(() => connection)
  t.is(loader.make(1), connection)
  const instance = Substitute.for<any>()
  instance[mimick]({ connection })
  t.notThrows(() => instance.connection)
  t.notThrows(() => instance.received(1).connection)
  // as an argument: recorded and matched by identity (E14)
  const sink = Substitute.for<any>()
  sink.release(connection)
  t.notThrows(() => sink.received(1).release(connection))
  t.notThrows(() => sink.didNotReceive().release(function connection() { }))
  sink.close(connection).returns('closed')
  t.is(sink.close(connection), 'closed')
  // checks through a call with matchers and printing
  t.notThrows(() => loader.received(1).load(1))
  t.notThrows(() => String(pool))
  t.notThrows(() => String(sink))
  t.true(failureOf(t, () => sink.received(2).release(connection)).includes('release'))
})

// ---- E116 (R16FE-5): the steps before a check view belong to the check opened in their expression ------------------

/** A socket.io-like server where every room answers one shared substitute (a nested setup through a call with matchers). */
const sharedRooms = () => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  io.to('room-a').emit('message', 'hi') // the code under test: only room-a
  return io
}

test('R16FE-5 (E116) a check view opened in a helper and completed by the caller records nothing of the steps before it, and E99 narrows as inline', t => {
  // test-utils helpers that return a check for the caller to complete
  const sentTo = (io: any, room: string) => io.to(room).received(1)
  const notSentTo = (io: any, room: string) => io.to(room).didNotReceive()
  const sentAnyTo = (io: any, room: string) => io.to(room).received()
  const countedTo = (io: any, room: string, count: number) => io.to(room).received(count)
  for (const io of [sharedRooms(), sharedRooms()]) {
    failureOf(t, () => sentTo(io, 'room-b').emit('message', Arg.any()), 'nothing was emitted to room-b')
    t.notThrows(() => notSentTo(io, 'room-b').emit('message', Arg.any()))
    failureOf(t, () => sentAnyTo(io, 'room-b').emit('message', Arg.any()))
    t.notThrows(() => countedTo(io, 'room-b', 0).emit('message', Arg.any()))
    t.notThrows(() => sentTo(io, 'room-a').emit('message', Arg.any()))
    // no phantom calls of to() or received()
    t.notThrows(() => io.didNotReceive().to('room-b'))
    t.notThrows(() => io.received(1).to(Arg.any()))
    t.notThrows(() => io.to('room-a').didNotReceive().received(Arg.all()))
  }
  // an IIFE in the test, and nested helpers
  const io = sharedRooms()
  failureOf(t, () => (() => io.to('room-b').received(1))().emit('message', Arg.any()))
  t.notThrows(() => (() => io.to('room-b').didNotReceive())().emit('message', Arg.any()))
  const inner = (s: any, room: string) => s.to(room).received(1)
  const outer = (s: any, room: string) => inner(s, room)
  failureOf(t, () => outer(io, 'room-b').emit('message', Arg.any()))
  t.notThrows(() => io.didNotReceive().to('room-b'))
  t.notThrows(() => io.received(1).to(Arg.any()))
})

test('R16FE-5 (E116) helpers returning a check of a call result, a nested member, a property, an assignment and a direct call', t => {
  const api = Substitute.for<any>()
  api.getUser(1).save() // the code under test
  const userCheck = (s: any, id: number) => s.getUser(id).received(1)
  t.notThrows(() => userCheck(api, 1).save())
  failureOf(t, () => userCheck(api, 2).save())
  t.notThrows(() => api.received(1).getUser(1))
  t.notThrows(() => api.didNotReceive().getUser(2))

  const app = Substitute.for<any>()
  app.logger.info('x')
  void app.logger.level
  app.options.port = 8080
  const loggerCheck = (s: any) => s.logger.received(1)
  t.notThrows(() => loggerCheck(app).info('x'))
  t.notThrows(() => loggerCheck(app).level)
  const optionsCheck = (s: any) => s.options.received(1)
  t.notThrows(() => { optionsCheck(app).port = 8080 })
  t.notThrows(() => app.received(2).logger)
  t.notThrows(() => app.received(1).options)

  const factory = Substitute.for<any>()
  factory.make('job')('run')
  const madeCheck = (s: any) => s.make('job').received(1)
  t.notThrows(() => madeCheck(factory)('run'))
  t.notThrows(() => factory.received(1).make('job'))

  // the symbol forms decide where they are opened already: unchanged
  const symbolCheck = (s: any, id: number) => s.getUser(id)[received](1)
  t.notThrows(() => symbolCheck(api, 1).save())
  t.notThrows(() => api.received(1).getUser(1))
  const symbolNotCheck = (s: any, id: number) => s.getUser(id)[didNotReceive]()
  t.notThrows(() => symbolNotCheck(api, 3).save())
  t.notThrows(() => api.didNotReceive().getUser(3))
})

test('R16FE-5 (E116) stored handles and handles checked in a callback keep their calls; a stored view belongs to its opening wherever it is completed', t => {
  // a handle that the test stores and checks after other uses of substitutes counts every call of the shared substitute
  const io = sharedRooms()
  const roomB = io.to('room-b')
  const other = Substitute.for<any>()
  other.ping()
  t.notThrows(() => roomB.received(1).emit('message', Arg.any()), 'counts the emit of room-a')
  t.notThrows(() => io.received(1).to('room-b'), 'the stored handle\'s call is recorded')

  // README: a handle got in the test and checked in a callback keeps the reads that produced it
  const app = Substitute.for<any>()
  app.handlers.click.fire()
  const click = app.handlers.click
  t.notThrows(() => click.received(1).fire())
  failureOf(t, () => app.didNotReceive().handlers)

  // a view opened in one statement and completed in the next, or in a callback (8be3a70 kept the read of logger for the
  // latter, as the use decided)
  const service = Substitute.for<any>()
  service.logger.info('x')
  const view = service.logger.received(1)
  view.info('x')
  const later = service.logger.received(1)
  t.notThrows(() => later.info('x'))
  t.notThrows(() => service.received(1).logger)
  // a view stored while other substitutes are used, then completed: no phantom call of received
  const repo = Substitute.for<any>()
  repo.find(1).save()
  const stored = repo.find(1).received(1)
  other.ping()
  t.notThrows(() => stored.save())
  t.notThrows(() => repo.received(1).find(1))
  t.notThrows(() => repo.find(1).didNotReceive().received(Arg.all()))

  // Error.stackTraceLimit = 0: adjacency decides, also for a helper
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    const rooms = sharedRooms()
    const sentTo = (s: any, room: string) => s.to(room).received(1)
    failureOf(t, () => sentTo(rooms, 'room-b').emit('message', Arg.any()))
    t.notThrows(() => rooms.didNotReceive().to('room-b'))
  } finally {
    Error.stackTraceLimit = limit
  }
})

test('R16FE-5 (E116) a check view that a helper returns and nothing completes is still reported (E48), once per view (E56)', t => {
  const clock = interceptDeferredReports()
  try {
    const api = Substitute.for<any>()
    api.getUser(1).save() // the code under test
    const userCheck = (s: any, id: number) => s.getUser(id).received(1)
    userCheck(api, 1) // nothing follows
    userCheck(api, 1).save() // a complete check of the same form does not hide the report above
    const reports = clock.run().map(error => plain((error as Error).message))
    t.is(reports.length, 1, reports.join('\n'))
    t.true(reports[0].startsWith('@Substitute.getUser(1).received(1) checked nothing'), reports[0])
  } finally {
    clock.uninstall()
  }
})
