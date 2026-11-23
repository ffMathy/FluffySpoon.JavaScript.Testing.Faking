import test, { ExecutionContext, ThrowsExpectation } from 'ava'
import { interceptDeferredReports } from '../../helpers/deferredReports'
import { EventEmitter } from 'events'
import * as path from 'path'
import { inspect, types } from 'util'

import * as library from '../../../src'
import { Substitute, Arg, received, didNotReceive, configure, mimick, clearReceivedCalls, returns, throws, mimicks } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

/*
 * Behavioural tests ported unchanged from the other round-1 engine (branch fix/engine-a,
 * spec/regression/fixes/{decisions,runtime,arguments,regression}.spec.ts). Their bodies are kept as they were
 * written there; only the tests that add coverage to spec/regression/fixes/*.test.ts are ported.
 *
 * Left out as duplicates (everything they check is covered by the named tests):
 * - D16, D17, A:RT-11: decisions.test.ts D16 / D17 and arguments.test.ts A:RT-11
 * - R:RT-4 'symbol assertions on members named like substitution methods': runtime.test.ts R:RT-4, regression.test.ts G:RG-1
 * - R:RT-7, R:RT-9: runtime.test.ts R:RT-7 / R:RT-9
 * - A:RT-1, A:RT-2, A:RT-7, A:DOC-1: arguments.test.ts, runtime.test.ts R:RT-6, regression.test.ts G:RG-2
 * - A:RT-10: arguments.test.ts A:RT-10 (the same behaviour; engine A words the note differently)
 * - A:RT-14: arguments.test.ts A:RT-14 and amendments.test.ts D24
 * - G:RG-2, G:RG-7: regression.test.ts G:RG-2 / G:RG-7
 * The tests that depend on engine A's wording are ported, with this engine's wording, in ported-from-a-messages.spec.ts.
 */

