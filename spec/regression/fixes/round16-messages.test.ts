import test, { ExecutionContext } from 'ava'
import * as path from 'path'
import { inspect } from 'util'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 16, engine (messages): the round-15 findings R15-ADV-6 and R15FE-5 (its labels), decided in the fix spec as
// E108 and E99-labels.

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

/** The message of any error that `check` throws (an error of another copy of the library is no SubstituteException here). */
const errorOf = (t: ExecutionContext, check: () => void): string => {
  try {
    check()
  } catch (error) {
    return plain(String((error as Error).message))
  }
  t.fail('the check passed, but it should have failed')
  return ''
}

/** The message without its "called at" lines (they name this file, whose path depends on the checkout). */
const withoutSites = (message: string) => message.split('\n').filter(line => !line.trim().startsWith('called at ')).join('\n')

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

// ---- E108 (R15-ADV-6): the remedy of the fluent-chain hint works when it is followed ----------------------------------

/** The line of the fluent-chain hint (E97) in a message. */
const hintOf = (message: string): string => message.split('\n').find(line => line.includes(' further down: ')) ?? ''

/**
 * The setups that the fluent remedy of a hint suggests (`sub.code(Arg.all()).returns(sub)`, ...), as written in it. The
 * hint writes the checked substitute as `sub`, so each one runs with `sub` standing for the substitute it is applied to.
 */
const suggestedSetups = (hint: string): string[] => {
  const remedy = /make (?:the method|each method on the way) return the substitute \((.*)\) or mimick an instance whose methods return this\.$/.exec(hint)
  if (remedy === null) return []
  return remedy[1].match(/sub[\w$.]*\(Arg\.all\(\)\)\.returns\(sub[\w$.]*\)/g) ?? []
}

/** Follows the fluent remedy of a hint: runs each setup it suggests on `sub` (with this copy's Arg, or the given one). */
const applySetups = (setups: readonly string[], sub: unknown, arg: unknown = Arg): void => {
  // eslint-disable-next-line no-new-func
  for (const setup of setups) new Function('sub', 'Arg', setup)(sub, arg)
}

/**
 * Follows the "check that substitute" remedy of a hint: the check it names (`sub.users.where({ id: 1 }).limit(1)
 * .received(1).exec(...)`), made on `sub` with `args` in place of the `...`.
 */
const suggestedCheck = (hint: string, sub: unknown, args: readonly unknown[]): void => {
  const remedy = /To check calls there, check that substitute: (sub.*)\(\.\.\.\)$/.exec(hint)
  if (remedy === null) throw new Error(`no check is suggested: ${hint}`)
  // eslint-disable-next-line no-new-func
  new Function('sub', 'Arg', 'args', `return ${remedy[1]}(...args)`)(sub, Arg, args)
}

test('R15-ADV-6 (E108) the finding, case 1: a query builder reached through a property names the substitute the member was called on, and checking it passes', t => {
  const run = (db: any) => db.users.where({ id: 1 }).limit(1).exec()
  const db = Substitute.for<any>()
  run(db)

  const hint = hintOf(failureOf(t, () => db.received(1).exec()))
  t.is(hint, 'exec was not called on @Substitute itself, but on a substitute further down: @Substitute.users.where({ id: 1 }).limit(1).exec(...). ' +
    'To check calls there, check that substitute: sub.users.where({ id: 1 }).limit(1).received(1).exec(...)')
  // following it: the check it names passes (the first step below the checked substitute was named before, and failed)
  t.notThrows(() => suggestedCheck(hint, db, []))
  t.notThrows(() => db.users.where({ id: 1 }).limit(1).received(1).exec())
  t.throws(() => db.users.received(1).exec(), { instanceOf: SubstituteException })

  // the check one level down names both methods on the way; following that remedy makes that check pass
  const users = hintOf(failureOf(t, () => db.users.received(1).exec()))
  t.is(users, 'exec was not called on @Substitute.users itself, but on a substitute further down: @Substitute.users.where({ id: 1 }).limit(1).exec(...). ' +
    'A call that is not configured answers a new substitute. For a fluent API, make each method on the way return the substitute ' +
    '(sub.users.where(Arg.all()).returns(sub.users) and sub.users.limit(Arg.all()).returns(sub.users)) or mimick an instance whose methods return this.')
  const fixed = Substitute.for<any>()
  applySetups(suggestedSetups(users), fixed)
  run(fixed)
  t.notThrows(() => fixed.users.received(1).exec())
  // and so does the other remedy: a mimicked instance whose methods return this (E76)
  class Query { where(): this { return this } limit(): this { return this } exec(): unknown[] { return [] } }
  const mimicked = Substitute.for<any>()
  mimicked.users[mimick](new Query())
  run(mimicked)
  t.notThrows(() => mimicked.users.received(1).exec())
})

