import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

// Round 6: the runtime findings of the round-5 verification about call sites (R5V-3, R5-ADV-2), decided in the fix
// spec as E15 and E16. Both change process-wide state (Error.stackTraceLimit, a debugger), so they run in child
// processes.

const library = path.resolve(__dirname, '../../../src/index.js')

/** Runs a script with the library in a child process, and returns what it prints as JSON. */
const runScript = (script: string): any => {
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  if (result.status !== 0) throw new Error(`exit code ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

/** An ordinary arrange/act/assert sequence with setups, chains and assertions. */
const ordinaryTest = `
  const { Substitute, Arg } = require(${JSON.stringify(library)})
  const app = Substitute.for()
  app.config.get('timeout').returns(30)
  app.repo.users.find(Arg.any()).returns({ id: 1 })
  function sut(a) { const t = a.config.get('timeout'); const u = a.repo.users.find(1); a.logger.info('loaded', u, t); return u }
  const user = sut(app)
  app.logger.received(1).info('loaded', { id: 1 }, 30)
  app.repo.users.received(1).find(1)
`

/** A failing assertion after ordinaryTest: its message, with the call site of the call. */
const failure = `
  let message = ''
  try { app.logger.received(2).info('loaded', { id: 1 }, 30) } catch (error) { message = error.message }
  const outcome = { user, calledAt: /called at .*\\[eval\\]/.test(message), message: message.split('\\n')[0] }
`

test('R5V-3 (E15) a read-only, getter-only, frozen or missing Error.stackTraceLimit does not break the library and is left as it was', t => {
  const shapes: Record<string, string> = {
    'a read-only value': `Object.defineProperty(Error, 'stackTraceLimit', { value: 10, writable: false, configurable: true })`,
    'a getter-only accessor': `Object.defineProperty(Error, 'stackTraceLimit', { get() { return 10 }, configurable: true })`,
    'Object.freeze(Error)': 'Object.freeze(Error)',
    'a deleted property': 'delete Error.stackTraceLimit',
    'a deleted property on a frozen Error': 'delete Error.stackTraceLimit; Object.freeze(Error)',
    'an accessor that keeps what it is given': `
      let limit = 10
      Object.defineProperty(Error, 'stackTraceLimit', { get() { return limit }, set(value) { limit = value }, configurable: true })`
  }
  for (const [name, setup] of Object.entries(shapes)) {
    const result = runScript(`
      ${setup}
      const descriptor = () => JSON.stringify(Object.getOwnPropertyDescriptor(Error, 'stackTraceLimit') ?? 'none')
      const before = descriptor()
      const limitBefore = Error.stackTraceLimit
      ${ordinaryTest}
      ${failure}
      console.log(JSON.stringify({ ...outcome, unchanged: descriptor() === before, limit: Error.stackTraceLimit === limitBefore,
        own: Object.prototype.hasOwnProperty.call(Error, 'stackTraceLimit') }))
    `)
    const deleted = name.startsWith('a deleted property')
    // V8 only takes a data property as the limit: with an accessor it collects no frames for any error, and neither
    // for the library. E21 (round 7): neither does it with a missing limit, so the library captures none then either
    // (until round 6 it defined the limit as 1 for a moment, where it could).
    const withFrames = !(name.includes('accessor') || deleted)
    t.deepEqual(result, {
      user: { id: 1 },
      calledAt: withFrames,
      message: result.message,
      unchanged: true,
      limit: true,
      own: !deleted
    }, name)
    t.is(result.message, 'Call count mismatch in @Substitute.logger.info:', name)
  }
})

/**
 * The script with a debugger that pauses on every exception, caught or not, attached: prints how often, and where, it
 * paused while the script ran.
 */
const withDebugger = (setup: string, script: string) => `
  const inspector = require('inspector')
  const session = new inspector.Session()
  session.connect()
  const pauses = []
  session.on('Debugger.paused', ({ params }) => {
    const top = params.callFrames[0]
    pauses.push(top.functionName + ' ' + top.url.replace(/.*[\\\\/]/, '') + ':' + (top.location.lineNumber + 1))
    session.post('Debugger.resume')
  })
  ${setup}
  session.post('Debugger.enable')
  session.post('Debugger.setPauseOnExceptions', { state: 'all' })
  ${script}
  session.post('Debugger.setPauseOnExceptions', { state: 'none' })
  ${failure}
  console.log(JSON.stringify({ ...outcome, pauses, formatter: typeof Error.prepareStackTrace === 'function' }))
`

test('R5-ADV-2 (E16) an ordinary test throws no exception inside the library when Error.prepareStackTrace holds a formatter', t => {
  const setups: Record<string, string> = {
    // Node.js 20.20 and later
    "Node.js's own formatter": '',
    // source-map-support installs a data property
    'an installed formatter': `Error.prepareStackTrace = (error, frames) => String(error) + frames.map(frame => '\\n    at ' + frame).join('')`,
    // E15: a limit that cannot be lowered is found out without a failed assignment
    'a read-only Error.stackTraceLimit': `Object.defineProperty(Error, 'stackTraceLimit', { value: 10, writable: false, configurable: true })`,
    'a getter-only Error.stackTraceLimit': `Object.defineProperty(Error, 'stackTraceLimit', { get() { return 10 }, configurable: true })`,
    'Object.freeze(Error)': `Object.freeze(Error)`
  }
  for (const [name, setup] of Object.entries(setups)) {
    const result = runScript(withDebugger(setup, ordinaryTest))
    if (!result.formatter) {
      // Node.js before 20.20 without an installed formatter: the frames are still read by a formatting that throws
      t.log(`${name}: no formatter in ${process.version}, ${result.pauses.length} pauses`)
      continue
    }
    // 45facfb: 40 pauses, two for every step of a chain (CallSite.js, peekFirstFrame and readFirstFrame)
    t.deepEqual(result.pauses, [], name)
    // V8 collects no frames at all while the limit is an accessor (see R5V-3)
    t.deepEqual({ user: result.user, calledAt: result.calledAt }, { user: { id: 1 }, calledAt: !name.includes('getter-only') }, name)
  }
  t.pass()
})

test('R5-ADV-2 (E16) a call site whose frame was read without throwing keeps exactly the text it would have had', t => {
  // two captures at the same position: the frame of the first one is read (its call site is kept, E16), the second
  // one is formatted by V8 as usual; the texts must be the same, and so must the frames, with any formatter
  const callSites = path.resolve(__dirname, '../../../src/internals/CallSite.js')
  const script = (setup: string) => `
    ${setup}
    const { captureStack, frameOfStack, stackText } = require(${JSON.stringify(callSites)})
    function operation() { return captureStack(operation) }
    function userCode() {
      const holders = []
      for (let index = 0; index < 2; index++) holders.push(operation())
      return holders
    }
    const [read, unread] = userCode()
    const frame = frameOfStack(read)
    const again = frameOfStack(unread) && frameOfStack(read)
    const text = stackText(read)
    console.log(JSON.stringify({ sameFrame: JSON.stringify(frame) === JSON.stringify(again), identical: text === stackText(unread),
      userCode: / at userCode /.test(text), formatter: typeof Error.prepareStackTrace }))
  `
  const formatter = `(error, frames) => 'formatted ' + error + frames.map(frame => '\\n    at ' + frame).join('')`
  const setups: Record<string, string> = {
    "Node.js's own formatter": '',
    'an installed formatter': `Error.prepareStackTrace = ${formatter}`,
    'an accessor as stack-chain installs it': `
      let current = ${formatter}
      Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, get: () => (error, frames) => current(error, frames), set: value => { current = value } })`,
    // several frames (E15): the call sites are kept together
    'a read-only Error.stackTraceLimit': `Error.prepareStackTrace = ${formatter}; Object.defineProperty(Error, 'stackTraceLimit', { value: 10, writable: false, configurable: true })`
  }
  for (const [name, setup] of Object.entries(setups)) {
    const result = runScript(script(setup))
    if (result.formatter !== 'function') {
      t.log(`${name}: no formatter in ${process.version}`)
      continue
    }
    t.deepEqual(result, { sameFrame: true, identical: true, userCode: true, formatter: 'function' }, name)
  }
})
