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
