import test from 'ava'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { inspect } from 'util'

import { Substitute, didNotReceive, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 4: the runtime findings of the round-3 verification (R3-*), decided in the fix spec as E1-E7.

const library = path.resolve(__dirname, '../../../src/index.js')

/** Runs a script with the library in a child process, and returns what it prints as JSON. */
const runScript = (script: string, options: { args?: string[], env?: Record<string, string> } = {}): any => {
  const result = spawnSync(process.execPath, [...(options.args ?? []), '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...options.env }
  })
  if (result.status !== 0) throw new Error(`exit code ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message)
  }
  throw new Error('expected the assertion to fail')
}

// ---- code under test for E1 and E2, in functions of its own (as in a module under test) ----

class UserService {
  constructor(private readonly fetchUser: (id: number) => any) { }
  load(id: number) { return this.fetchUser(id) }
}

function openWith(connect: (url: string) => any) {
  return connect('db://x')
}

const loadUser = (getUser: (id: number) => any, id: number) => Promise.resolve(id).then(getUser)

test('R3-ADV-1 (E1) a method reference that the code under test invokes later is a call made where it is invoked', t => {
  const api = Substitute.for<any>()
  const service = new UserService(api.getUser) // the test passes a method reference
  const user = service.load(1) // the code under test calls api.getUser(1)
  user.name.returns('ann') // the test configures the value it got back
  t.is(user.name, 'ann')
  t.notThrows(() => api.received(1).getUser(1))
  t.throws(() => api.didNotReceive().getUser(1), { instanceOf: SubstituteException })
  // the call site of the call is the invocation in UserService.load, not the read in the test
  const message = messageOf(() => api.received(2).getUser(1))
  t.regex(message, /› ✔ @Substitute\.getUser\(1\)\n {4}called at UserService\.load /)

  const driver = Substitute.for<any>()
  const connection = openWith(driver.connect)
  connection.isOpen.returns(true)
  t.true(connection.isOpen)
  t.notThrows(() => driver.received(1).connect('db://x'))
  t.throws(() => driver.didNotReceive().connect('db://x'), { instanceOf: SubstituteException })
  t.regex(messageOf(() => driver.received(2).connect('db://x')), /called at openWith /)

  // a method read and invoked in one expression is still one expression: a setup retracts all of it
  const app = Substitute.for<any>()
  app.getCalc().add(1, 2).returns(3)
  app.logger.child('x').info.returns(undefined)
  // E24 (round 7): the root also shows the setups of its auto-substitutes, under their paths; nothing is recorded
  t.is(inspect(app), "@Substitute {\n  configured:\n    getCalc().add(1, 2) => returns(3)\n    logger.child('x').info => returns(undefined)\n}")
  t.is(app.getCalc().add(1, 2), 3)
  // and a method reference invoked in the test, with another `this`, is a call as well
  const getCalc = app.getCalc
  getCalc().add(5, 5).returns(10)
  t.is(app.getCalc().add(5, 5), 10)
})

test('R3-ADV-6 (E2) a call made from a promise job stays recorded when the test then configures what it returned', async t => {
  const getUser = Substitute.for<any>()
  const user = await loadUser(getUser, 1) // getUser(1) is invoked by a promise job: no frame of its own
  user.name.returns('ann')
  t.is(user.name, 'ann')
  t.notThrows(() => getUser[received](1)(1))
  t.throws(() => getUser[didNotReceive]()(1), { instanceOf: SubstituteException })

  // the same for a method of a substitute
  const api = Substitute.for<any>()
  const loaded: any = await Promise.resolve(2).then(api.fetch)
  loaded.status.returns(200)
  t.notThrows(() => api.received(1).fetch(2))
})

test('R3-ADV-6 (E2) adjacency alone decides only when neither operation has a frame', t => {
  const result = runScript(`
    const { Substitute } = require(${JSON.stringify(library)})
    const { inspect } = require('util')
    function getConnection(driver) { return driver.connect('db://x') }
    Error.stackTraceLimit = 0
    const driver = Substitute.for()
    const connection = getConnection(driver)
    connection.isOpen.returns(true)
    const app = Substitute.for()
    app.getCalc().add(1, 2).returns(99)
    console.log(JSON.stringify({ driver: inspect(driver), app: inspect(app), result: app.getCalc().add(1, 2) }))
  `)
  // without frames, a setup right after the call that returned the value retracts that call (the round-2 rule)
  // (E24, round 7: the setups of the auto-substitutes are shown under their paths)
  t.deepEqual(result, {
    driver: "@Substitute {\n  configured:\n    connect('db://x').isOpen => returns(true)\n}",
    app: '@Substitute {\n  configured:\n    getCalc().add(1, 2) => returns(99)\n}',
    result: 99
  })
})

/**
 * Compiles a TypeScript file with a source map into a new temporary directory, runs `use` with the path of the
 * JavaScript file, and removes the directory again (PK5-1: no test leaves files in the temporary directory).
 */
const withSourceMapProject = <T>(source: string, use: (script: string) => T): T => {
  const typescript = require('typescript')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'substitute-source-map-'))
  try {
    const { outputText, sourceMapText } = typescript.transpileModule(source, {
      fileName: 'checkout.ts',
      compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2019, sourceMap: true }
    })
    fs.writeFileSync(path.join(directory, 'checkout.ts'), source)
    fs.writeFileSync(path.join(directory, 'checkout.js'), outputText)
    fs.writeFileSync(path.join(directory, 'checkout.js.map'), sourceMapText)
    return use(path.join(directory, 'checkout.js'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('PK5-1 (E17) the source-map check leaves nothing in the temporary directory', t => {
  const leftovers = () => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('substitute-source-map-'))
  const before = new Set(leftovers())
  let directory = ''
  const output = withSourceMapProject("console.log('compiled')", script => {
    directory = path.dirname(script)
    t.true(fs.existsSync(path.join(directory, 'checkout.js.map')))
    return spawnSync(process.execPath, ['--enable-source-maps', script], { encoding: 'utf8' }).stdout
  })
  t.is(output, 'compiled\n')
  t.false(fs.existsSync(directory), `${directory} was removed`)
  t.deepEqual(leftovers().filter(name => !before.has(name)), [])
  // also when the check fails
  t.throws(() => withSourceMapProject('', script => {
    directory = path.dirname(script)
    throw new Error('the check failed')
  }), { message: 'the check failed' })
  t.false(fs.existsSync(directory), `${directory} was removed`)
})

test('R3-ADV-3 (E4) "called at" lines keep source maps, also where Error.prepareStackTrace is not set (as in jest)', t => {
  const source = [
    `import { Substitute } from ${JSON.stringify(library)}`,
    '',
    '// types and blank lines that are not in the JavaScript output, so that the lines differ',
    'interface Metrics {',
    '  increment(name: string): void',
    '  child: Metrics',
    '}',
    '',
    'type Unused = { a: string, b: string }',
    '',
    "if (process.env.WITHOUT_PREPARE_STACK_TRACE) delete (Error as any).prepareStackTrace",
    'const metrics = Substitute.for<Metrics>()',
    "metrics.increment('x')",
    "metrics.child.increment('y')",
    'const messages: string[] = []',
    "try { metrics.received(2).increment('x') } catch (error: any) { messages.push(error.message) }",
    'try { metrics.received(2).child } catch (error: any) { messages.push(error.message) }',
    'console.log(JSON.stringify(messages))'
  ].join('\n')
  const lines = source.split('\n')
  const lineOf = (text: string) => lines.indexOf(text) + 1
  withSourceMapProject(source, script => {
    for (const withoutPrepareStackTrace of [false, true]) {
      const result = spawnSync(process.execPath, ['--enable-source-maps', script], {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', ...(withoutPrepareStackTrace ? { WITHOUT_PREPARE_STACK_TRACE: '1' } : {}) }
      })
      t.is(result.status, 0, result.stderr)
      const [increment, child] = JSON.parse(result.stdout) as string[]
      const calledAt = (message: string) => message.split('\n').filter(line => line.includes('called at'))
      t.deepEqual(calledAt(increment).map(line => /checkout\.(ts|js):(\d+)/.exec(line)?.slice(1).join(':')), [`ts:${lineOf("metrics.increment('x')")}`],
        `the call site maps to the TypeScript line (${withoutPrepareStackTrace ? 'without' : 'with'} Error.prepareStackTrace)`)
      // a nested read whose structured call site was read for the chain (D25) keeps its text as well
      t.deepEqual(calledAt(child).map(line => /checkout\.(ts|js):(\d+)/.exec(line)?.slice(1).join(':')), [`ts:${lineOf("metrics.child.increment('y')")}`])
    }
  })
})

test('R3-ADV-4 (E5) reading call sites never changes Error.prepareStackTrace for the process', t => {
  const scenario = `
    const { Substitute } = require(${JSON.stringify(library)})
    const { inspect } = require('util')
    const descriptor = () => { const d = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace'); return d && { ...d } }
    const before = descriptor()
    // setups and checks that read structured call sites (D25 chains), and a failure message
    const app = Substitute.for()
    app.getCalc().add(1, 2).returns(3)
    app.logger.info('x')
    app.logger.received(1).info('x')
    function getConnection(driver) { return driver.connect('db://x') }
    const driver = Substitute.for()
    getConnection(driver).isOpen.returns(true)
    let message = ''
    try { app.logger.received(2).info('x') } catch (error) { message = error.message }
    const after = descriptor()
    let syntaxError
    try { JSON.parse('{') } catch (error) { syntaxError = error }
    console.log(JSON.stringify({
      unchanged: JSON.stringify(Object.keys(before || {})) === JSON.stringify(Object.keys(after || {})) &&
        (before === undefined ? after === undefined : Object.keys(before).every(key => before[key] === after[key])),
      stackIsText: typeof new Error('y').stack === 'string' && typeof syntaxError.stack === 'string',
      calledAt: message.includes('called at'),
      // E24 (round 7): the setups and calls of the auto-substitutes are shown under their paths
      setupRecordedNothing: inspect(app) === "@Substitute {\\n  received:\\n    logger\\n    logger.info('x')\\n  configured:\\n    getCalc().add(1, 2) => returns(3)\\n}",
      codeUnderTestCallKept: (() => { try { driver.received(1).connect('db://x'); return true } catch { return false } })(),
      result: app.getCalc().add(1, 2)
    }))
  `
  const formatter = `(error, frames) => 'formatted ' + error + frames.map(frame => '\\n    at ' + frame).join('')`
  // stack-chain installs an accessor whose setter stores the formatter and whose getter returns its own wrapper, with
  // Object.defineProperty and no attributes: non-configurable where Node.js has no Error.prepareStackTrace of its own
  // (before 21), configurable where it has one
  const accessor = (attributes: string) => `
      let current = ${formatter}
      const installed = (error, frames) => current(error, frames)
      Object.defineProperty(Error, 'prepareStackTrace', { ${attributes} get: () => installed, set: value => { current = value } })`
  const setups: Record<string, string> = {
    'an accessor as stack-chain installs it': accessor(''),
    'a non-configurable accessor': `delete Error.prepareStackTrace; ${accessor('configurable: false,')}`,
    'a configurable accessor': accessor('configurable: true,'),
    // source-map-support: a data property
    'a data property (source-map-support)': `Error.prepareStackTrace = ${formatter}`,
    'a non-configurable data property': `Object.defineProperty(Error, 'prepareStackTrace', { value: ${formatter}, writable: true, configurable: false })`,
    'no property at all': `delete Error.prepareStackTrace`
  }
  for (const [name, setup] of Object.entries(setups)) {
    const result = runScript(setup + scenario)
    // a non-configurable accessor cannot be swapped for a moment: then there are no structured frames, and adjacency
    // decides (E2), which also retracts the call that the code under test made right before the setup
    const withFrames = !name.startsWith('a non-configurable accessor')
    t.deepEqual(result, {
      unchanged: true, stackIsText: true, calledAt: true, setupRecordedNothing: true, codeUnderTestCallKept: withFrames, result: 3
    }, name)
  }
})

test('R3-ADV-5 (E6) deferred reports are thrown from a microtask, also when fake timers replace it later', t => {
  const script = (setup: string) => `
    const { Substitute } = require(${JSON.stringify(library)})
    ${setup}
    const order = []
    process.on('uncaughtException', error => order.push('report: ' + error.constructor.name))
    process.nextTick(() => order.push('nextTick'))
    Promise.resolve().then(() => order.push('promise job before'))
    const calculator = Substitute.for()
    calculator.add(1, 2)
    calculator.add(3, 4)
    calculator.received(1).add // D9: decided once it is known that add is not invoked
    Promise.resolve().then(() => order.push('promise job after'))
    setImmediate(() => console.log(JSON.stringify(order)))
  `
  // a microtask runs with the promise jobs, in order, after the queued nextTick callbacks
  const expected = ['nextTick', 'promise job before', 'report: SubstituteException', 'promise job after']
  t.deepEqual(runScript(script('')), expected)
  // fake timers installed after the library was loaded cannot delay or swallow the report (D34)
  const fakeTimers = require.resolve('@sinonjs/fake-timers')
  const withFakeTimers = runScript(script(`
    const clock = require(${JSON.stringify(fakeTimers)}).install({ toFake: ['queueMicrotask', 'nextTick', 'setTimeout'] })
  `))
  t.true(withFakeTimers.includes('report: SubstituteException'), JSON.stringify(withFakeTimers))

  // plain Node.js: the report is an uncaught exception, printed, and the process exits with code 1
  const result = spawnSync(process.execPath, ['-e', `
    const { Substitute } = require(${JSON.stringify(library)})
    const logger = Substitute.for()
    logger.error('disk full')
    logger.didNotReceive().error // D33: the parentheses were forgotten
  `], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  t.is(result.status, 1)
  t.regex(result.stderr, /SubstituteException: Call count mismatch in @Substitute\.error:/)
  t.regex(result.stderr, /to assert calls, invoke it: sub\.didNotReceive\(\)\.error\(\.\.\.\)/)
})

test('R3-2 (E7) the runtime\'s own util.promisify.custom and util.inspect.custom are used, also where they are not the registered symbols', t => {
  // Node.js 10.0 to 12.16.1 and 13.0 to 13.11 have a util.promisify.custom of their own (Node.js 10.0 to 10.11 the
  // same for util.inspect.custom), not Symbol.for('nodejs.util.promisify.custom'). This child process makes the
  // running Node.js look like that before it loads the library.
  const result = runScript(`
    const util = require('util')
    const promisifyCustom = util.promisify.custom = Symbol('util.promisify.custom')
    const inspectCustom = util.inspect.custom = Symbol('util.inspect.custom')
    const { Substitute, Arg } = require(${JSON.stringify(library)})

    // util.promisify of those versions: the function under the custom key, if there is one, or a wrapper
    const promisify = original => typeof original[promisifyCustom] === 'function' ? original[promisifyCustom]
      : (...args) => new Promise((resolve, reject) => original(...args, (error, value) => error ? reject(error) : resolve(value)))

    const fs = Substitute.for()
    fs.readFile(Arg.any(), Arg.any()).mimicks((file, done) => done(null, 'contents of ' + file))
    const loaded = promisify(fs.readFile)('/etc/app.json')
    const custom = typeof fs.readFile[promisifyCustom]
    let recorded = false
    try { fs.readFile.didNotReceive()[promisifyCustom] } catch (error) { recorded = true }
    const matcher = Arg.is(() => true)
    Promise.resolve(loaded).then(contents => console.log(JSON.stringify({
      contents: typeof contents === 'string' ? contents : typeof contents,
      custom,
      recorded,
      printed: typeof matcher[inspectCustom] === 'function' ? matcher[inspectCustom]() : 'not printable'
    })))
  `)
  t.deepEqual(result, {
    contents: 'contents of /etc/app.json',
    custom: 'undefined',
    recorded: false,
    printed: 'Arg.is{() => true}'
  })
})
