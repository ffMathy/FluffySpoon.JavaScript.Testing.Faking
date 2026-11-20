import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

import { Substitute, configure } from '../../../src'
import { assertRatiosWithin, assertWithin, timeLimit } from '../../helpers/timing'

// Round 7, engine A: changed and unreadable arguments, and the call sites (fix spec E18 to E21). Tests that change
// process-wide state (Error.stackTraceLimit, Error itself, the families of the hash) run in child processes.

const library = path.resolve(__dirname, '../../../src/index.js')

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}

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

test.serial('R6V-2 (E20) records that share a wide object, or point back to their wide table, do not list it once per record', t => {
  t.timeout(120_000)
  // 74b8588: 1.7 s, 1.8 s and 0.7 s; 45facfb: 5, 10 and 23 ms (Node.js 22)
  const config = wideObject(5000, index => index, index => `setting${index}`)
  const shapes: Array<[string, unknown[]]> = [
    ['10 Maps of 2,000 records sharing one 5,000-key object', Array.from({ length: 10 }, (_, call) => new Map(Array.from({ length: 2000 }, (_, index) => [`s${index}`, { id: call * 100_000 + index, config }])))],
    ['10 Maps of 300 such records', Array.from({ length: 10 }, (_, call) => new Map(Array.from({ length: 300 }, (_, index) => [`s${index}`, { id: call * 100_000 + index, config }])))],
    ['10 tables of 300 such records', Array.from({ length: 10 }, (_, call) => wideObject(300, index => ({ id: call * 100_000 + index, config }), index => `row${index}`))],
    ['10 tables of 1,000 records that point back to their table', Array.from({ length: 10 }, (_, call) => {
      const table: Record<string, unknown> = {}
      for (let index = 0; index < 1000; index++) table[`n${index}`] = { id: call * 100_000 + index, registry: table }
      return table
    })]
  ]
  for (const [name, values] of shapes) {
    const sub = Substitute.for<any>()
    const elapsedLimit = timeLimit(1000)
    const elapsed = millisecondsOf(() => values.forEach(value => sub.load(value)))
    t.log(`${name}: ${elapsed.toFixed(1)} ms`)
    assertWithin(t, elapsed, elapsedLimit, `${name}`)
  }

  // how often their keys are listed (Object.keys and Object.getOwnPropertySymbols each list them)
  let listings = 0
  const counted = <T extends object>(object: T): T => new Proxy(object, { ownKeys: target => { listings++; return Reflect.ownKeys(target) } })
  const shared = counted(wideObject(2000, index => index, index => `setting${index}`))
  const sessions = Substitute.for<any>()
  for (let call = 0; call < 10; call++) sessions.load(new Map(Array.from({ length: 500 }, (_, index) => [`s${index}`, { id: call * 1000 + index, config: shared }])))
  // 74b8588: twice for every record of every call (10,000)
  t.true(listings <= 40, `the shared object was listed ${listings} times`)
  listings = 0
  const registry = Substitute.for<any>()
  for (let call = 0; call < 10; call++) {
    const table: Record<string, unknown> = {}
    for (let index = 0; index < 500; index++) table[`n${index}`] = { id: call * 1000 + index, registry: undefined }
    const proxy = counted(table)
    for (const record of Object.values(table)) (record as any).registry = proxy
    registry.load(proxy)
  }
  // the search for nested matchers and the hash list each table, its records' back-references do not
  t.true(listings <= 60, `the tables were listed ${listings} times`)

  // still exact: an equal copy finds the same auto-substitute, a record that differs another one
  const sub = Substitute.for<any>()
  const map = () => new Map(Array.from({ length: 300 }, (_, index) => [`s${index}`, { id: index, config }]))
  const first = sub.load(map())
  t.is(sub.load(map()), first)
  const changed = map()
  changed.get('s7')!.id = -7
  t.not(sub.load(changed), first)
})

