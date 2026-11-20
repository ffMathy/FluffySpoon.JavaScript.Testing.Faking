import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

import { Substitute, configure } from '../../../src'

// Round 7, engine A: changed and unreadable arguments, and the call sites (fix spec E18 to E21). Tests that change
// process-wide state (Error.stackTraceLimit, Error itself) run in child processes.

const library = path.resolve(__dirname, '../../../src/index.js')

/** An object with `size` keys, in insertion order. */
const wideObject = (size: number, value: (index: number) => unknown, key: (index: number) => string = index => `k${index}`): Record<string, unknown> => {
  const object: Record<string, unknown> = {}
  for (let index = 0; index < size; index++) object[key(index)] = value(index)
  return object
}

/** A substitute's auto-substitutes are functions; configured values here are strings and numbers. */
const isAutoSubstitute = (value: unknown) => typeof value === 'function'

test.serial('R6-ADV-4 (E18) a wide object that changed after another substitute saw it still matches an equal setup made before or after the change', t => {
  // the code under test fills an index, reports progress on the way (any substitute), then passes it on
  function buildIndex(words: string[], logger: any, search: any) {
    const index: Record<string, boolean> = {}
    for (const word of words) {
      index[word] = true
      if (Object.keys(index).length === 300) logger.debug('index', index)
    }
    return search.load(index)
  }
  const words = Array.from({ length: 500 }, (_, index) => `w${index}`)
  const expected = () => Object.fromEntries(words.map(word => [word, true]))

  // arrange before act: the setup is made with an equal object before the code under test runs (74b8588: no match)
  const search = Substitute.for<any>()
  search.load(expected()).returns(42)
  t.is(buildIndex(words, Substitute.for<any>(), search), 42)

  // the same with a Map that was wide already when it was first passed
  function runBatch(items: string[], progress: any, store: any) {
    const results = new Map<string, number>()
    for (const item of items) {
      results.set(item, item.length)
      if (results.size === 400) progress.report(results)
    }
    return store.save(results)
  }
  const items = Array.from({ length: 1000 }, (_, index) => `item-${index}`)
  const store = Substitute.for<any>()
  store.save(new Map(items.map(item => [item, item.length]))).returns('saved')
  t.is(runBatch(items, Substitute.for<any>(), store), 'saved')

  // a setup made after the change, with an equal copy, and through configure(); and a nested setup
  const logger = Substitute.for<any>()
  const table = wideObject(300, index => index)
  logger.debug(table)
  table.k7 = -7
  table.extra = 'added'
  const sink = Substitute.for<any>()
  sink.write({ ...table }).returns('after')
  t.is(sink.write(table), 'after')
  sink[configure]().write({ ...table }).returns('configured')
  t.is(sink.write(table), 'configured')
  sink.read({ ...table }).body.returns('nested')
  t.is(sink.read(table).body, 'nested')
  // the auto-substitute of a call with the changed object is the one of a call with an equal copy
  t.is(sink.open(table), sink.open({ ...table }))
  // checks compare with live deep equality
  t.notThrows(() => sink.received(2).write({ ...table }))
  t.notThrows(() => logger.received(1).debug(table))
})

/** An entity whose getters throw until it is loaded. */
const lazyUser = () => {
  let loaded = false
  let reads = 0
  const user = {}
  for (const [key, value] of [['id', 1], ['name', 'ann']] as const) {
    Object.defineProperty(user, key, {
      enumerable: true,
      get() {
        reads++
        if (!loaded) throw new Error('not loaded')
        return value
      }
    })
  }
  return { user, load: () => { loaded = true }, reads: () => reads }
}

test.serial('R6V-1 (E18) a value that could not be read while another substitute saw it matches an equal setup once it can be read', t => {
  const logger = Substitute.for<any>()
  const repository = Substitute.for<any>()
  repository.save({ id: 1, name: 'ann' }).returns('saved')
  const { user, load } = lazyUser()
  logger.debug('loading', user)
  load()
  // 74b8588: an auto-substitute, as the unreadable verdict was kept with the value for the rest of the process
  t.is(repository.save(user), 'saved')
  t.is(repository.save([user][0]), 'saved')
  t.notThrows(() => logger.received(1).debug('loading', { id: 1, name: 'ann' }))
  t.notThrows(() => repository.received(2).save({ id: 1, name: 'ann' }))
})

