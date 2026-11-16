import test from 'ava'
import { EventEmitter } from 'events'
import { types } from 'util'

import { Substitute, Arg, received, didNotReceive, mimick, configure } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')
const configured = (substitute: unknown): any => (substitute as any)[configure]()

interface Logger { log(message: string): void, level: number }
interface Calculator { add(a: number, b: number): number }

test('R:RT-1 every call through a stored or destructured method reference is recorded', t => {
  const logger = Substitute.for<Logger>()
  const { log } = logger
  log('a')
  log('b')
  logger.received(2).log(Arg.any())
  logger.received(1).log('a')
  logger.received(1).log('b')

  const viaCallback = Substitute.for<any>()
  ;['x', 'y', 'x'].forEach(viaCallback.log)
  // forEach passes (value, index, array)
  viaCallback.received(3).log(Arg.all())
  viaCallback.received(2).log('x', Arg.all())
  viaCallback.received(1).log('y', 1, Arg.any())
  t.throws(() => viaCallback.received(1).log('x', Arg.all()), { instanceOf: SubstituteException })
})

test('R:RT-2 asserting a configured property never runs its substitution', async t => {
  interface Config { token: string, flaky: string, computed: number, ready: Promise<void> }
  const config = Substitute.for<Config>()
  config.token.returns('t1', 't2', 't3')
  config.flaky.throws(new Error('boom'))
  let mimickCalls = 0
  config.computed.mimicks(() => ++mimickCalls)
  config.ready.rejects(new Error('not ready'))

  t.is('t1', config.token)
  config.received(1).token
  t.is('t2', config.token)
  t.is('t3', config.token)

  t.throws(() => config.flaky, { message: 'boom' })
  t.notThrows(() => config.received(1).flaky)
  t.notThrows(() => config.didNotReceive().computed)

  t.is(1, config.computed)
  config.received(1).computed
  config.received().computed
  t.is(mimickCalls, 1)

  // no rejected promise is created by the assertion (an unhandled rejection would fail this test file)
  config.didNotReceive().ready
  await t.throwsAsync(config.ready, { message: 'not ready' })
  config.received(1).ready

  const neverRead = Substitute.for<Config>()
  neverRead.flaky.throws(new Error('boom'))
  t.notThrows(() => neverRead.didNotReceive().flaky)
})

test('R:RT-3 a second setup that overlaps an earlier one does not run the earlier substitution', t => {
  interface User { name: string }
  interface Repository { find(id: number): User, remove(id: number): void, add(a: number, b: number): number }
  const anyUser = Substitute.for<User>()
  anyUser.name.returns('any')
  const admin = Substitute.for<User>()
  admin.name.returns('admin')

  const repository = Substitute.for<Repository>()
  repository.find(Arg.any()).returns(anyUser)
  configured(repository).find(1).returns(admin)
  t.is(repository.find(1).name, 'admin')
  t.is(repository.find(2).name, 'any')

  repository.add(Arg.all()).returns(10)
  configured(repository).add(1, 3).returns(1337)
  t.is(1337, repository.add(1, 3))
  t.is(10, repository.add(5, 2))

  repository.remove(Arg.any()).throws(new Error('forbidden'))
  t.notThrows(() => configured(repository).remove(1).returns(undefined))
  t.is(repository.remove(1), undefined)
  t.throws(() => repository.remove(2), { message: 'forbidden' })

  // a setup with matchers after a specific one never runs the specific one
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 3).returns(1337)
  calculator.add(Arg.all()).returns(10)
  t.is(1337, calculator.add(1, 3))
  t.is(10, calculator.add(5, 2))
  // the setups were not recorded as calls
  calculator.received(2).add(Arg.all())
  calculator.received(1).add(1, 3)
})

test('R:RT-4 symbol assertions on members named like substitution methods are real assertions', t => {
  const neverCalled = Substitute.for<any>()
  t.throws(() => neverCalled[received](1).returns(5), { instanceOf: SubstituteException })

  const calledWithOtherArgs = Substitute.for<any>()
  calledWithOtherArgs.returns(7)
  t.throws(() => calledWithOtherArgs[received](1).returns(5), { instanceOf: SubstituteException })
  t.notThrows(() => calledWithOtherArgs[received](1).returns(7))

  const rejected = Substitute.for<any>()
  rejected.rejects(1)
  t.throws(() => rejected[didNotReceive]().rejects(1), { instanceOf: SubstituteException })

  for (const name of ['returns', 'throws', 'resolves', 'rejects', 'mimicks']) {
    const thrower = Substitute.for<any>()
    t.throws(() => thrower[received](1)[name](1), { instanceOf: SubstituteException }, name)
    thrower[name](1)
    t.notThrows(() => thrower[received](1)[name](1), name)
  }

  const followUp = Substitute.for<Calculator>()
  followUp.add(1, 2)
  t.throws(() => (followUp as any)[received](1).returns(5), { instanceOf: SubstituteException })
  t.notThrows(() => followUp.received(1).add(1, 2))
})

test('R:RT-5 code under test can read through a nested member named received or didNotReceive', t => {
  const mailbox = Substitute.for<any>()
  t.notThrows(() => mailbox.getStats().sent.total)
  t.notThrows(() => mailbox.getStats().received.total)
  t.notThrows(() => { mailbox.getStats().received.total = 3 })
  t.notThrows(() => mailbox.inbox.didNotReceive.count)

  const email = Substitute.for<any>()
  t.is(typeof email.latest.received.getTime(), 'function')
  t.is(typeof email.received.getTime(), 'function')
  email.received.getTime().returns(42)
  t.is(email.received.getTime(), 42)
})