test.serial('R6-ADV-5 (E20) fresh batches of 257 to 1,000 records with nested objects cost about as much per record as 256', t => {
  t.timeout(120_000)
  const row = (index: number) => ({ id: index, name: `n${index}`, address: { city: `c${index % 9}`, zip: { code: index, ext: [1, 2] } }, tags: ['a', 'b'], meta: { created: { at: index, by: { user: 'u' } } } })
  const flatRow = (index: number) => ({ id: index, name: `n${index}`, email: `e${index}`, createdAt: new Date(index) })
  /** One run of `calls` calls with fresh batches of `rows` records (built before the timing): milliseconds per record. */
  const run = (rows: number, calls: number, record: (index: number) => object, seed: number): number => {
    const batches = Array.from({ length: calls }, (_, call) => Array.from({ length: rows }, (_, index) => record((seed * calls + call) * 10_000 + index)))
    const sub = Substitute.for<any>()
    return millisecondsOf(() => batches.forEach(batch => sub.importRows(batch))) / (rows * calls)
  }
  let seed = 0
  const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  // 74b8588: 3.7x (257 rows) to 5x (1,000 rows) for nested records, 1.4x to 1.7x for flat records (the limits leave room
  // for a busy machine)
  for (const [name, record, limit] of [['nested records', row, 1.6], ['flat records with a Date', flatRow, 2]] as const) {
    for (const rows of [257, 300, 1000]) {
      // E29: 256 and `rows` rows by turns (in both orders), and the median of the ratios of seven rounds, so that a busy
      // machine slows both sides of each ratio alike and a round that it slowed on one side does not count. E58: a
      // measurement over the limit is made again (see assertRatiosWithin)
      let cost = Infinity
      const costLimit = timeLimit(1000)
      const measure = () => {
        const ratios: number[] = []
        for (let round = 0; round < 7; round++) {
          const baseFirst = round % 2 === 0
          const before = run(baseFirst ? 256 : rows, 200, record, ++seed)
          const after = run(baseFirst ? rows : 256, 200, record, ++seed)
          const [base, current] = baseFirst ? [before, after] : [after, before]
          ratios.push(current / base)
          cost = Math.min(cost, current)
        }
        return { 'per record': median(ratios) }
      }
      assertRatiosWithin(t, measure, limit, `${name}: ${rows} rows against 256 rows`)
      t.log(`${name}: ${(cost * rows * 1000).toFixed(1)} ms for 1,000 calls with ${rows} rows`)
      // 1,000 calls with fresh batches of 300 records (45facfb: 0.29 s, 74b8588: 1 s for nested records on Node.js 22)
      if (rows <= 300) assertWithin(t, cost * rows * 1000, costLimit, `${name}: 1,000 calls with ${rows} rows`)
    }
  }
})