test('R15-ADV-6 (E108) the finding, case 2: a fastify reply names every fluent method on the way, and following the remedy makes the check pass', t => {
  const handler = (reply: any) => reply.code(404).header('content-type', 'application/json').send({ error: 'not found' })
  const reply = Substitute.for<any>()
  handler(reply)

  const hint = hintOf(failureOf(t, () => reply.received(1).send({ error: 'not found' })))
  t.is(hint, "send was not called on @Substitute itself, but on a substitute further down: @Substitute.code(404).header('content-type', 'application/json').send(...). " +
    'A call that is not configured answers a new substitute. For a fluent API, make each method on the way return the substitute ' +
    '(sub.code(Arg.all()).returns(sub) and sub.header(Arg.all()).returns(sub)) or mimick an instance whose methods return this.')
  t.deepEqual(suggestedSetups(hint), ['sub.code(Arg.all()).returns(sub)', 'sub.header(Arg.all()).returns(sub)'])

  // following it
  const fixed = Substitute.for<any>()
  applySetups(suggestedSetups(hint), fixed)
  handler(fixed)
  t.notThrows(() => fixed.received(1).send({ error: 'not found' }))
  // following only the first of them (the remedy before round 16) leaves the check failing, and names the other one
  const half = Substitute.for<any>()
  half.code(Arg.all()).returns(half)
  handler(half)
  const rest = hintOf(failureOf(t, () => half.received(1).send({ error: 'not found' })))
  t.deepEqual(suggestedSetups(rest), ['sub.header(Arg.all()).returns(sub)'])
  // the other remedy
  class Reply { code(): this { return this } header(): this { return this } send(): this { return this } }
  const mimicked = Substitute.for<any>()
  mimicked[mimick](new Reply())
  handler(mimicked)
  t.notThrows(() => mimicked.received(1).send({ error: 'not found' }))
})