test('R:RT-6 received(n) with an invalid count throws a SubstituteException', t => {
  for (const count of [-1, 1.5, NaN, Infinity, -Infinity, 2 ** 53]) {
    const calculator = Substitute.for<Calculator>()
    t.throws(() => calculator.received(count).add(1, 2), { instanceOf: SubstituteException }, String(count))
    t.throws(() => (calculator as any)[received](count), { instanceOf: SubstituteException }, String(count))
  }
  const calculator = Substitute.for<Calculator>()
  t.notThrows(() => calculator.received(0).add(1, 2))
  t.notThrows(() => (calculator as any)[received](0).add(1, 2))
})

test('R:RT-7 a root setup does not leak into a nested auto-substitute with the same member name', t => {
  interface App { getCalc(): Calculator, add(a: number, b: number): number, version: string, meta: { version: string } }
  const app = Substitute.for<App>()
  app.add(1, 2).returns(99)
  app.version.returns('1.0')

  t.true(types.isProxy(app.getCalc().add(1, 2)))
  t.true(types.isProxy(app.meta.version))
  t.is(99, app.add(1, 2))
  t.is('1.0', app.version)

  // and the other way round
  const nested = Substitute.for<any>()
  nested.getCalc().add(1, 2).returns(42)
  t.true(types.isProxy(nested.add(1, 2)))
  t.is(nested.getCalc().add(1, 2), 42)
})

test('R:RT-9 sub[mimick](instance) delegates to the instance', t => {
  class RealCalculator {
    base = 10
    add(a: number, b: number) { return a + b + this.base }
  }
  const instance = new RealCalculator()
  const calculator = Substitute.for<RealCalculator>()
  ;(calculator as any)[mimick](instance)
  t.is<unknown, unknown>(calculator.add(1, 2), 13)
  t.is<unknown, unknown>(calculator.base, 10)
  calculator.received(1).add(1, 2)
})

test('R:RT-10 reading a method without invoking it does not count as a call', t => {
  interface Handler { onClick(x: number): void }
  const handler = Substitute.for<Handler>()
  const button = new EventEmitter()
  button.on('click', handler.onClick)

  t.throws(() => handler.received().onClick(Arg.any()), { instanceOf: SubstituteException })
  t.throws(() => handler.received(1).onClick(42), { instanceOf: SubstituteException })
  t.throws(() => (handler as any).received(1).onClick(), { instanceOf: SubstituteException })

  const twice = Substitute.for<any>()
  void twice.save
  void twice.save
  t.throws(() => twice.received(2).save(1), { instanceOf: SubstituteException })

  button.emit('click', 7)
  t.notThrows(() => handler.received(1).onClick(7))
})

test('R:RT-11 calls through .call, .apply and .bind return the configured value and are recorded', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 2).returns(3)

  t.is<unknown, unknown>(calculator.add(1, 2), 3)
  t.is(calculator.add.call(calculator, 1, 2), 3)
  t.is(calculator.add.apply(calculator, [1, 2]), 3)
  t.is<unknown, unknown>(calculator.add.bind(calculator)(1, 2), 3)
  t.is(calculator.add.bind(calculator, 1)(2), 3)
  calculator.received(5).add(1, 2)
  t.throws(() => calculator.received(1).add(7, 7), { instanceOf: SubstituteException })

  const listener = Substitute.for<{ onX(value: number): string }>()
  listener.onX(1).returns('one')
  const emitter = new EventEmitter()
  emitter.on('x', listener.onX)
  emitter.on('x', listener.onX)
  emitter.emit('x', 1)
  listener.received(2).onX(1)
  t.throws(() => listener.received(1).onX(999), { instanceOf: SubstituteException })
  t.notThrows(() => listener.didNotReceive().onX(999))
})

test('R:RT-12 a failed assertion with Error.stackTraceLimit = 0 throws a SubstituteException', t => {
  const stackTraceLimit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    const calculator = Substitute.for<Calculator>()
    calculator.add(1, 2)
    const error = t.throws(() => calculator.received(2).add(1, 2), { instanceOf: SubstituteException })
    t.true(plain(error.message).startsWith('Call count mismatch in @Substitute.add:'))
    t.false(plain(error.message).includes('called at'))
  } finally {
    Error.stackTraceLimit = stackTraceLimit
  }
})

test('R:RT-13 (D1) a sequence keeps returning its last value', async t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 2).returns(3, 7, 9)
  t.deepEqual([1, 2, 3, 4].map(() => calculator.add(1, 2)), [3, 7, 9, 9])

  const single = Substitute.for<Calculator>()
  single.add(1, 2).returns(4)
  t.deepEqual([single.add(1, 2), single.add(1, 2)], [4, 4])

  const thrower = Substitute.for<Calculator>()
  thrower.add(Arg.all()).throws(new Error('a'), new Error('b'))
  t.throws(() => thrower.add(1, 1), { message: 'a' })
  t.throws(() => thrower.add(1, 1), { message: 'b' })
  t.throws(() => thrower.add(1, 1), { message: 'b' })

  const resolver = Substitute.for<{ load(): Promise<number> }>()
  resolver.load().resolves(1, 2)
  t.deepEqual([await resolver.load(), await resolver.load(), await resolver.load()], [1, 2, 2])

  const mimicker = Substitute.for<Calculator>()
  mimicker.add(Arg.all()).mimicks((a: number, b: number) => a + b, (a: number, b: number) => a * b)
  t.deepEqual([mimicker.add(2, 3), mimicker.add(2, 3), mimicker.add(2, 3)], [5, 6, 6])
})