test('R6V-3 / R6-ADV-3 (E19) families do not slow down small records that share a key with the objects that started them', t => {
  t.timeout(120_000)
  // In child processes, as the families of the hash are kept for the rest of the process. Each loads the library twice,
  // gives one copy 16 families and measures both copies by turns, so that a busy machine slows both; the two processes
  // load the copies in both orders, as a copy loaded later runs a little slower.
  const ratios = (familiesFirst: boolean) => runScript(`
    const loadLibrary = () => {
      for (const key of Object.keys(require.cache)) if (key.startsWith(${JSON.stringify(path.dirname(library))})) delete require.cache[key]
      return require(${JSON.stringify(library)}).Substitute
    }
    const first = loadLibrary()
    const second = loadLibrary()
    if (first === second) throw new Error('the library was loaded once')
    const [withFamilies, plain] = ${familiesFirst} ? [first, second] : [second, first]
    // 16 wide objects with different keys whose first key is 'id', as small records have
    const warm = withFamilies.for()
    for (let family = 0; family < 16; family++) { const object = { id: family }; for (let key = 0; key < 1100; key++) object['f' + family + '_k' + key] = key; warm.load(object) }
    const time = run => { const start = process.hrtime.bigint(); run(); return Number(process.hrtime.bigint() - start) / 1e6 }
    const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]
    let round = 0
    const batches = Substitute => {
      const lists = Array.from({ length: 500 }, (_, call) => Array.from({ length: 100 }, (_, index) => ({ id: ++round, name: 'n' + index, email: 'u' + index + '@x', active: true })))
      const sub = Substitute.for()
      return time(() => { for (const list of lists) sub.saveAll(list) })
    }
    const singles = Substitute => { const sub = Substitute.for(); return time(() => { for (let index = 0; index < 10000; index++) sub.save({ id: ++round, name: 'n', email: 'e', active: true }) }) }
    const times = { plain: { batches: [], singles: [] }, withFamilies: { batches: [], singles: [] } }
    for (let run = 0; run < 15; run++) {
      for (const [name, Substitute] of run % 2 === 0 ? [['plain', plain], ['withFamilies', withFamilies]] : [['withFamilies', withFamilies], ['plain', plain]]) {
        times[name].batches.push(batches(Substitute))
        times[name].singles.push(singles(Substitute))
      }
    }
    // E29: the median of the ratios of the rounds (each round measures both copies, one right after the other)
    const ratio = kind => median(times.withFamilies[kind].map((time, run) => time / times.plain[kind][run]).slice(1))
    console.log(JSON.stringify({ batches: ratio('batches'), singles: ratio('singles') }))
  `)
  const measure = () => {
    const [one, other] = [ratios(true), ratios(false)]
    return { batches: Math.sqrt(one.batches * other.batches), singles: Math.sqrt(one.singles * other.singles) }
  }
  // 74b8588: 3.2x and 1.5x (on an idle machine this takes 0.9x to 1.15x; other tests running at the same time add noise).
  // E58 (R9V-3): a measurement over the limit is made again (see assertRatiosWithin)
  assertRatiosWithin(t, measure, 1.3, 'with 16 families: 500 calls with 100 small records (batches), 10,000 calls with a small record (singles)')
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
    // E43: the script measures in a process of its own; the load factor is measured right before it starts
    const limit = timeLimit(1000)
    const result = runScript(`
      ${countLimitChanges(setup)}
      const descriptor = JSON.stringify(Object.getOwnPropertyDescriptor(RealError, 'stackTraceLimit') ?? 'none')
      const start = process.hrtime.bigint()
      const s = Substitute.for()
      for (let i = 0; i < 10000; i++) s.f(i)
      const app = Substitute.for()
      for (let i = 0; i < 10000; i++) app.a.b.c.d(i)
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6
      ${openConnection}
      const v8Frames = typeof new RealError('x').stack === 'string' && new RealError('x').stack.includes('\\n')
      console.log(JSON.stringify({
        changes: changes - before, elapsed, kept, calledAt: /called at/.test(message), v8Frames,
        unchanged: JSON.stringify(Object.getOwnPropertyDescriptor(RealError, 'stackTraceLimit') ?? 'none') === descriptor
      }))
    `)
    t.log(`${name}: 10,000 calls s.f(i) and 10,000 chains app.a.b.c.d(i) in ${result.elapsed.toFixed(1)} ms`)
    // 74b8588: the limit was defined as 1 and deleted again (or assigned and assigned back) around every capture
    t.is(result.changes, 0, name)
    t.true(result.unchanged, name)
    // V8 collects no frames for any error, and neither does the library: no "called at" line, and the code under
    // test's call is retracted by position (adjacency), as with Error.stackTraceLimit = 0
    t.false(result.v8Frames, name)
    t.false(result.calledAt, name)
    t.false(result.kept, name)
    assertWithin(t, result.elapsed, limit, `${name}: 10,000 calls and 10,000 chains`)
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