test('R15-ADV-6 (E108) OpenTelemetry span chains: each method once, from the top; more than three are summed up', t => {
  const traced = (span: any) => span.setAttribute('http.method', 'GET').setAttribute('http.status_code', 500).setStatus({ code: 2 }).recordException(new Error('x')).end()
  const span = Substitute.for<any>()
  traced(span)
  const hint = hintOf(failureOf(t, () => span.received(1).end()))
  t.true(hint.endsWith('For a fluent API, make each method on the way return the substitute (sub.setAttribute(Arg.all()).returns(sub), ' +
    'sub.setStatus(Arg.all()).returns(sub) and sub.recordException(Arg.all()).returns(sub)) or mimick an instance whose methods return this.'), hint)
  const fixed = Substitute.for<any>()
  applySetups(suggestedSetups(hint), fixed)
  traced(fixed)
  t.notThrows(() => fixed.received(1).end())
  t.notThrows(() => fixed.received(2).setAttribute(Arg.all()))

  // a query builder with five methods on the way: three are named, and the others are summed up
  const build = (knex: any) => knex.select('id').from('users').where({ active: true }).orderBy('id').limit(10).first()
  const knex = Substitute.for<any>()
  build(knex)
  const long = hintOf(failureOf(t, () => knex.received(1).first()))
  t.true(long.endsWith('make each method on the way return the substitute (sub.select(Arg.all()).returns(sub), sub.from(Arg.all()).returns(sub), ' +
    'sub.where(Arg.all()).returns(sub) and likewise for the 2 other methods on the way) or mimick an instance whose methods return this.'), long)
  const all = Substitute.for<any>()
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) all[method](Arg.all()).returns(all)
  build(all)
  t.notThrows(() => all.received(1).first())

  // a direct call on the way: the setup of the substitute's own calls
  const fn = Substitute.for<any>()
  fn.code(404)('x').send(1)
  const direct = hintOf(failureOf(t, () => fn.received(1).send(1)))
  t.deepEqual(suggestedSetups(direct), ['sub.code(Arg.all()).returns(sub)', 'sub(Arg.all()).returns(sub)'], direct)
  const callable = Substitute.for<any>()
  applySetups(suggestedSetups(direct), callable)
  callable.code(404)('x').send(1)
  t.notThrows(() => callable.received(1).send(1))
})

test('R15-ADV-6 (E108) a member read on the way: the check of the substitute the member was called on, by its whole path', t => {
  // a call, then a member read: making the method return the substitute would not bring the calls back to it
  const respond = (res: any) => res.status(500).body.send('failed')
  const res = Substitute.for<any>()
  respond(res)
  const hint = hintOf(failureOf(t, () => res.received(1).send('failed')))
  t.true(hint.endsWith("To check calls there, check that substitute: sub.status(500).body.received(1).send(...)"), hint)
  t.notThrows(() => suggestedCheck(hint, res, ['failed']))

  // reads only, two of them: the whole path (the step below the checked substitute was named before)
  const app = Substitute.for<any>()
  app.services.logger.info('ready')
  const info = hintOf(failureOf(t, () => app.received(1).info('ready')))
  t.true(info.endsWith('To check calls there, check that substitute: sub.services.logger.received(1).info(...)'), info)
  t.notThrows(() => suggestedCheck(info, app, ['ready']))
  // and one: as before
  const one = Substitute.for<any>()
  one.logger.info('ready')
  t.true(hintOf(failureOf(t, () => one[received]().info('ready'))).endsWith('check that substitute: sub.logger.received().info(...)'))

  // a loop: the first place named is the one the remedy is for
  const s = Substitute.for<any>()
  for (let index = 0; index < 4; index++) s.a(index).b.c(index).go(index)
  const loop = hintOf(failureOf(t, () => s.received(1).go(0)))
  t.true(loop.endsWith('and more. To check calls there, check that substitute: sub.a(0).b.c(0).received(1).go(...)'), loop)
  t.notThrows(() => suggestedCheck(loop, s, [0]))
})

test('R15-ADV-6 (E108) a check through a call with matchers, and two copies of the package: the remedies work there, too', t => {
  // a check through a call with matchers (E81): the remedy is for the substitute that the matching call answered
  const bus = Substitute.for<any>()
  const onSaved = (): void => undefined
  bus.on('saved', onSaved).off().done()
  const through = hintOf(failureOf(t, () => bus.on('saved', Arg.any())[received](1).done()))
  t.true(through.includes('For a fluent API, make the method return the substitute (sub.on(\'saved\', [Function: onSaved]).off(Arg.all()).returns(' +
    'sub.on(\'saved\', [Function: onSaved]))'), through)
  const fixedBus = Substitute.for<any>()
  fixedBus.on('saved', onSaved).off(Arg.all()).returns(fixedBus.on('saved', onSaved))
  fixedBus.on('saved', onSaved).off().done()
  t.notThrows(() => fixedBus.on('saved', Arg.any())[received](1).done())

  // a reply of another copy, checked with the shared symbols: that copy's hint, whose remedy works with this copy's Arg
  const copyB = loadSecondCopy()
  const handler = (reply: any) => reply.code(404).header('x', '1').send(1)
  const reply = copyB.Substitute.for<any>()
  handler(reply)
  const hint = hintOf(errorOf(t, () => reply[received](1).send(1)))
  t.deepEqual(suggestedSetups(hint), ['sub.code(Arg.all()).returns(sub)', 'sub.header(Arg.all()).returns(sub)'], hint)
  for (const arg of [Arg, copyB.Arg]) {
    const fixed = copyB.Substitute.for<any>()
    applySetups(suggestedSetups(hint), fixed, arg)
    handler(fixed)
    t.notThrows(() => fixed[received](1).send(1))
  }
})

