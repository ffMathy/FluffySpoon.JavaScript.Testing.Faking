import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg, configure, mimick, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 7: the behaviour findings of the fresh-eyes review of round 6 (R6FE-*), decided in the fix spec as E22-E28.

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

// ---- E27: __esModule -------------------------------------------------------------------------

/** TypeScript's __importDefault (esModuleInterop), as compiled code under test runs it. */
const importDefault = (mod: any) => (mod && mod.__esModule) ? mod : { default: mod }

test('R6FE-6 (E27) __esModule is a protocol key: an unconfigured read is undefined and is not recorded', t => {
  const mailer = Substitute.for<any>()
  mailer.send('a@b.c', 'hi').returns(true)

  t.is(mailer.__esModule, undefined)
  const imported = importDefault(mailer)
  t.is(imported.default, mailer, 'the substitute is its own default export')
  t.true(imported.default.send('a@b.c', 'hi'))
  t.false(inspect(mailer).includes('__esModule'), 'the probes are not recorded')
  t.notThrows(() => mailer.didNotReceive().__esModule)
  t.notThrows(() => mailer.received(1).send('a@b.c', 'hi'))
})

test('R6FE-6 (E27) __esModule can still be configured through [configure]() and [mimick]', t => {
  const configured = Substitute.for<any>()
  configured[configure]().__esModule.returns(true)
  t.true(configured.__esModule)
  t.is(importDefault(configured), configured)

  const mimicking = Substitute.for<any>()
  mimicking[mimick]({ __esModule: true, default: 'the default export' })
  t.true(mimicking.__esModule)
  t.is(importDefault(mimicking).default, 'the default export')
})

// ---- E28: runtime validation for JavaScript users ---------------------------------------------

test('R6FE-5 (E28) Arg.any and Arg.any.not throw a TypeError for an unknown type name', t => {
  const any = Arg.any as unknown as (type?: unknown) => unknown
  const anyNot = Arg.any.not as unknown as (type?: unknown) => unknown
  for (const type of ['strnig', 'String', 'Object', 'nul', 'null', '', 5, null, {}]) {
    const error = t.throws(() => any(type), { instanceOf: TypeError }, String(type))
    t.regex(error.message, /^Arg\.any expects one of 'any', 'string', 'number', 'boolean', 'symbol', 'undefined', 'object', 'function', 'array', 'bigint' \(or no argument for 'any'\), but received /)
    const notError = t.throws(() => anyNot(type), { instanceOf: TypeError }, String(type))
    t.regex(notError.message, /^Arg\.any\.not expects one of /)
  }
  t.regex(t.throws(() => any('strnig')).message, /but received 'strnig'\.$/)

  // the documented names, 'bigint' and no argument keep working
  for (const type of ['any', 'string', 'number', 'boolean', 'symbol', 'undefined', 'object', 'function', 'array', 'bigint', undefined]) {
    t.notThrows(() => any(type), String(type))
    t.notThrows(() => anyNot(type), String(type))
  }
  const sub = Substitute.for<any>()
  sub.big(Arg.any('bigint' as any)).returns('a bigint')
  sub.big(Arg.any.not('bigint' as any)).returns('no bigint')
  t.is(sub.big(BigInt(1)), 'a bigint')
  t.is(sub.big(1), 'no bigint')

  // the probe of the finding: Arg.any.not('nul') used to match everything, null included
  const save = Substitute.for<any>()
  t.throws(() => save.save(anyNot('nul')).returns('not null'), { instanceOf: TypeError })
})