test.serial('R6-ADV-1 (E18) a value whose getter threw once matches an equal setup when it becomes readable, and is read once per comparison', t => {
  const cache = Substitute.for<any>()
  cache.store({ id: 1, name: 'ann' }).returns('stored')
  cache.storeAll([{ id: 1, name: 'ann' }]).returns('stored all')
  const { user, load, reads } = lazyUser()
  t.true(isAutoSubstitute(cache.store(user)))
  t.true(isAutoSubstitute(cache.storeAll([user])))
  // the same value, while it still cannot be read, finds what was recorded for it
  t.is(cache.store(user), cache.store(user))
  // a call reads it once per comparison: with the setup, and with the auto-substitute of the setup's own call (the
  // same value finds its own auto-substitute without reading it)
  const before = reads()
  for (let index = 0; index < 10; index++) cache.store(user)
  t.true(reads() - before <= 20, `${reads() - before} reads for 10 calls`)
  load()
  // 74b8588: still no match, as the value had thrown once
  t.is(cache.store(user), 'stored')
  t.is(cache.storeAll([user]), 'stored all')

  // a setup made once it can be read, after it was passed while it could not
  const late = lazyUser()
  const repository = Substitute.for<any>()
  repository.save(late.user)
  late.load()
  repository.save({ id: 1, name: 'ann' }).returns('saved')
  t.is(repository.save(late.user), 'saved')

  // a failing check compares with every received call, with Node.js's deep equality, which reads such a value about
  // once for each (it stops at the first getter that throws; now and then it reads one twice)
  const other = lazyUser()
  const audit = Substitute.for<any>()
  for (let index = 0; index < 10; index++) audit.log([other.user])
  const beforeCheck = other.reads()
  t.throws(() => audit.received(1).log([{ id: 1, name: 'ann' }]))
  t.true(other.reads() - beforeCheck <= 12, `${other.reads() - beforeCheck} reads for a check against 10 calls`)
})

test.serial('R6V-2 (E20) records that share a wide object, or point back to their wide table, are told apart', t => {
  const config = wideObject(5000, index => index, index => `setting${index}`)
  // still exact: an equal copy finds the same auto-substitute, a record that differs another one
  const sub = Substitute.for<any>()
  const map = () => new Map(Array.from({ length: 300 }, (_, index) => [`s${index}`, { id: index, config }]))
  const first = sub.load(map())
  t.is(sub.load(map()), first)
  const changed = map()
  changed.get('s7')!.id = -7
  t.not(sub.load(changed), first)
})

