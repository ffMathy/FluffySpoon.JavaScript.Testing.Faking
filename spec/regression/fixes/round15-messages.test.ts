import test, { ExecutionContext } from 'ava'
import * as path from 'path'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 15, engine (messages): the round-14 findings R14-ADV-3 and R14FE-5, decided in the fix spec as E98 and E97.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of the SubstituteException that `check` throws (failing the test if it throws none or another error). */
const failureOf = (t: ExecutionContext, check: () => void): string => {
  try {
    check()
  } catch (error) {
    if (error instanceof SubstituteException) return plain(error.message)
    throw error
  }
  t.fail('the check passed, but it should have failed')
  return ''
}

/** The message without its "called at" lines (they name this file, whose path depends on the checkout). */
const withoutSites = (message: string) => message.split('\n').filter(line => !line.trim().startsWith('called at ')).join('\n')

// ---- E98 (R14-ADV-3): a call-form check of a member whose reads answered values that cannot be called ---------------

const METHOD_HINT = 'reading a method does not count as calling it'

test('R14-ADV-3 (E98) the finding: a call-form check of a property configured with a value gives no method hint, and says what its reads answered', t => {
  const config = Substitute.for<any>()
  config.port.returns(5432)
  void config.port // the code under test reads the port

  // the count equals the reads: the property part passes, and the call is what fails (method wording, ✘ marks)
  t.is(withoutSites(failureOf(t, () => config.received(1).port())), [
    'Call count mismatch in @Substitute.port:',
    'Expected to receive 1 method call matching port(), but received none.',
    'All property or method calls to @Substitute.port received so far:',
    '› ✘ @Substitute.port',
    '@Substitute.port was read 1 time, and its reads answered a value that cannot be called, so they are property reads, not method calls. ' +
    'To check them, leave out the call: sub.received(1).port',
    ''
  ].join('\n'))
  const any = failureOf(t, () => config.received().port())
  t.true(any.includes('Expected to receive 1 or more method calls matching port(), but received none.'), any)
  t.true(any.includes('To check them, leave out the call: sub.received().port'), any)
  t.false(any.includes(METHOD_HINT), any)
  // and the checks that leave out the call pass
  t.notThrows(() => config.received(1).port)
  t.notThrows(() => config.received().port)

  void config.port
  const twice = failureOf(t, () => config[received](2).port())
  t.true(twice.includes('Expected to receive 2 method calls matching port(), but received none.'), twice)
  t.true(twice.includes('@Substitute.port was read 2 times, and its reads answered a value that cannot be called'), twice)
  t.is(twice.split('\n').filter(line => line.startsWith('› ✘ @Substitute.port')).length, 2, twice)
  t.false(twice.includes(METHOD_HINT), twice)

  // a count other than the reads: E85's property wording, ✔ marks and no hint, as before
  t.is(withoutSites(failureOf(t, () => config.received(1).port())), [
    'Call count mismatch in @Substitute.port:',
    'Expected to receive 1 property read matching port, but received 2.',
    'All property or method calls to @Substitute.port received so far:',
    '› ✔ @Substitute.port',
    '› ✔ @Substitute.port',
    ''
  ].join('\n'))
})

test('R14-ADV-3 (E98) every kind of value that cannot be called, decided as E85 decides it', t => {
  const values = Substitute.for<any>()
  values.nothing.returns(null)
  values.unset.returns()
  values.data.resolves(1)
  values.failure.throws(new Error('no'))
  const settings = Substitute.for<any>()
  settings[mimick]({ timeout: 30 })
  for (const [sub, member] of [[values, 'nothing'], [values, 'unset'], [values, 'data'], [values, 'failure'], [settings, 'timeout'], [settings, 'missing']] as const) {
    try { void sub[member] } catch { /* (throws()) */ }
    const message = failureOf(t, () => sub.received(1)[member]('x'))
    t.true(message.includes(`Expected to receive 1 method call matching ${member}('x'), but received none.`), message)
    t.true(message.includes(`› ✘ @Substitute.${member}`), message)
    t.true(message.includes(`@Substitute.${member} was read 1 time, and its reads answered a value that cannot be called, so they are property reads, not method calls. ` +
      `To check them, leave out the call: sub.received(1).${member}`), message)
    t.false(message.includes(METHOD_HINT), message)
  }
})

test('R14-ADV-3 (E98) members that may be methods keep the method hint', t => {
  class WithGetter { get port() { return 5432 } }
  const kinds: Record<string, (sub: any) => void> = {
    unconfigured: () => undefined,
    function: sub => sub.port.returns(() => 1),
    substitute: sub => sub.port.returns(Substitute.for<any>()),
    mimicks: sub => sub.port.mimicks(() => 5432),
    alsoMethod: sub => { sub.port(1).returns(2); sub.port.returns(5432) },
    mimickedMethod: sub => sub[mimick]({ port() { return 1 } }),
    mimickedGetter: sub => sub[mimick](new WithGetter())
  }
  for (const [kind, setup] of Object.entries(kinds)) {
    const sub = Substitute.for<any>()
    setup(sub)
    void sub.port
    const message = failureOf(t, () => sub.received(1).port(Arg.all()))
    t.true(message.includes(`@Substitute.port was read 1 time without being called; ${METHOD_HINT}.`), `${kind}: ${message}`)
    t.false(message.includes('cannot be called'), `${kind}: ${message}`)
  }
})

