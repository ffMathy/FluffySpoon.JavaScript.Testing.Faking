import test, { ExecutionContext } from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 16: the calls-and-arguments part of the round-15 findings (R15-ADV-4 with the docs agent's E95 cost, R15V-1,
// R15V-2, R15V-3 with the docs agent's E88 gap), decided in the fix spec as E100, E101, E102 and E103.

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

const library = path.resolve(__dirname, '../../../src/index.js')

/** Runs a script with the library in a child process: what it prints (as JSON when `json`), and its exit code and stderr. */
const runScript = (script: string): { stdout: string, stderr: string, status: number | null } => {
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

/** Calls the code under test makes through wrappers (a retry helper, a spy): fn.apply(this, args), fn.call(undefined, ...). */
const withRetry = (fn: Function): any => function (this: unknown, ...args: unknown[]): unknown {
  return fn.apply(this, args)
}
const callWith = (fn: Function): any => (...args: unknown[]) => fn.call(undefined, ...args)

// ---- E101 (R15V-1): a throwing answer is noted without catching it ------------------------------------------------

test('R15V-1 (E101) a debugger that pauses on caught exceptions stops once per throwing call, where it was thrown', t => {
  const result = runScript(`
    const inspector = require('inspector')
    const session = new inspector.Session()
    session.connect()
    const pauses = []
    session.on('Debugger.paused', ({ params }) => {
      const top = params.callFrames[0]
      pauses.push(top.functionName)
      session.post('Debugger.resume')
    })
    session.post('Debugger.enable')
    const { Substitute, Arg, mimick } = require(${JSON.stringify(library)})
    const cases = {
      'throws()': [s => s.load(1).throws(new Error('x')), s => s.load(1)],
      'throws() with a matcher': [s => s.load(Arg.any()).throws(new Error('x')), s => s.load(1)],
      'a throwing mimicks()': [s => s.load(1).mimicks(function ownThrow() { throw new Error('x') }), s => s.load(1)],
      'a throwing mimicked method': [s => s[mimick]({ load: function ownThrow() { throw new Error('x') } }), s => s.load(1)],
      'a bound method answered by throws()': [s => s.load(1).throws(new Error('x')), s => s.load.bind(s)(1)],
      'new answered by throws()': [s => s.Client(1).throws(new Error('x')), s => new s.Client(1)],
      // E103: the same through call/apply
      'throws() through apply': [s => s.load(1).throws(new Error('x')), s => s.load.apply(undefined, [1])],
      'throws() through call': [s => s.load(Arg.any()).throws(new Error('x')), s => s.load.call(null, 1)],
      'a throwing mimicks() through apply': [s => s.load(1).mimicks(function ownThrow() { throw new Error('x') }), s => s.load.apply(s, [1])],
      'a throwing mimicked method through apply': [s => s[mimick]({ load: function ownThrow() { throw new Error('x') } }), s => s.load.apply(s, [1])],
      'a function substitute through call': [s => s(Arg.any()).throws(new Error('x')), s => s.call(null, 1)],
      'a member call() of its own': [s => s.rpc.call('get', 1).throws(new Error('x')), s => s.rpc.call('get', 1)]
    }
    const outcome = {}
    for (const [name, [arrange, act]] of Object.entries(cases)) {
      const s = Substitute.for()
      arrange(s)
      session.post('Debugger.setPauseOnExceptions', { state: 'all' })
      const before = pauses.length
      try { act(s) } catch { }
      session.post('Debugger.setPauseOnExceptions', { state: 'none' })
      outcome[name] = pauses.slice(before)
    }
    console.log(JSON.stringify(outcome))
  `)
  t.is(result.status, 0, result.stderr)
  const outcome: Record<string, string[]> = JSON.parse(result.stdout)
  for (const [name, pauses] of Object.entries(outcome)) {
    // cd1bf29: two pauses, the second one in resolveCall (`catch (thrown) { ...; throw thrown }`)
    t.is(pauses.length, 1, `${name}: ${pauses.join(' | ')}`)
    const where = pauses[0] ?? ''
    // the throw of the code under test, or the configured throw (the library's execute)
    t.is(where, name.includes('mimick') ? 'ownThrow' : 'execute', name)
  }
})

test('R15V-1 (E101) an uncaught error of a throwing mimicks() points at the throw of the code under test, not into the library', t => {
  for (const act of ['s.load(1)', 's.load.apply(undefined, [1])', 'new s.load(1)']) {
    const result = runScript(`
      const { Substitute } = require(${JSON.stringify(library)})
      const s = Substitute.for()
      s.load(1).mimicks(() => { throw new Error('from mimicks') })
      ${act}
    `)
    t.not(result.status, 0)
    const [where, line] = result.stderr.split('\n')
    // cd1bf29: ".../internals/Engine.js:1411" and "throw thrown;"
    t.is(where, '[eval]:4', `${act}: ${result.stderr}`)
    t.true(line.includes("throw new Error('from mimicks')"), `${act}: ${result.stderr}`)
  }
})

test('R15V-1 (E101) a throwing call is still noted for checks through a call with matchers (E88), and nothing else changes', t => {
  const api = Substitute.for<any>()
  api.load(Arg.any()).throws(new Error('boom'))
  t.throws(() => api.load(1), { message: 'boom' }) // the code under test
  t.throws(() => api.load(2), { message: 'boom' })
  t.notThrows(() => api.received(2).load(Arg.any()))
  t.true(failureOf(t, () => api.load(Arg.any())[didNotReceive]().save())
    .includes('the received call @Substitute.load(1), which it matches, is configured with throws([Error: boom]), so it threw instead of answering a substitute.'))
  const service = Substitute.for<any>()
  service.run(Arg.any()).mimicks(() => { throw new TypeError('bad') })
  t.throws(() => service.run(1), { instanceOf: TypeError, message: 'bad' })
  t.true(failureOf(t, () => service.run(Arg.any()).didNotReceive().stop())
    .includes('the received call @Substitute.run(1), which it matches, threw an error instead of answering a substitute.'))
})

// ---- E102 (R15V-2): a throwing getter is read at most once per comparison -------------------------------------------

test('R15V-2 (E102) a throwing getter of an argument is read once per comparison with a setup or a check that holds nested matchers', t => {
  let reads = 0
  const lazy = () => Object.defineProperty({}, 'name', { enumerable: true, get() { reads++; throw new Error('not loaded') } })
  const count = (act: () => void): number => {
    reads = 0
    act()
    return reads
  }
  // (as at d417925; cd1bf29 read it twice per comparison: 10, 4, 21 and 3)
  const checked = Substitute.for<any>()
  for (let index = 0; index < 5; index++) checked.save(lazy())
  t.is(count(() => checked.didNotReceive().save({ name: Arg.any() })), 5)
  t.is(count(() => { try { checked.received(5).save({ name: Arg.any() }) } catch { /* fails: they cannot be read */ } }), 5)
  const one = Substitute.for<any>()
  one.save({ name: Arg.any() }).returns(1)
  t.is(count(() => one.save(lazy())), 2) // the matcher search and the hash, then one comparison
  const ten = Substitute.for<any>()
  for (let index = 0; index < 10; index++) ten.save({ name: Arg.is(name => name === `u${index}`) }).returns(index)
  t.is(count(() => ten.save(lazy())), 11)
  const deeper = Substitute.for<any>()
  deeper.save({ user: { name: Arg.any() } }).returns(1)
  t.is(count(() => deeper.save({ user: lazy() })), 2)
})

test('R15V-2 (E102) such a value still matches by identity, and never matches an equal-looking container', t => {
  const unreadable = Object.defineProperty({}, 'name', { enumerable: true, get(): string { throw new Error('not loaded') } })
  const sub = Substitute.for<any>()
  sub.save({ user: unreadable, id: Arg.any() }).returns('same object')
  t.is(sub.save({ user: unreadable, id: 1 }), 'same object')
  t.not(sub.save({ user: Object.defineProperty({}, 'name', { enumerable: true, get(): string { throw new Error('not loaded') } }), id: 1 }), 'same object')
  t.not(sub.save({ user: { name: 'x' }, id: 1 }), 'same object')
  t.notThrows(() => sub.received(1).save({ user: unreadable, id: Arg.any() }))
})

// ---- E103 (R15V-3): a throwing answer reached through call/apply is noted like the direct call's --------------------

test('R15V-3 (E103) a call through call/apply answered by throws() makes a check through a call with matchers a usage error', t => {
  const paths: Array<{ name: string, act: (api: any) => unknown }> = [
    { name: 'a wrapper calling fn.apply(this, args)', act: api => withRetry(api.load)(1) },
    { name: 'fn.call(undefined, ...args)', act: api => callWith(api.load)(1) },
    { name: 'api.load.call(api, 1)', act: api => api.load.call(api, 1) },
    { name: 'api.load.apply(null, [1])', act: api => api.load.apply(null, [1]) }
  ]
  const answers: Array<{ name: string, setup: (api: any) => void, says: string }> = [
    { name: 'throws()', setup: api => api.load(Arg.any()).throws(new Error('x')), says: 'is configured with throws([Error: x]), so it threw instead of answering a substitute' },
    { name: 'a literal throws()', setup: api => api.load(1).throws(new Error('x')), says: 'is configured with throws([Error: x]), so it threw instead of answering a substitute' },
    { name: 'a throwing mimicks()', setup: api => api.load(Arg.any()).mimicks(() => { throw new Error('x') }), says: 'threw an error instead of answering a substitute' },
    { name: 'a throwing mimicked method', setup: api => api[mimick]({ load: () => { throw new Error('x') } }), says: 'threw an error instead of answering a substitute' }
  ]
  for (const answer of answers) {
    for (const route of paths) {
      const api = Substitute.for<any>()
      answer.setup(api)
      t.throws(() => route.act(api), { message: 'x' }, `${answer.name}, ${route.name}`) // the code under test
      // cd1bf29: these passed, as if load(1) had answered nothing that save() could be called on
      for (const open of [(v: any) => v.didNotReceive(), (v: any) => v[didNotReceive](), (v: any) => v.received(1), (v: any) => v[received](1)]) {
        const message = failureOf(t, () => open(api.load(Arg.any())).save(), `${answer.name}, ${route.name}`)
        t.true(message.startsWith('Cannot check through @Substitute.load(Arg.any{any}): the received call @Substitute.load(1), which it matches, ' +
          `${answer.says}.`), `${answer.name}, ${route.name}: ${message}`)
      }
      // recording is unchanged (D26): counted under both readings
      t.notThrows(() => api.received(1).load(1))
    }
  }
})

test('R15V-3 (E103) a function substitute called through call/apply, and the member reading of call/apply, are noted too', t => {
  const fn = Substitute.for<any>()
  fn(Arg.any()).throws(new Error('x'))
  t.throws(() => fn.call(null, 1), { message: 'x' })
  t.true(failureOf(t, () => fn(Arg.any()).didNotReceive().go())
    .startsWith('Cannot check through @Substitute(Arg.any{any}): the received call @Substitute(1), which it matches, is configured with throws([Error: x])'))

  const handler = Substitute.for<any>()
  handler(Arg.any()).mimicks(() => { throw new Error('x') })
  t.throws(() => handler.apply(undefined, [1]), { message: 'x' })
  t.true(failureOf(t, () => handler(Arg.any())[didNotReceive]().go()).includes('threw an error instead of answering a substitute'))

  // a member named call that is an API of its own (E91): its throws() setup answers, and it is noted for that member
  const rpc = Substitute.for<any>()
  rpc.call('getUser', Arg.any()).throws(new Error('x'))
  t.throws(() => rpc.call('getUser', 1), { message: 'x' })
  t.true(failureOf(t, () => rpc.call('getUser', Arg.any())[didNotReceive]().save())
    .includes("the received call @Substitute.call('getUser', 1), which it matches, is configured with throws([Error: x])"))

  // and a call that answered normally afterwards counts as before
  const api = Substitute.for<any>()
  const user = Substitute.for<any>()
  api.load(1).throws(new Error('x'))
  api.load(2).returns(user)
  t.throws(() => withRetry(api.load)(1), { message: 'x' })
  withRetry(api.load)(2).save()
  t.notThrows(() => api.load(2).received(1).save())
  t.notThrows(() => user.received(1).save())
})