test('R15-ADV-6 (E108) the remedy of one step is worded as before', t => {
  const reply = Substitute.for<any>()
  reply.code(404).send(1)
  t.is(withoutSites(failureOf(t, () => reply.received(1).send(1))), [
    'Call count mismatch in @Substitute.send:',
    'Expected to receive 1 property read or method call matching send, but received none.',
    'send was not called on @Substitute itself, but on a substitute further down: @Substitute.code(404).send(...). ' +
    'A call that is not configured answers a new substitute. For a fluent API, make the method return the substitute ' +
    '(sub.code(Arg.all()).returns(sub)) or mimick an instance whose methods return this.',
    ''
  ].join('\n'))
  // the same method twice on the way is named once
  const twice = Substitute.for<any>()
  twice.where(1).where(2).first()
  t.deepEqual(suggestedSetups(hintOf(failureOf(t, () => twice.received(1).first()))), ['sub.where(Arg.all()).returns(sub)'])
})

// ---- E99-labels (R15FE-5): records on a substitute shared by a setup with matchers ----------------------------------

/** The listed records of a message (its lines starting with `› `). */
const listedLines = (message: string) => withoutSites(message).split('\n').filter(line => line.startsWith('› '))

/** A Socket.IO-style server whose broadcasts are configured for every room: one substitute answers every io.to(room). */
const broadcasting = () => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  return io
}

test('R15FE-5 (E99-labels) the finding: the records of a substitute that one call was handed out to are shown with that call', t => {
  const io = broadcasting()
  io.to('room-a').emit('message', { text: 'hi' }) // the code under test

  // a check through the call with matchers: the substitute keeps its path, and its records show the room
  t.is(withoutSites(failureOf(t, () => io.to(Arg.any()).received(2).emit('message', Arg.any()))), [
    'Call count mismatch in @Substitute.to(Arg.any{any}).emit:',
    "Expected to receive 2 method calls matching emit('message', Arg.any{any}), but received 1.",
    'All property or method calls to @Substitute.to(Arg.any{any}).emit received so far:',
    "› ✔ @Substitute.to('room-a').emit('message', { text: 'hi' })",
    ''
  ].join('\n'))
  // every form of check
  const expected = ["› ✔ @Substitute.to('room-a').emit('message', { text: 'hi' })"]
  t.deepEqual(listedLines(failureOf(t, () => io.to(Arg.any())[received](3).emit(Arg.all()))), expected)
  t.deepEqual(listedLines(failureOf(t, () => io.to(Arg.any()).didNotReceive().emit('message', Arg.any()))), expected)
  t.deepEqual(listedLines(failureOf(t, () => io.to(Arg.any())[didNotReceive]().emit(Arg.all()))), expected)
  t.deepEqual(listedLines(failureOf(t, () => io.to(Arg.any()).received(1).emit('message', { text: 'bye' }))),
    ["› ✘ @Substitute.to('room-a').emit('message', { text: 'hi' })"])

  // the printout: the received call shows the room, the setup keeps the matchers
  t.is(String(io), [
    '@Substitute {',
    '  received:',
    "    to('room-a')",
    "    to('room-a').emit('message', { text: 'hi' })",
    '  configured:',
    '    to(Arg.any{any}).emit(Arg.all{}) => returns(true)',
    '}'
  ].join('\n'))
  t.is(inspect(io), String(io))

  // the fluent-chain hint names it with the room, and its remedy checks it there (E108: a call with matchers on the way)
  const hint = hintOf(failureOf(t, () => io.received(1).emit('message', Arg.any())))
  t.is(hint, "emit was not called on @Substitute itself, but on a substitute further down: @Substitute.to('room-a').emit(...). " +
    "To check calls there, check that substitute: sub.to('room-a').received(1).emit(...)")
  t.notThrows(() => suggestedCheck(hint, io, ['message', { text: 'hi' }]))
})