// ---- E97 (R14FE-5): a check of a member that was only called further down an unconfigured fluent chain ---------------

const fluentRemedy = (method: string, substitute = 'sub') =>
  `A call that is not configured answers a new substitute. For a fluent API, make the method return the substitute ` +
  `(${substitute}${method}(Arg.all()).returns(${substitute})) or mimick an instance whose methods return this.`

test('R14FE-5 (E97) the finding: a check of a member called further down a fluent chain names where it was called, and the remedy', t => {
  // the code under test: an OpenTelemetry span and a fastify reply, both fluent
  const finish = (span: any, reply: any) => {
    span.setAttribute('http.status_code', 404).setStatus({ code: 2 })
    reply.code(404).send({ error: 'not found' })
  }
  const span = Substitute.for<any>()
  const reply = Substitute.for<any>()
  finish(span, reply)

  t.is(failureOf(t, () => span.received(1).setStatus({ code: 2 })), [
    'Call count mismatch in @Substitute.setStatus:',
    'Expected to receive 1 property read or method call matching setStatus, but received none.',
    "setStatus was not called on @Substitute itself, but on a substitute further down: @Substitute.setAttribute('http.status_code', 404).setStatus(...). " +
    fluentRemedy('.setAttribute'),
    ''
  ].join('\n'))
  t.is(failureOf(t, () => reply.received(1).send({ error: 'not found' })), [
    'Call count mismatch in @Substitute.send:',
    'Expected to receive 1 property read or method call matching send, but received none.',
    'send was not called on @Substitute itself, but on a substitute further down: @Substitute.code(404).send(...). ' + fluentRemedy('.code'),
    ''
  ].join('\n'))

  // the remedy works
  const fixed = Substitute.for<any>()
  fixed.code(Arg.all()).returns(fixed)
  finish(Substitute.for<any>(), fixed)
  t.notThrows(() => fixed.received(1).send({ error: 'not found' }))
})

test('R14FE-5 (E97) every form of a check that finds no record of the member, and a knex-style query builder', t => {
  // a function substitute: db('users').where(...).first()
  const db = Substitute.for<any>()
  db('users').where('id', 1).first()
  const first = failureOf(t, () => db[received](2).first())
  t.true(first.includes("first was not called on @Substitute itself, but on a substitute further down: @Substitute('users').where('id', 1).first(...). " +
    fluentRemedy('')), first)
  const where = failureOf(t, () => db.received().where('id', 1))
  t.true(where.includes("but on a substitute further down: @Substitute('users').where(...)."), where)

  // a direct-call check of the member (sub.m[received](1)(...)) finds no record either
  const builder = Substitute.for<any>()
  builder.select('a').limit(1)
  const limit = failureOf(t, () => builder.limit[received](1)(1))
  t.true(limit.includes("limit was not called on @Substitute itself, but on a substitute further down: @Substitute.select('a').limit(...). " +
    fluentRemedy('.select')), limit)

  // a check of an auto-substitute names the step below it
  const app = Substitute.for<any>()
  app.logger.child({ module: 'db' }).info('connected')
  const info = failureOf(t, () => app.logger.received(1).info('connected'))
  t.true(info.includes('info was not called on @Substitute.logger itself, but on a substitute further down: ' +
    "@Substitute.logger.child({ module: 'db' }).info(...). " + fluentRemedy('.child', 'sub.logger')), info)
})

test('R14FE-5 (E97) a member called on a substitute that a property answered: the hint says where to check it', t => {
  const app = Substitute.for<any>()
  app.logger.info('started')
  const message = failureOf(t, () => app.received(1).info('started'))
  t.true(message.includes('info was not called on @Substitute itself, but on a substitute further down: @Substitute.logger.info(...). ' +
    'To check calls there, check that substitute: sub.logger.received(1).info(...)'), message)
  t.notThrows(() => app.logger.received(1).info('started'))
})

test('R14FE-5 (E97) the hint names up to three places, nearest first', t => {
  const query = Substitute.for<any>()
  query.where('a').orderBy('b').first() // deeper: found after the nearer ones
  for (let index = 0; index < 5; index++) query.where(index).first()
  const message = failureOf(t, () => query.received().first())
  t.true(message.includes('first was not called on @Substitute itself, but on substitutes further down: ' +
    '@Substitute.where(0).first(...), @Substitute.where(1).first(...), @Substitute.where(2).first(...) and more. ' + fluentRemedy('.where')), message)

  const two = Substitute.for<any>()
  two.a().done()
  two.b().c().done()
  const both = failureOf(t, () => two.received().done())
  t.true(both.includes('but on substitutes further down: @Substitute.a().done(...) and @Substitute.b().c().done(...). ' + fluentRemedy('.a')), both)
})