test('R6FE-5 (E28) mimicks() without a function throws a TypeError at the setup, naming the member', t => {
  const service = Substitute.for<any>()
  const callError = t.throws(() => service.m(1).mimicks('not a function'), { instanceOf: TypeError })
  t.is(callError.message, "mimicks() expects a function to call for @Substitute.m(1), but received 'not a function'.")
  t.regex(callError.stack!.split('\n')[1], /round7\.test\.[jt]s/, 'the stack starts at the setup')

  const propertyError = t.throws(() => service.config.mimicks({ port: 1 }), { instanceOf: TypeError })
  t.is(propertyError.message, 'mimicks() expects a function to call for @Substitute.config, but received { port: 1 }.')
  t.throws(() => service.nested.child(Arg.any()).mimicks(42), { instanceOf: TypeError, message: /for @Substitute\.nested\.child\(Arg\.any\{any\}\), but received 42\./ })
  t.throws(() => service[configure]().m(2).mimicks(), { instanceOf: TypeError, message: /for @Substitute\.m\(2\), but received no argument\./ })
  t.throws(() => service[configure]().p.mimicks(null), { instanceOf: TypeError, message: /for @Substitute\.p, but received null\./ })
  t.throws(() => service.seq(1).mimicks(() => 1, 'two'), { instanceOf: TypeError, message: /but received 'two'\./ })
  const fn = Substitute.for<any>()
  t.throws(() => fn('x').mimicks(undefined), { instanceOf: TypeError, message: /for @Substitute\('x'\), but received undefined\./ })

  // nothing was configured by the refused setups, and the code under test is not reached with a broken setup
  t.is(typeof service.m(1), 'function', 'm(1) still returns its auto-substitute')
  t.notThrows(() => service.received(1).m(1))

  // functions (substitutes included) are accepted
  service.ok(1).mimicks((x: number) => x + 1)
  t.is(service.ok(1), 2)
  const delegate = Substitute.for<any>()
  delegate(1).returns('from a substitute')
  service.viaSubstitute(1).mimicks(delegate)
  t.is(service.viaSubstitute(1), 'from a substitute')
})

// ---- E22: omitted trailing arguments ----------------------------------------------------------

interface Users {
  find(name?: string): string
  list(page?: number, size?: number): string[]
}
const findAll = (users: Users) => users.find()
const firstPage = (users: Users, options?: { size?: number }) => users.list(1, options?.size)

test('R6FE-2 (E22) an omitted trailing argument matches a literal undefined or a matcher that accepts undefined (the cases of the finding)', t => {
  const byType = Substitute.for<Users>()
  byType.find(Arg.any('undefined')).returns('all users')
  t.is(findAll(byType), 'all users')

  const byAny = Substitute.for<Users>()
  byAny.find(Arg.any()).returns('anything')
  t.is(findAll(byAny), 'anything')

  const checked = Substitute.for<Users>()
  firstPage(checked)
  t.notThrows(() => checked.received(1).list(1))
  t.notThrows(() => checked.received(1).list(1, undefined))
  t.notThrows(() => checked.received(1).list(1, Arg.any()))
  t.notThrows(() => (checked.received(1) as any).list(Arg.any(), Arg.any(), Arg.any()))

  const configured = Substitute.for<Users>()
  configured.list(1).returns(['a'])
  t.deepEqual(firstPage(configured), ['a'])
  t.deepEqual(firstPage(configured, { size: undefined }), ['a'])
})

test('R6FE-2 (E22) both directions, with literals and matchers, in setups and checks', t => {
  const c = Substitute.for<any>()
  c.set('a', 1)
  t.notThrows(() => c.received(1).set('a', 1, undefined))
  t.notThrows(() => c.received(1).set('a', 1, Arg.any()))
  t.notThrows(() => c.received(1).set('a', 1, Arg.any('undefined')))
  t.notThrows(() => c.received(1).set('a', 1, Arg.is((value: unknown) => value === undefined)))
  t.notThrows(() => c.received(1).set('a', 1, Arg.any.not('number')))
  t.notThrows(() => c.received(1).set('a', 1, undefined, undefined))
  // matchers that do not accept undefined, and other values, do not match an omitted argument
  t.notThrows(() => c.didNotReceive().set('a', 1, Arg.any('number')))
  t.notThrows(() => c.didNotReceive().set('a', 1, Arg.any.not('undefined')))
  t.notThrows(() => c.didNotReceive().set('a', 1, Arg.is((value: number) => value > 0)))
  t.notThrows(() => c.didNotReceive().set('a', 1, null))
  t.notThrows(() => c.didNotReceive().set('a', 1, 2))
  t.notThrows(() => c.didNotReceive().set('a'), 'a missing argument is not a match for a value the call has')

  c.put('a', 1, undefined)
  t.notThrows(() => c.received(1).put('a', 1))
  t.notThrows(() => c.received(1).put('a', Arg.any()))
  t.notThrows(() => c.didNotReceive().put('a', 1, 2))

  c.get('k', undefined).returns('v')
  t.is(c.get('k'), 'v')
  c.get2('k').returns('v2')
  t.is(c.get2('k', undefined), 'v2')
  t.is(c.get2('k', undefined, undefined), 'v2')
  c.get3('k', Arg.any()).returns('v3')
  t.is(c.get3('k'), 'v3')
  c.get4('k', Arg.any('number')).returns('v4')
  t.is(typeof c.get4('k'), 'function', 'a matcher that rejects undefined does not answer the shorter call')
  t.is(c.get4('k', 4), 'v4')
})