test('R15FE-5 (E99-labels) equal calls count as one; calls with other arguments keep the matchers and get a line under the listing', t => {
  const io = broadcasting()
  io.to('room-a').emit('message', 1)
  io.to('room-a').emit('message', 2)
  t.deepEqual(listedLines(failureOf(t, () => io.to(Arg.any()).received(1).emit(Arg.all()))), [
    "› ✔ @Substitute.to('room-a').emit('message', 1)",
    "› ✔ @Substitute.to('room-a').emit('message', 2)"
  ])

  io.to('room-b').emit('message', 3)
  const two = withoutSites(failureOf(t, () => io.to(Arg.any()).received(1).emit(Arg.all())))
  t.deepEqual(listedLines(two), [
    "› ✔ @Substitute.to(Arg.any{any}).emit('message', 1)",
    "› ✔ @Substitute.to(Arg.any{any}).emit('message', 2)",
    "› ✔ @Substitute.to(Arg.any{any}).emit('message', 3)"
  ])
  t.true(two.endsWith("\n@Substitute.to(Arg.any{any}) is shared by every call matching it; it was returned to @Substitute.to('room-a') and @Substitute.to('room-b').\n"), two)
  t.true(String(io).includes("    to(Arg.any{any}).emit('message', 3)"), String(io))

  // up to three, then how many more (calls with other arguments than those named: room-d and room-e, not room-a again)
  io.to('room-c').emit('message', 4)
  io.to('room-d').emit('message', 5)
  io.to('room-e').emit('message', 6)
  io.to('room-a').emit('message', 7)
  const many = failureOf(t, () => io.to(Arg.any()).received(1).emit(Arg.all()))
  t.is(many.split('\n').filter(line => line.includes('is shared by')).join('\n'),
    "@Substitute.to(Arg.any{any}) is shared by every call matching it; it was returned to @Substitute.to('room-a'), @Substitute.to('room-b'), " +
    "@Substitute.to('room-c') and 2 more.")
  // nothing listed: no line
  t.false(failureOf(t, () => io.to(Arg.any()).received(1).leave(Arg.all())).includes('is shared by'))
})

test('R15FE-5 (E99-labels) a knex-style function substitute: each shared step is shown with its own call, or named in a line', t => {
  const db = Substitute.for<any>()
  db(Arg.any()).where(Arg.all()).first().resolves({ id: 1 })
  void db('orders').where('id', 1).first() // the code under test
  t.deepEqual(listedLines(failureOf(t, () => db(Arg.any()).where(Arg.all()).received(2).first())), ["› ✔ @Substitute('orders').where('id', 1).first()"])
  t.deepEqual(listedLines(failureOf(t, () => db(Arg.any()).received(2).where(Arg.all()))), ["› ✔ @Substitute('orders').where('id', 1)"])
  t.true(String(db).includes("    ('orders').where('id', 1).first()"), String(db))
  t.true(String(db).includes('    (Arg.any{any}).where(Arg.all{}).first() => resolves({ id: 1 })'), String(db))

  void db('users').where('id', 1).first()
  const message = withoutSites(failureOf(t, () => db(Arg.any()).where(Arg.all()).received(1).first()))
  t.deepEqual(listedLines(message), [
    "› ✔ @Substitute(Arg.any{any}).where('id', 1).first()",
    "› ✔ @Substitute(Arg.any{any}).where('id', 1).first()"
  ])
  t.true(message.includes("\n@Substitute(Arg.any{any}) is shared by every call matching it; it was returned to @Substitute('orders') and @Substitute('users').\n"), message)
  t.is(message.split('\n').filter(line => line.includes('is shared by')).length, 1, message)
})