test('R14FE-5 (E97) no hint where it does not apply', t => {
  const hint = 'further down'
  // didNotReceive() and received(0) pass: the member was not called on the substitute itself
  const reply = Substitute.for<any>()
  reply.code(404).send(1)
  t.notThrows(() => reply.didNotReceive().send(1))
  t.notThrows(() => reply.received(0).send(1))
  t.notThrows(() => reply[didNotReceive]().send(Arg.all()))

  // the member has records on the substitute itself: the message lists them, as before
  reply.send(2)
  const listed = failureOf(t, () => reply.received(1).send(1))
  t.true(listed.includes('› ✘ @Substitute.send(2)'), listed)
  t.false(listed.includes(hint), listed)

  // only read further down, never called
  const query = Substitute.for<any>()
  void query.where(1).first
  t.false(failureOf(t, () => query.received().first()).includes(hint))

  // nothing further down
  const empty = Substitute.for<any>()
  empty.code(404)
  t.false(failureOf(t, () => empty.received().send()).includes(hint))

  // the fluent method returns the substitute (configured, or a mimicked instance whose methods return this, E76)
  const configured = Substitute.for<any>()
  configured.code(Arg.any()).returns(configured)
  configured.code(404).send(1)
  t.notThrows(() => configured.received(1).send(1))
  t.false(failureOf(t, () => configured.received(1).header('x')).includes(hint))
  class Reply { code() { return this } send() { return this } }
  const mimicked = Substitute.for<any>()
  mimicked[mimick](new Reply())
  mimicked.code(404).send(1)
  t.notThrows(() => mimicked.received(1).send(1))
  t.false(failureOf(t, () => mimicked.received(1).header('x')).includes(hint))

  // an assignment check, of a member that was assigned further down
  const response = Substitute.for<any>()
  response.raw.statusCode = 404
  t.false(failureOf(t, () => { response.received(1).statusCode = 404 }).includes(hint))
})

/** A second, independent copy of the package, as duplicate installs give (see duplicate-copies.test.ts). */
const loadSecondCopy = (): typeof import('../../../src') => {
  const entry = require.resolve('../../../src')
  const root = path.dirname(entry) + path.sep
  const saved = new Map<string, NodeModule>()
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) {
      saved.set(key, require.cache[key]!)
      delete require.cache[key]
    }
  }
  try {
    return require(entry)
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key]
    for (const [key, module] of saved) require.cache[key] = module
  }
}

test('R14FE-5 (E97) two copies of the package: each names the calls further down its own substitutes', t => {
  const copyB = loadSecondCopy()
  const reply = copyB.Substitute.for<any>()
  const other = Substitute.for<any>()
  reply.code(other).send(1) // a substitute of the other copy as an argument on the way
  let message = ''
  try {
    reply[received](1).send(1) // the symbols are shared, the check runs in copy B
  } catch (error) {
    message = plain((error as Error).message)
  }
  t.true(message.includes('send was not called on @Substitute itself, but on a substitute further down: @Substitute.code(@Substitute).send(...). ' +
    fluentRemedy('.code')), message)

  const span = Substitute.for<any>()
  span.setAttribute(reply).setStatus(2)
  const own = failureOf(t, () => span[copyB.received](1).setStatus(2))
  t.true(own.includes('setStatus was not called on @Substitute itself, but on a substitute further down: @Substitute.setAttribute(@Substitute).setStatus(...). ' +
    fluentRemedy('.setAttribute')), own)
})

test('R14FE-5 (E97) the search is bounded: a call beyond it is not named, and nearer ones are', t => {
  // a chain far deeper than the search goes
  let deep = Substitute.for<any>()
  const root = deep
  for (let index = 0; index < 20_000; index++) deep = deep.next(index)
  deep.end()
  const message = failureOf(t, () => root.received().end())
  t.true(message.includes('Expected to receive 1 or more property reads or method calls matching end, but received none.'), message)
  t.false(message.includes('further down'), message)
  root.next(0).end()
  t.true(failureOf(t, () => root.received().end()).includes('but on a substitute further down: @Substitute.next(0).end(...).'))

  // a long path is cut
  const wide = Substitute.for<any>()
  let step = wide
  for (let index = 0; index < 12; index++) step = step.m('x'.repeat(90), 'y'.repeat(90), 'z'.repeat(90))
  step.end()
  const cut = failureOf(t, () => wide.received().end())
  const line = cut.split('\n').find(text => text.startsWith('end was not called'))!
  t.true(/… \(\d+ more characters\)\(\.\.\.\)\. /.test(line), line)
  t.true(line.length < 1500, `${line.length} characters`)
})