const plain = (message: string) => message.replace(/\x1b\[\d+m/g, '')
// runtime behaviour only: the substitutes are untyped so that the specs do not depend on the typings
const substitute = <T = unknown>(): any => Substitute.for<T>()

const throwsOnNextTick = (cb: () => unknown, t: ExecutionContext, expectation: ThrowsExpectation<Error>) => {
  const clock = interceptDeferredReports()
  try {
    cb()
    t.throws(() => clock.tick(1), expectation)
  } finally {
    clock.uninstall()
  }
}

const doesNotThrowOnNextTick = (cb: () => unknown, t: ExecutionContext) => {
  const clock = interceptDeferredReports()
  try {
    cb()
    t.notThrows(() => clock.tick(1))
  } finally {
    clock.uninstall()
  }
}

interface Logger {
  log(message: string, ...meta: unknown[]): void
  level: number
}

interface Config {
  token: string
  flaky: string
  computed: number
  ready: Promise<void>
}

interface User { name: string }
interface Repository {
  find(id: number): User
  remove(id: number): void
  add(a: number, b: number): number
  sequence(id: number): number
}

interface Shop {
  returns(orderId: number): void
  rejects(orderId: number): void
  throws(code: number): void
  add(a: number, b: number): number
}

interface Counter { total: number }
interface Mailbox {
  getStats(): { received: Counter, sent: Counter }
  inbox: { received: Counter, didNotReceive: Counter }
  received: Date
}

interface Calculator { add(a: number, b: number): number }

interface Handler { onClick(x: number): void }

test('D2 repeated access to the same member path with matching arguments returns the same auto-substitute', t => {
  const app = substitute()
  t.is(app.logger, app.logger)
  t.is(app.getCalc(), app.getCalc())
  t.is(app.find({ id: 1, tags: ['a'] }), app.find({ tags: ['a'], id: 1 }))
  t.is(app.a.b(1).c, app.a.b(1).c)
  t.not(app.getCalc(1), app.getCalc(2))
  t.not(app.getCalc(0), app.getCalc(-0))
  t.not(app.getCalc(1), app.getCalc('1'))
  t.not(app.find({ id: 1 }), app.find({ id: 2 }))

  // substitutes as arguments compare by identity
  const first = substitute()
  const second = substitute()
  t.is(app.use(first), app.use(first))
  t.not(app.use(first), app.use(second))

  // the same holds for many distinct arguments
  const results = Array.from({ length: 50 }, (_, index) => app.item(index))
  t.true(results.every((result, index) => result === app.item(index)))
})

test('D2 nested setups and nested assertions work at runtime', t => {
  const app = substitute()
  app.getCalc().add(1, 2).returns(99)
  app.config.retries.returns(3)
  app.logger.info('hi')

  t.is(app.getCalc().add(1, 2), 99)
  t.true(types.isProxy(app.getCalc().add(2, 2)))
  t.is(app.config.retries, 3)

  t.notThrows(() => app.logger.received().info('hi'))
  t.throws(() => app.logger.received().info('bye'), { instanceOf: SubstituteException })
  t.notThrows(() => app.getCalc().received(1).add(1, 2))
  t.notThrows(() => app.getCalc().didNotReceive().add(2, 3))

  // the setup and assertion chains are not received calls (getCalc() was called twice above)
  t.notThrows(() => app.received(2).getCalc())
  t.notThrows(() => app.received(1).config)
  t.notThrows(() => app.received(1).logger)
  t.notThrows(() => app.config.received(1).retries)
})

test('D2 a setup or call on the root never leaks into a nested member with the same name, and vice versa', t => {
  const app = substitute()
  app.add(1, 2).returns(99)
  app.nested.add(1, 2).returns(5)
  app.add(1, 2)
  app.nested.add(1, 2)
  app.nested.add(1, 2)

  t.is(app.add(1, 2), 99)
  t.is(app.nested.add(1, 2), 5)
  t.notThrows(() => app.received(2).add(1, 2))
  t.notThrows(() => app.nested.received(3).add(1, 2))
  t.true(types.isProxy(app.other.add(1, 2)))
})

test('D3 calls with Arg matchers are setups: never executed and never recorded', t => {
  const calculator = substitute()
  let calls = 0
  calculator.add(Arg.all()).mimicks(() => ++calls)
  calculator.add(Arg.any(), Arg.is(() => true)).returns(1)
  calculator.add(Arg.any.not('string'), 1)
  t.is(calls, 0)
  t.notThrows(() => calculator.didNotReceive().add(Arg.all()))

  t.is(calculator.add(1, 1), 1)
  t.is(calculator.add(1, 2, 3), 1)
  t.is(calls, 1)
  t.notThrows(() => calculator.received(2).add(Arg.all()))

  // a literal in a setup never matches an Arg passed by a later call
  const strict = substitute()
  strict.find(1).returns('one')
  t.true(types.isProxy(strict.find(Arg.any())))
  strict.value = Arg.any()
  t.notThrows(() => strict.didNotReceive().value = Arg.any())
})

test('D4 the most specific substitution wins, then the most recently configured one', t => {
  const calculator = substitute()
  calculator.add(1, 2).returns('literal')
  calculator.add(Arg.any(), 2).returns('predicate')
  calculator.add(Arg.all()).returns('wildcard')
  t.is(calculator.add(1, 2), 'literal')
  t.is(calculator.add(5, 2), 'predicate')
  t.is(calculator.add(5, 5), 'wildcard')

  calculator.add(Arg.any(), Arg.any()).returns('newer predicate')
  t.is(calculator.add(1, 2), 'literal')
  t.is(calculator.add(5, 2), 'newer predicate')
  calculator[configure]().add(1, 2).returns('newer literal')
  t.is(calculator.add(1, 2), 'newer literal')
  calculator.add(Arg.all()).returns('newer wildcard')
  t.is(calculator.add(5, 5, 5), 'newer wildcard')
  t.is(calculator.add(5, 5), 'newer predicate')

  calculator.value.returns(1)
  calculator[configure]().value.returns(2)
  t.is(calculator.value, 2)
})

test('D5 configure() is a view in which every call is a setup', t => {
  const calculator = substitute()
  let mimickCalls = 0
  calculator.add(Arg.all()).mimicks(() => ++mimickCalls)
  calculator.divide(Arg.any(), 0).throws(new Error('division by zero'))
  calculator.enabled.returns(false)

  calculator[configure]().add(1, 3).returns(1337)
  calculator[configure]().divide(0, 0).returns(NaN)
  calculator[configure]().enabled.returns(true)
  calculator[configure]().enabled[returns](true)
  calculator[configure]().multiply(2, 2)[mimicks]((a: number, b: number) => a * b)
  calculator[configure]().fail()[throws](new Error('fail'))
  t.is(mimickCalls, 0)

  t.is(calculator.add(1, 3), 1337)
  t.is(calculator.add(1, 4), 1)
  t.true(Number.isNaN(calculator.divide(0, 0)))
  t.throws(() => calculator.divide(1, 0), { message: 'division by zero' })
  t.true(calculator.enabled)
  t.is(calculator.multiply(2, 2), 4)
  t.throws(() => calculator.fail(), { message: 'fail' })

  // configuring is never recorded
  t.notThrows(() => calculator.received(1).add(1, 3))
  t.notThrows(() => calculator.received(1).divide(0, 0))
  t.notThrows(() => calculator.received(1).enabled)

  // nested members, calls of returned functions and the substitute itself
  const app = substitute()
  app[configure]().services.getRepository('users').find(1).returns('alice')
  t.notThrows(() => app.didNotReceive().services)
  t.is(app.services.getRepository('users').find(1), 'alice')
  app[configure]().factory()(2).returns('two')
  t.is(app.factory()(2), 'two')
  const fn = substitute()
  fn[configure]()(1).returns('one')
  t.is(fn(1), 'one')
  t.notThrows(() => app.received(1).services)

  t.throws(() => { calculator[configure]().value = 1 }, { instanceOf: SubstituteException })
})

test('D5 without configure() a literal call matching a substitution keeps returning the configured value', t => {
  const repository = substitute<Repository>()
  repository.add(Arg.all()).returns(10)

  t.throws(() => (repository.add(1, 3) as any).returns(1337), { instanceOf: TypeError })
  t.is(repository.add(1, 3), 10)
})

test('D6 assertions never execute substitutions or mimicks and are never recorded', t => {
  const calculator = substitute()
  let calls = 0
  calculator.add(Arg.all()).mimicks(() => ++calls)
  calculator.value.mimicks(() => ++calls)
  calculator.broken.throws(new Error('broken'))

  calculator.add(1, 2)
  void calculator.value
  t.is(calls, 2)

  calculator.received(1).add(1, 2)
  calculator[received](1).add(Arg.any(), Arg.any())
  calculator.didNotReceive().add(2, 2)
  calculator.received(1).value
  calculator[didNotReceive]().broken
  t.is(calls, 2)

  t.notThrows(() => calculator.received(1).add(1, 2))
  t.notThrows(() => calculator.received(1).value)
  t.notThrows(() => calculator.didNotReceive().received)
  t.notThrows(() => calculator.didNotReceive().didNotReceive)
})

test('D7 each invocation is its own record, also through stored references, callbacks and call/apply/bind', t => {
  const logger = substitute()
  logger.log(Arg.all()).returns('logged')
  const log = logger.log
  const bound = logger.log.bind(logger)

  t.is(log(1), 'logged')
  t.is(log(2), 'logged')
  t.is(bound(3), 'logged')
  t.is(logger.log.call(null, 4), 'logged')
  t.is(logger.log.apply(null, [5]), 'logged')
  t.deepEqual([6, 7].map(logger.log), ['logged', 'logged'])

  t.notThrows(() => logger.received(7).log(Arg.all()))
  for (const value of [1, 2, 3, 4, 5]) t.notThrows(() => logger.received(1).log(value))
  t.notThrows(() => logger.received(1).log(6, 0, [6, 7]))
  // every read of `log` above was followed by invocations: none of them is a property read. Since D33 (round 3) the
  // property-style received(0).log on a member that was only invoked is reported later, and the report says so.
  throwsOnNextTick(() => logger.received(0).log, t, {
    instanceOf: SubstituteException,
    message: /but received 7 method calls\. log was called 7 times as a method/
  })

  const guard = substitute()
  if (guard.onDone) guard.onDone(1)
  const stored = guard.onDone
  void guard.onDone
  stored(2)
  t.notThrows(() => guard.received(2).onDone(Arg.all()))
  t.notThrows(() => guard.received(2).onDone)
})

test('D8 property assertions count reads, set assertions count sets, method assertions count invocations', t => {
  const component = substitute()
  void component.value
  void component.value
  component.value = 1
  component.value(1)

  t.notThrows(() => component.received(2).value)
  t.notThrows(() => { component.received(1).value = 1 })
  t.notThrows(() => component.received(1).value(1))
  t.notThrows(() => component.received(1).value(Arg.all()))
  t.throws(() => component.received(3).value(Arg.all()), { instanceOf: SubstituteException })
})

test('D9 the deferred case is limited to members also invoked as a method, with a count a call could satisfy', t => {
  const component = substitute()
  component.onChange()
  void component.onChange
  void component.onChange

  // property-style: 2 reads, 1 call. received(1) could still be a method assertion that passes
  throwsOnNextTick(() => component.received(1).onChange, t, { instanceOf: SubstituteException })
  doesNotThrowOnNextTick(() => component.received(1).onChange(), t)
  doesNotThrowOnNextTick(() => t.throws(() => component.didNotReceive().onChange(), { instanceOf: SubstituteException }), t)
})

test('D11 the string form followed by a substitution method stays a setup of a member named received', t => {
  const overlapping = substitute()
  overlapping.received(10).returns('foo')
  t.is(overlapping.received(10), 'foo')
  t.notThrows(() => overlapping[received](1).received(10))
  t.throws(() => overlapping.didNotReceive().received(10), { instanceOf: SubstituteException })
})

test('D12 [mimick] delegates unconfigured member reads, calls and sets to the instance', t => {
  class Counter {
    public count = 1
    public get double() { return this.count * 2 }
    public increment(by: number) {
      this.count += by
      return this
    }
  }
  const real = new Counter()
  const counter = substitute<Counter>()
  counter[mimick](real)

  t.is(counter.count, 1)
  // E76 (R12FE-3): a method that returns the instance itself answers the substitute (it still runs on the instance)
  t.is(counter.increment(2), counter)
  t.is(real.count, 3)
  t.is(counter.double, 6)
  counter.count = 10
  t.is(real.count, 10)
  t.is(counter.missing, undefined)

  t.notThrows(() => counter.received(1).increment(2))
  t.notThrows(() => counter.received(1).count)
  t.notThrows(() => { counter.received(1).count = 10 })

  // explicit substitutions take precedence; after mimick, configure() sets them up
  counter[configure]().increment(5).returns('configured')
  counter[configure]().double.returns(-1)
  t.is(counter.increment(5), 'configured')
  t.is(counter.increment(1), counter)
  t.is(counter.double, -1)

  const fn = substitute()
  fn[mimick]((a: number) => a * 3)
  t.is(fn(2), 6)
})

test('D13 clearReceivedCalls clears the received calls of the substitute and its auto-substitutes, not its substitutions', t => {
  const app = substitute()
  app.add(1, 1).returns(2)
  app.value.returns(1, 2, 3)
  app.add(1, 1)
  void app.value
  app.logger.info('x')
  app.getCalc().add(1)

  app[clearReceivedCalls]()

  t.notThrows(() => app.didNotReceive().add(1, 1))
  t.notThrows(() => app.didNotReceive().value)
  t.notThrows(() => app.logger.didNotReceive().info('x'))
  t.notThrows(() => app.getCalc().didNotReceive().add(1))
  t.is(app.add(1, 1), 2)
  t.is(app.value, 2)

  app.logger.info('y')
  app.logger[clearReceivedCalls]()
  t.notThrows(() => app.logger.didNotReceive().info('y'))
  t.notThrows(() => app.received(1).add(1, 1))
})

test('D14 Arg.all() matches any (possibly empty) remainder; arguments before it match normally', t => {
  const logger = substitute()
  logger.log('x')
  logger.log('x', 1, 2)
  logger.log('y', 1)
  logger.log()

  t.notThrows(() => logger.received(2).log('x', Arg.all()))
  t.notThrows(() => logger.received(4).log(Arg.all()))
  // E22 (round 7): log() has an omitted first argument, which Arg.any() matches (an omitted argument is undefined)
  t.notThrows(() => logger.received(4).log(Arg.any(), Arg.all()))
  t.notThrows(() => logger.received(3).log(Arg.any('string'), Arg.all()))
  t.notThrows(() => logger.received(1).log('x', 1, Arg.all()))
  t.notThrows(() => logger.received(0).log('z', Arg.all()))

  logger.format('x', Arg.all()).returns('prefixed')
  t.is(logger.format('x'), 'prefixed')
  t.is(logger.format('x', 1), 'prefixed')
  t.true(types.isProxy(logger.format('y')))

  t.throws(() => logger.log(Arg.all(), 'x'), { instanceOf: SubstituteException })
  t.throws(() => logger.received().log('x', Arg.all(), Arg.all()), { instanceOf: SubstituteException })
})

test('D15 substitutes are compared by identity and never traversed', t => {
  const service = substitute()
  const first = substitute()
  const second = substitute()
  service.register(first)
  service.register({ dependency: first })

  t.notThrows(() => service.received(1).register(first))
  t.throws(() => service.received().register(second), { instanceOf: SubstituteException })
  t.notThrows(() => service.received(1).register({ dependency: first }))
  t.throws(() => service.received().register({ dependency: second }), { instanceOf: SubstituteException })
  // matching did not record anything on the substitutes passed as arguments
  t.is(inspect(first), '@Substitute {\n}')
  t.is(inspect(second), '@Substitute {\n}')
})

test('R:RT-1 every call through a stored method reference is its own call record', t => {
  const logger = substitute<Logger>()
  const { log } = logger
  log('a')
  log('b')

  t.notThrows(() => logger.received(2).log(Arg.any()))
  t.notThrows(() => logger.received(1).log('a'))
  t.notThrows(() => logger.received(1).log('b'))

  const sameArgs = substitute<Logger>()
  const stored = sameArgs.log
  stored('same')
  stored('same')
  t.throws(() => sameArgs.received(1).log('same'), { instanceOf: SubstituteException })
  t.notThrows(() => sameArgs.received(2).log('same'))

  const callback = substitute<Logger>()
  ;['x', 'y', 'z'].forEach(callback.log)
  t.notThrows(() => callback.received(3).log(Arg.all()))
  t.notThrows(() => callback.received(1).log('y', 1, ['x', 'y', 'z']))
})

test('R:RT-2 assertions on configured properties never execute the substitution', async t => {
  const config = substitute<Config>()
  config.token.returns('t1', 't2', 't3')
  config.flaky.throws(new Error('boom'))
  let mimickCalls = 0
  config.computed.mimicks(() => ++mimickCalls)
  config.ready.rejects(new Error('not ready'))

  t.is(config.token, 't1')
  t.notThrows(() => config.received(1).token)
  t.is(config.token, 't2')
  t.is(config.token, 't3')

  t.throws(() => config.flaky, { message: 'boom' })
  t.notThrows(() => config.received(1).flaky)
  t.notThrows(() => config[received](1).flaky)

  const neverRead = substitute<Config>()
  neverRead.flaky.throws(new Error('boom'))
  t.notThrows(() => neverRead.didNotReceive().flaky)

  t.is(config.computed, 1)
  config.received(1).computed
  config.received().computed
  t.is(mimickCalls, 1)

  await t.throwsAsync(config.ready, { message: 'not ready' })
  let unhandled = 0
  const onUnhandled = () => unhandled++
  process.on('unhandledRejection', onUnhandled)
  try {
    config.received(1).ready
    await new Promise(resolve => setTimeout(resolve, 10))
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  t.is(unhandled, 0)
})

test('R:RT-3 configure() overrides a setup whose literal arguments match an existing substitution', t => {
  const anyUser = substitute<User>()
  anyUser.name.returns('any')
  const admin = substitute<User>()
  admin.name.returns('admin')

  const repository = substitute<Repository>()
  repository.find(Arg.any()).returns(anyUser)
  repository[configure]().find(1).returns(admin)
  t.is(repository.find(1).name, 'admin')
  t.is(repository.find(2).name, 'any')

  // the guide "Match order", first example
  repository.add(Arg.all()).returns(10)
  repository[configure]().add(1, 3).returns(1337)
  t.is(repository.add(1, 3), 1337)
  t.is(repository.add(5, 2), 10)

  // a throws() default does not fire while configuring a specific call
  repository.remove(Arg.any()).throws(new Error('forbidden'))
  t.notThrows(() => repository[configure]().remove(1).returns())
  t.is(repository.remove(1), undefined)
  t.throws(() => repository.remove(2), { message: 'forbidden' })

  // a sequence is not used up by configuring
  repository.sequence(Arg.any()).returns(1, 2)
  repository[configure]().sequence(7).returns(70)
  t.is(repository.sequence(1), 1)
  t.is(repository.sequence(7), 70)
  t.is(repository.sequence(1), 2)

  // re-configuring the same call: the most recent setup wins
  const users = substitute<Repository>()
  users.find(5).returns(anyUser)
  t.is(users.find(5), anyUser)
  users[configure]().find(5).returns(admin)
  t.is(users.find(5), admin)

  // configuring is not a call
  t.notThrows(() => users.received(2).find(5))
  t.notThrows(() => repository.received(1).find(1))
  t.notThrows(() => repository.didNotReceive().sequence(7 * 100))
})

test('R:RT-4 symbol substitution methods on a call configure it; on the root they are a usage error', t => {
  const shop = substitute<Shop>()
  ;(shop.add(1, 2) as any)[returns](3)
  ;(shop.add(2, 2) as any)[throws](new Error('nope'))
  t.is(shop.add(1, 2), 3)
  t.throws(() => shop.add(2, 2), { message: 'nope' })
  t.throws(() => (shop as any)[returns](1), { instanceOf: SubstituteException })
})

test('R:RT-5 members named received/didNotReceive that are not invoked are ordinary members', t => {
  const mailbox = substitute<Mailbox>()

  t.true(types.isProxy(mailbox.getStats().sent.total))
  t.true(types.isProxy(mailbox.getStats().received.total))
  t.notThrows(() => { (mailbox.getStats().received as any).total = 3 })
  t.true(types.isProxy(mailbox.inbox.received.total))
  t.true(types.isProxy(mailbox.inbox.didNotReceive.total))
  t.is(typeof mailbox.received.getTime(), 'function')

  t.notThrows(() => mailbox.getStats().received.received(1).total)
  t.throws(() => mailbox.getStats().received.received(2).total, { instanceOf: SubstituteException })
})

test('R:RT-8 / D19 calls, configured reads and configured calls are all counted, and unconfigured calls with equal arguments share an auto-substitute', t => {
  const logger = substitute()
  logger.level.returns(1)
  logger.format(Arg.any()).returns('formatted')

  for (let index = 0; index < 100; index++) logger.log('message', index % 10)
  for (let index = 0; index < 100; index++) void logger.level
  for (let index = 0; index < 100; index++) logger.format(index)

  // unconfigured calls with distinct arguments each get their own (cached) auto-substitute
  const tracker = substitute()
  for (let index = 0; index < 100; index++) tracker.track({ id: index })

  t.notThrows(() => logger.received(100).log('message', Arg.any()))
  t.notThrows(() => logger.received(100).level)
  t.notThrows(() => tracker.received(1).track({ id: 99 }))
  t.is(tracker.track({ id: 5 }), tracker.track({ id: 5 }))
})

test('R:RT-10 reading a method without invoking it is not a method call', t => {
  const handler = substitute<Handler>()
  const button = new EventEmitter()
  button.on('click', handler.onClick)

  t.throws(() => handler.received().onClick(Arg.any()), { instanceOf: SubstituteException })
  t.throws(() => handler.received(1).onClick(42), { instanceOf: SubstituteException })
  t.throws(() => handler.received(1).onClick(), { instanceOf: SubstituteException })

  const twice = substitute<Handler>()
  void twice.onClick
  void twice.onClick
  t.throws(() => twice.received(2).onClick(1), { instanceOf: SubstituteException })
  t.notThrows(() => twice.received(2).onClick)

  button.emit('click', 42)
  t.notThrows(() => handler.received(1).onClick(42))
})

test('R:RT-11 .call, .apply and .bind behave like a direct call', t => {
  const calculator = substitute<Calculator>()
  calculator.add(1, 2).returns(3)

  t.is(calculator.add(1, 2), 3)
  t.is(calculator.add.call(calculator, 1, 2), 3)
  t.is(calculator.add.apply(calculator, [1, 2]), 3)
  t.is(calculator.add.bind(calculator)(1, 2), 3)
  t.is(calculator.add.bind(calculator, 1)(2), 3)
  t.is(Reflect.apply(calculator.add, calculator, [1, 2]), 3)

  t.notThrows(() => calculator.received(6).add(1, 2))
  t.throws(() => calculator.received(1).add(7, 7), { instanceOf: SubstituteException })

  const handler = substitute<{ onX(value: number): void }>()
  const emitter = new EventEmitter()
  emitter.on('x', handler.onX)
  emitter.emit('x', 1)
  t.notThrows(() => handler.received(1).onX(1))
  t.throws(() => handler.received(1).onX(999), { instanceOf: SubstituteException })
  t.notThrows(() => handler.didNotReceive().onX(999))
})

test('R:RT-12 assertion messages are built when Error.stackTraceLimit is 0', t => {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    const calculator = substitute<Calculator>()
    calculator.add(1, 2)
    const { message } = t.throws(() => calculator.received(2).add(1, 2), { instanceOf: SubstituteException })
    t.regex(plain(message), /Call count mismatch in @Substitute\.add/)
    t.throws(() => calculator.received(1).add(9, 9), { instanceOf: SubstituteException })
  } finally {
    Error.stackTraceLimit = limit
  }

  delete (Error as any).stackTraceLimit
  try {
    const calculator = substitute<Calculator>()
    calculator.add(1, 2)
    t.throws(() => calculator.received(1).add(9, 9), { instanceOf: SubstituteException })
  } finally {
    Error.stackTraceLimit = limit
  }
})

test('R:RT-13 sequences yield their values and then keep yielding the last one (D1)', async t => {
  const calculator = substitute<Calculator & { value: number, load(): Promise<number>, fail(): void }>()
  calculator.add(1, 2).returns(3, 7, 9)
  t.deepEqual([1, 2, 3, 4, 5].map(() => calculator.add(1, 2)), [3, 7, 9, 9, 9])

  calculator.value.returns(1, 2)
  t.deepEqual([calculator.value, calculator.value, calculator.value], [1, 2, 2])

  calculator.load().resolves(1, 2)
  t.deepEqual([await calculator.load(), await calculator.load(), await calculator.load()], [1, 2, 2])

  calculator.fail().throws(new Error('first'), new Error('last'))
  t.throws(() => calculator.fail(), { message: 'first' })
  t.throws(() => calculator.fail(), { message: 'last' })
  t.throws(() => calculator.fail(), { message: 'last' })

  calculator[configure]().add(2, 2).mimicks(() => 'a', () => 'b')
  t.deepEqual([calculator.add(2, 2), calculator.add(2, 2), calculator.add(2, 2)], ['a', 'b', 'b'] as unknown[])
})

test('A:RT-4 assertions on nested and auto-returned substitutes check their own calls (D2)', t => {
  const app = substitute()
  app.logger.info('hi')
  t.notThrows(() => app.logger.received().info('hi'))
  t.notThrows(() => app.logger.received(1).info('hi'))
  t.notThrows(() => app.logger[received](1).info('hi'))
  const { message } = t.throws(() => app.logger.received().info('bye'), { instanceOf: SubstituteException })
  t.true(plain(message).startsWith('Call count mismatch in @Substitute.logger.info:\nExpected to receive 1 or more method calls matching info(\'bye\'), but received none.'))

  // a call on the root never satisfies a nested assertion
  const root = substitute()
  root.warn('disk')
  t.throws(() => root.logger.received().warn('disk'), { instanceOf: SubstituteException })

  // auto-returned substitutes
  const factory = substitute()
  const repository = factory.getRepo()
  repository.save(1)
  t.notThrows(() => repository.received().save(1))
  t.notThrows(() => factory.getRepo().received(1).save(1))
  t.throws(() => factory.getRepo(2).received().save(1), { instanceOf: SubstituteException })
  // the assertion chains above are not received calls
  t.notThrows(() => factory.received(1).getRepo())
  t.notThrows(() => app.received(1).logger)
})

test('A:RT-5 Arg.all() after other arguments matches the remaining arguments only (D14)', t => {
  const logger = substitute()
  logger.log('user created', { id: 1 })
  t.throws(() => logger.received().log('user DELETED', Arg.all()), { instanceOf: SubstituteException })
  t.notThrows(() => logger.received(1).log('user created', Arg.all()))
  t.notThrows(() => logger.received(1).log(Arg.any('string'), Arg.all()))

  const calculator = substitute()
  calculator.add(9, Arg.all()).returns('nine')
  t.true(types.isProxy(calculator.add(1, 2)))
  t.is(calculator.add(9), 'nine')
  t.is(calculator.add(9, 1, 2), 'nine')

  t.throws(() => calculator.add(Arg.all(), 1), { instanceOf: SubstituteException, message: /Arg\.all\(\).*last argument/ })
  t.throws(() => calculator.received().add(Arg.all(), 1), { instanceOf: SubstituteException, message: /Arg\.all\(\).*last argument/ })
})

test('A:RT-6 received(n).method(Arg.all()) does not count property reads of the method', t => {
  const callbacks = substitute()
  if (callbacks.onDone) callbacks.onDone(1)

  t.notThrows(() => callbacks.received(1).onDone(1))
  t.notThrows(() => callbacks.received(1).onDone(Arg.all()))
  t.notThrows(() => callbacks.received(1).onDone(Arg.any()))
  t.notThrows(() => callbacks.received(1).onDone)
})

test('G:RG-1 symbol assertions on a member named returns/throws/resolves/rejects/mimicks are always assertions', t => {
  for (const name of ['returns', 'throws', 'resolves', 'rejects', 'mimicks']) {
    const neverRead = substitute()
    t.throws(() => neverRead[received](1)[name], { instanceOf: SubstituteException }, name)
    t.notThrows(() => neverRead[didNotReceive]()[name], name)

    const readOnce = substitute()
    void readOnce[name]
    t.notThrows(() => readOnce[received](1)[name], name)
    t.throws(() => readOnce[received](3)[name], { instanceOf: SubstituteException }, name)
    t.throws(() => readOnce[didNotReceive]()[name], { instanceOf: SubstituteException }, name)

    // the assertion did not configure anything (round 9, E48: the bare call `readOnce.received(1)` that looked at this
    // is now reported as a check that checks nothing, so the setups are looked at directly)
    t.false(inspect(readOnce).includes('configured:'), name)

    // the same for method calls: an assertion never turns into a substitution
    const calledOnce = substitute()
    calledOnce[name](1)
    t.throws(() => calledOnce[received](1)[name](2), { instanceOf: SubstituteException }, name)
    t.throws(() => calledOnce[didNotReceive]()[name](1), { instanceOf: SubstituteException }, name)
    t.notThrows(() => calledOnce[received](1)[name](1), name)
    t.true(types.isProxy(calledOnce[name](3)), name)
    t.notThrows(() => calledOnce[received](2)[name](Arg.any()), name)
  }
})

test('G:RG-5 a nested member named received is an ordinary member, and nested assertions check the nested node', t => {
  // code under test reading `received` on an unconfigured recursive auto-substitute
  const inbox = substitute()
  t.is(typeof inbox.latest.received.getTime(), 'function')
  t.is(typeof inbox.lastMessage.received.toISOString(), 'function')
  const configured = substitute()
  configured.latest.received.returns(new Date(0))
  t.is(configured.latest.received.getTime(), 0)

  // root getTime() was called: the nested chain still returns an auto-substitute
  const withRootCall = substitute()
  withRootCall.getTime()
  t.true(types.isProxy(withRootCall.x.y.received.getTime()))

  // nested assertions
  const child = substitute()
  child.child.save()
  t.notThrows(() => child.child.received().save())
  const repository = substitute()
  const user = repository.getUser(1)
  user.save()
  t.notThrows(() => user.received().save())
  t.notThrows(() => repository.getUser(1).received(1).save())
  const rootOnly = substitute()
  rootOnly.save()
  t.throws(() => rootOnly.child.received().save(), { instanceOf: SubstituteException })
})

test('G:RG-8 two separately loaded copies of the package interoperate', t => {
  const sourceDirectory = path.dirname(require.resolve('../../../src'))
  const isOwnModule = (file: string) => file.startsWith(sourceDirectory + path.sep)
  const cached = Object.keys(require.cache).filter(isOwnModule).map(file => [file, require.cache[file]] as const)
  t.true(cached.length > 0)

  let copy: typeof library
  try {
    for (const [file] of cached) delete require.cache[file]
    copy = require('../../../src')
  } finally {
    for (const [file] of Object.keys(require.cache).filter(isOwnModule).map(file => [file] as const)) delete require.cache[file]
    for (const [file, module] of cached) require.cache[file] = module
  }

  t.not(copy.Substitute, library.Substitute)
  t.is(copy.received, library.received)

  const calculator: any = library.Substitute.for()
  calculator.add(1)
  t.throws(() => calculator[copy.received](2).add(1), { instanceOf: SubstituteException })
  t.notThrows(() => calculator[copy.received](1).add(1))

  calculator[copy.clearReceivedCalls]()
  t.notThrows(() => calculator.didNotReceive().add(1))

  calculator.value()[copy.returns](5)
  t.is(calculator.value(), 5)
  calculator[copy.configure]().value().returns(6)
  t.is(calculator.value(), 6)

  calculator.find(copy.Arg.any('number')).returns('found')
  t.is(calculator.find(1), 'found')
  t.notThrows(() => calculator.received(1).find(copy.Arg.all()))

  const fromCopy: any = copy.Substitute.for()
  t.true(Arg.any('object').matches(fromCopy))
  calculator.register(fromCopy)
  t.notThrows(() => calculator.received(1).register(fromCopy))
  t.throws(() => calculator.received(1).register(library.Substitute.for()), { instanceOf: SubstituteException })
})