test('R15FE-5 (E99-labels) handed out through call, apply, bind, stored references, inheriting receivers and new', t => {
  const forms: Array<[string, (io: any) => void]> = [
    ['call', io => io.to.call(null, 'room-a').emit('m')],
    ['apply', io => io.to.apply(undefined, ['room-a']).emit('m')],
    ['bind', io => io.to.bind(io, 'room-a')().emit('m')],
    ['Reflect.apply', io => (Reflect.apply(io.to, io, ['room-a']) as any).emit('m')],
    ['stored reference', io => { const to = io.to; to('room-a').emit('m') }],
    ['inheriting receiver', io => Object.create(io).to('room-a').emit('m')],
    ['new', io => new io.to('room-a').emit('m')]
  ]
  for (const [form, act] of forms) {
    const io = broadcasting()
    act(io)
    t.deepEqual(listedLines(failureOf(t, () => io.to(Arg.any()).received(2).emit('m'), form)), ["› ✔ @Substitute.to('room-a').emit('m')"], form)
    t.true(String(io).includes("    to('room-a').emit('m')"), `${form}: ${String(io)}`)
  }
})

test('R15FE-5 (E99-labels) the calls of the test\'s own checks are no hand-outs, and other substitutes keep their paths', t => {
  const io = broadcasting()
  io.to('room-a').emit('m')
  // a check through another concrete call hands the substitute out to a call that is retracted (D25): it does not count
  try { io.to('room-b').received(3).emit('m') } catch { /* (whatever it counts) */ }
  try { io.to('room-c')[received](3).emit('m') } catch { /* (whatever it counts) */ }
  t.deepEqual(listedLines(failureOf(t, () => io.to(Arg.any()).received(2).emit('m'))), ["› ✔ @Substitute.to('room-a').emit('m')"])

  // unconfigured calls, literal nested setups and configured substitutes are shown as before
  const api = Substitute.for<any>()
  api.users('a').list()
  api.users('b').list()
  api.repo('x').find(Arg.all()).returns(1)
  api.repo('x').find(1)
  const own = Substitute.for<any>()
  api.client(Arg.any()).returns(own)
  api.client('y').get(1)
  t.deepEqual(listedLines(failureOf(t, () => api.users('a').received(2).list())), ["› ✔ @Substitute.users('a').list()"])
  t.deepEqual(listedLines(failureOf(t, () => api.repo('x').received(2).find(1))), ["› ✔ @Substitute.repo('x').find(1)"])
  t.deepEqual(listedLines(failureOf(t, () => own.received(2).get(1))), ['› ✔ @Substitute.get(1)'])

  // a setup with matchers that no call has used yet: its substitute has no records to show
  const idle = broadcasting()
  t.deepEqual(listedLines(failureOf(t, () => idle.to(Arg.any()).received(1).emit('m'))), [])
})

test('R15FE-5 (E99-labels) a report that is thrown later shows the room as well', t => {
  const clock = interceptDeferredReports()
  try {
    const io = broadcasting()
    io.to('room-a').emit('m')
    void io.to(Arg.any())[received](2).emit // a property-style check of a member that was only called: deferred (D9)
    const reports = clock.run().map(error => plain((error as Error).message))
    t.is(reports.length, 1)
    t.deepEqual(listedLines(reports[0]), ["› ✘ @Substitute.to('room-a').emit('m')"])
  } finally {
    clock.uninstall()
  }
})