/** Runs a script with the library in a child process, and returns what it prints as JSON. */
const runScript = (script: string): any => {
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  if (result.status !== 0) throw new Error(`exit code ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

/**
 * Replaces the global Error with a proxy that counts every change of its stackTraceLimit property (assignment,
 * definition, deletion), before the library is loaded: the library reads and lowers the limit through it.
 */
const countLimitChanges = (setup: string) => `
  const RealError = Error
  let changes = 0
  const counted = (key) => { if (key === 'stackTraceLimit') changes++ }
  global.Error = new Proxy(RealError, {
    set(target, key, value) { counted(key); return Reflect.set(target, key, value) },
    defineProperty(target, key, descriptor) { counted(key); return Reflect.defineProperty(target, key, descriptor) },
    deleteProperty(target, key) { counted(key); return Reflect.deleteProperty(target, key) }
  })
  ${setup}
  const before = changes
  const { Substitute, Arg } = require(${JSON.stringify(library)})
`

/** D25 with and without frames: the README's openConnection example (the code under test's call is kept with frames). */
const openConnection = `
  function openConnection(driver) { return driver.connect('db://test') }
  const driver = Substitute.for()
  const connection = openConnection(driver)
  connection.isOpen.returns(true)
  let kept
  try { driver.received(1).connect('db://test'); kept = true } catch { kept = false }
  driver.ping(1)
  let message = ''
  try { driver.received(2).ping(1) } catch (error) { message = error.message }
`

test('R6-ADV-6 (E21) a missing or non-number Error.stackTraceLimit gives no frames, as V8 does, and the library never changes it', t => {
  t.timeout(120_000)
  const shapes: Record<string, string> = {
    'a deleted limit': 'delete RealError.stackTraceLimit',
    'a string limit': `RealError.stackTraceLimit = '10'`,
    'a negative limit': 'RealError.stackTraceLimit = -1',
    'a limit of 0.5': 'RealError.stackTraceLimit = 0.5'
  }
  for (const [name, setup] of Object.entries(shapes)) {
    const result = runScript(`
      ${countLimitChanges(setup)}
      const descriptor = JSON.stringify(Object.getOwnPropertyDescriptor(RealError, 'stackTraceLimit') ?? 'none')
      const s = Substitute.for()
      for (let i = 0; i < 10000; i++) s.f(i)
      const app = Substitute.for()
      for (let i = 0; i < 10000; i++) app.a.b.c.d(i)
      ${openConnection}
      const v8Frames = typeof new RealError('x').stack === 'string' && new RealError('x').stack.includes('\\n')
      console.log(JSON.stringify({
        changes: changes - before, kept, calledAt: /called at/.test(message), v8Frames,
        unchanged: JSON.stringify(Object.getOwnPropertyDescriptor(RealError, 'stackTraceLimit') ?? 'none') === descriptor
      }))
    `)
    // 74b8588: the limit was defined as 1 and deleted again (or assigned and assigned back) around every capture
    t.is(result.changes, 0, name)
    t.true(result.unchanged, name)
    // V8 collects no frames for any error, and neither does the library: no "called at" line, and the code under
    // test's call is retracted by position (adjacency), as with Error.stackTraceLimit = 0
    t.false(result.v8Frames, name)
    t.false(result.calledAt, name)
    t.false(result.kept, name)
  }

  // a limit of at least 1 is lowered for a moment and put back, as before, and keeps the frames
  const result = runScript(`
    ${countLimitChanges('RealError.stackTraceLimit = 10')}
    ${openConnection}
    console.log(JSON.stringify({ kept, calledAt: /called at/.test(message), limit: RealError.stackTraceLimit, changed: changes > before }))
  `)
  t.deepEqual(result, { kept: true, calledAt: true, limit: 10, changed: true })
})

test('R6-ADV-2 (E21) with a frozen Error the library reads no frames, so position decides, while "called at" lines are still shown', t => {
  // pins the behaviour that README describes for a frozen Error (and, before Node.js 20.20, a sealed or non-extensible
  // one, whose missing Error.prepareStackTrace cannot be defined): the README's openConnection example
  const result = runScript(`
    Object.freeze(Error)
    const { Substitute, Arg } = require(${JSON.stringify(library)})
    ${openConnection}
    console.log(JSON.stringify({ kept, calledAt: /called at/.test(message) }))
  `)
  t.deepEqual(result, { kept: false, calledAt: true })
  for (const seal of ['Object.seal(Error)', 'Object.preventExtensions(Error)']) {
    const sealed = runScript(`
      const ownFormatter = Object.prototype.hasOwnProperty.call(Error, 'prepareStackTrace')
      ${seal}
      const { Substitute, Arg } = require(${JSON.stringify(library)})
      ${openConnection}
      console.log(JSON.stringify({ kept, calledAt: /called at/.test(message), ownFormatter }))
    `)
    // Node.js 20.20 and later have an own, writable Error.prepareStackTrace, which can still be swapped for a moment
    t.deepEqual(sealed, { kept: sealed.ownFormatter, calledAt: true, ownFormatter: sealed.ownFormatter }, seal)
  }
})