test('R6FE-2 (E22) the number of arguments still separates f(1) from f(1, 2), and Arg.all() is unchanged', t => {
  const f = Substitute.for<any>()
  f.one(1).returns('one')
  f.two(1, 2).returns('two')
  t.is(typeof f.one(1, 2), 'function')
  t.is(typeof f.two(1), 'function')
  t.is(typeof f.two(1, undefined), 'function')
  t.is(f.two(1, 2, undefined), 'two')
  t.notThrows(() => f.didNotReceive().one(1))
  t.notThrows(() => f.received(1).one(1, 2))
  t.notThrows(() => f.received(1).two(1, 2), 'two(1, 2, undefined) is two(1, 2)')
  t.notThrows(() => f.received(2).two(1), 'two(1) and two(1, undefined)')

  const log = Substitute.for<any>()
  log.log('x', Arg.all()).returns('logged')
  t.is(log.log('x'), 'logged')
  t.is(log.log('x', 1, 2), 'logged')
  t.is(typeof log.log(), 'function', 'the arguments before Arg.all() must match: a missing one is undefined')
  log.any(Arg.all()).returns('all')
  t.is(log.any(), 'all')
  t.is(log.any(undefined, 1), 'all')
  t.notThrows(() => log.received(1).log())
  t.notThrows(() => log.received(3).log(Arg.all()))
})

test('R6FE-2 (E22) received(n) and didNotReceive count calls with and without the trailing undefined, and messages show them as made', t => {
  const sub = Substitute.for<any>()
  sub.f(1)
  sub.f(1, undefined)
  sub.f()
  sub.f(undefined)
  t.notThrows(() => sub.received(2).f(1))
  t.notThrows(() => sub.received(2).f(1, undefined))
  t.notThrows(() => sub.received(2).f())
  t.notThrows(() => sub.received(2).f(undefined))
  t.notThrows(() => sub.received(4).f(Arg.any()), 'f() and f(undefined) included')
  t.notThrows(() => sub.received(2).f(Arg.any('number')))
  const message = messageOf(() => sub.didNotReceive().f(1))
  t.true(message.includes('Expected to receive 0 method calls matching f(1), but received 2.'))
  t.true(message.includes('› ✔ @Substitute.f(1)\n'))
  t.true(message.includes('› ✔ @Substitute.f(1, undefined)\n'))
  t.true(message.includes('› ✘ @Substitute.f()\n'))
  t.true(message.includes('› ✘ @Substitute.f(undefined)\n'))
  t.true(messageOf(() => sub.didNotReceive().f(Arg.any())).includes('but received 4.'), 'Arg.any() also matches f()')
})

test('R6FE-2 (E22) the literal-setup index, re-configuration and the auto-substitute cache agree', t => {
  const sub = Substitute.for<any>()
  const request = { id: 1 }
  sub.fetch(request).returns('by identity')
  t.is(sub.fetch(request, undefined), 'by identity')
  t.is(sub.fetch({ id: 1 }, undefined), 'by identity', 'by the structural hash')
  sub.load({ id: 2 }, undefined, undefined).returns('loaded')
  t.is(sub.load({ id: 2 }), 'loaded')
  for (let index = 0; index < 200; index++) sub.many(index, undefined).returns(index)
  t.is(sub.many(150), 150)

  // the same specification: the later setup replaces the earlier one
  sub.again(1).returns('first')
  sub[configure]().again(1, undefined).returns('second')
  t.is(sub.again(1), 'second')
  t.is(inspect(sub).split('again(').length - 1, 2, 'one call and one setup of again')

  // one auto-substitute for f(1) and f(1, undefined)
  t.is(sub.child(1), sub.child(1, undefined))
  sub.child(1).name.returns('ann')
  t.is(sub.child(1, undefined).name, 'ann')
  t.not(sub.child(1), sub.child(1, 2))
})
