import test, { ExecutionContext } from 'ava'
import * as path from 'path'

import { Substitute, Arg, mimick, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

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
