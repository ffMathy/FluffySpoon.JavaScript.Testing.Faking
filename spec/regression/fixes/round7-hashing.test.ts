import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

// Round 7, engine A: the structural hash, its memos and the call sites (fix spec E18 to E21). Tests that change
// process-wide state (Error.stackTraceLimit, Error itself) run in child processes.

const library = path.resolve(__dirname, '../../../src/index.js')

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
    t.true(result.elapsed < 1000, `${name}: ${result.elapsed} ms`)
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
