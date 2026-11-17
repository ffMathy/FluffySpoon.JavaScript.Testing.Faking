import test from 'ava'
import { EventEmitter } from 'events'
import { inspect, types } from 'util'

import { Substitute, Arg, configure } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')
const configured = (substitute: unknown): any => (substitute as any)[configure]()

test('A:RT-1 received(n) with an invalid count throws instead of passing silently', t => {
  for (const count of [-1, 1.5, NaN, Infinity, '2', null, {}]) {
    const calculator = Substitute.for<any>()
    t.throws(() => calculator.received(count).add(1, 2), { instanceOf: SubstituteException }, String(count))
    t.throws(() => calculator.received(count).isEnabled, { instanceOf: SubstituteException }, String(count))
    t.throws(() => { calculator.received(count).isEnabled = true }, { instanceOf: SubstituteException }, String(count))
  }
  const error = t.throws(() => Substitute.for<any>().received(-1).add(1, 2), { instanceOf: SubstituteException })
  t.regex(error.message, /non-negative integer/)
})

test('A:RT-2 an overlapping setup registers a new substitution and is not recorded as a call', t => {
  const factory = Substitute.for<any>()
  const repositoryA = Substitute.for<any>()
  repositoryA.name.returns('A')
  const repositoryB = Substitute.for<any>()
  repositoryB.name.returns('B')

  factory.create('a').returns(repositoryA)
  factory.create(Arg.any()).returns(repositoryB)
  factory.create('a')
  factory.create('x')

  t.is(factory.create('x').name, 'B')
  t.is(factory.create('a').name, 'A')
  t.throws(() => factory.received().create('never'), { instanceOf: SubstituteException })
  t.throws(() => factory.received(3).create('a'), { instanceOf: SubstituteException })
  factory.received(2).create('a')
  factory.received(2).create('x')
  t.throws(() => factory.received(1).create(Arg.any()), { instanceOf: SubstituteException })
  factory.received(4).create(Arg.any())

  // re-configuring the same call
  const calculator = Substitute.for<any>()
  calculator.add(1, 2).returns(3)
  configured(calculator).add(1, 2).returns(4)
  t.is(calculator.add(1, 2), 4)
  configured(calculator).add(Arg.all()).returns(10)
  t.is(calculator.add(1, 2), 4)
  t.is(calculator.add(2, 2), 10)
})

test('A:RT-3 a method that is only read never satisfies a method assertion', t => {
  const handler = Substitute.for<any>()
  new EventEmitter().on('click', handler.onClick)
  t.throws(() => handler.received().onClick(42), { instanceOf: SubstituteException })
  t.throws(() => handler.received(1).onClick(42), { instanceOf: SubstituteException })
  t.throws(() => handler.received(1).onClick(Arg.all()), { instanceOf: SubstituteException })
  // the read itself is still visible as a property read
  t.notThrows(() => handler.received(1).onClick)
})

test('A:RT-4 assertions on nested and auto-returned substitutes check that substitute', t => {
  const app = Substitute.for<any>()
  app.logger.info('hi')
  t.notThrows(() => app.logger.received().info('hi'))
  t.notThrows(() => app.logger.received(1).info('hi'))
  const error = t.throws(() => app.logger.received().info('bye'), { instanceOf: SubstituteException })
  t.true(plain(error.message).startsWith('Call count mismatch in @Substitute.logger.info:'))
  t.false(plain(error.message).includes('property calls'))

  // a root call with the same name does not satisfy a nested assertion, and vice versa
  const root = Substitute.for<any>()
  root.warn('disk')
  t.throws(() => root.logger.received().warn('disk'), { instanceOf: SubstituteException })
  root.logger.error('x')
  t.throws(() => root.received().error('x'), { instanceOf: SubstituteException })
  t.notThrows(() => root.logger.didNotReceive().warn('disk'))

  const repository = Substitute.for<any>()
  const user = repository.getUser(1)
  user.save()
  t.notThrows(() => user.received().save())
  t.notThrows(() => repository.getUser(1).received().save())
  t.throws(() => repository.getUser(2).received().save(), { instanceOf: SubstituteException })
})

test('A:RT-5 Arg.all() after other arguments only matches when the leading arguments match', t => {
  const logger = Substitute.for<{ log(message: string, ...meta: unknown[]): void }>()
  logger.log('user created', { id: 1 })
  t.throws(() => logger.received().log('user DELETED', Arg.all()), { instanceOf: SubstituteException })
  t.notThrows(() => logger.received(1).log('user created', Arg.all()))
  t.notThrows(() => logger.received(1).log(Arg.any(), Arg.all()))

  const calculator = Substitute.for<any>()
  calculator.add(9, Arg.all()).returns('nine')
  t.true(types.isProxy(calculator.add(1, 2)))
  t.is(calculator.add(9), 'nine')
  t.is(calculator.add(9, 1, 2), 'nine')
})

test('A:RT-6 received(n).m(Arg.all()) counts invocations only, not bare reads', t => {
  const callback = Substitute.for<any>()
  if (callback.onDone) callback.onDone(1)
  t.notThrows(() => callback.received(1).onDone(1))
  t.notThrows(() => callback.received(1).onDone(Arg.all()))
  t.throws(() => callback.received(2).onDone(Arg.all()), { instanceOf: SubstituteException })
})

test('A:RT-7 a decidable property assertion failure is thrown synchronously', t => {
  const component = Substitute.for<any>()
  if (component.onChange) component.onChange()
  void component.onChange
  // 2 property reads and 1 call: received(5) fails both as a property read and as a method call
  const error = t.throws(() => component.received(5).onChange, { instanceOf: SubstituteException })
  t.regex(plain(error.message), /Expected to receive 5 property reads or method calls matching onChange, but received 2 property reads and 1 method call\./)
  t.throws(() => component.received(3).onChange, { instanceOf: SubstituteException })
  t.notThrows(() => component.received(2).onChange)

  const property = Substitute.for<any>()
  void property.value
  t.throws(() => property.received(2).value, { instanceOf: SubstituteException })
  t.throws(() => property.didNotReceive().value, { instanceOf: SubstituteException })
})

test('A:RT-8 substitutes that reference each other print without overflowing the stack', t => {
  const parent = Substitute.for<any>()
  const child = Substitute.for<any>()
  parent.addChild(child)
  child.setParent(parent)
  const error = t.throws(() => parent.received().addChild(parent), { instanceOf: SubstituteException })
  // (round 9, E52: the expected call and the received one print alike apart from which substitute is the argument, so
  // the message numbers the substitutes)
  t.true(plain(error.message).startsWith('Call count mismatch in @Substitute#1.addChild:'))
  t.true(plain(error.message).includes('matching addChild(@Substitute#1)'))
  t.true(plain(error.message).includes('@Substitute#1.addChild(@Substitute#2)'))

  const self = Substitute.for<any>()
  self.link(self)
  t.throws(() => self.received().link(self, 1), { instanceOf: SubstituteException })
  t.notThrows(() => self.received(1).link(self))
  t.notThrows(() => inspect(parent))
  t.notThrows(() => inspect(self, { depth: Infinity }))
  t.is(inspect(self), '@Substitute {\n  received:\n    link(@Substitute)\n}')
})

test('A:RT-9 a method assertion message names the expected arguments and never says "property calls"', t => {
  const calculator = Substitute.for<any>()
  // nothing received at all: decided when the member is accessed, before the arguments are known
  const unknownKind = t.throws(() => calculator.received(3).add(1, Arg.any()), { instanceOf: SubstituteException })
  t.false(plain(unknownKind.message).includes('property calls'))
  t.regex(plain(unknownKind.message), /Expected to receive 3 property reads or method calls matching add, but received none\./)

  calculator.add(1, 2)
  const methodKind = t.throws(() => calculator.received(3).add(1, Arg.any()), { instanceOf: SubstituteException })
  t.regex(plain(methodKind.message), /Expected to receive 3 method calls matching add\(1, Arg\.any\{any\}\), but received 1\./)

  const neverCalled = t.throws(() => calculator.received().multiply(1, 2), { instanceOf: SubstituteException })
  t.false(plain(neverCalled.message).includes('property calls'))
})

test('A:RT-10 a throwing Arg.is predicate counts as a non-match and is reported', t => {
  const repository = Substitute.for<any>()
  repository.save(null)
  repository.save({ id: 1 })
  t.notThrows(() => repository.received().save(Arg.is((x: any) => x.id === 1)))
  t.notThrows(() => repository.received(1).save(Arg.is((x: any) => x.id === 1)))
  const error = t.throws(() => repository.received(2).save(Arg.is((x: any) => x.id === 1)), { instanceOf: SubstituteException })
  t.regex(plain(error.message), /an Arg\.is predicate threw while matching this call: TypeError/)

  // in the code under test, a throwing predicate of a configured substitution is just a non-match
  const finder = Substitute.for<any>()
  finder.find(Arg.is((x: any) => x.id === 1)).returns('one')
  t.notThrows(() => finder.find(null))
  t.true(types.isProxy(finder.find(null)))
  t.is(finder.find({ id: 1 }), 'one')
})

test('A:RT-11 Arg.any("object") matches non-null objects and substitutes, but not null', t => {
  t.false(Arg.any('object').matches(null))
  t.true(Arg.any('object').matches([]))
  t.true(Arg.any('object').matches({}))

  const logger = Substitute.for<any>()
  const service = Substitute.for<any>()
  service.register(logger)
  service.register(null)
  t.notThrows(() => service.received(1).register(Arg.any('object')))
  t.notThrows(() => service.received(1).register(Arg.any('function')))
  t.true(Arg.any('object').matches(service.someMember))
})

test('A:RT-12 building a message without stack frames does not crash', t => {
  const stackTraceLimit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    const calculator = Substitute.for<any>()
    calculator.add(1, 2)
    const error = t.throws(() => calculator.received().add(9, 9), { instanceOf: SubstituteException })
    t.regex(plain(error.message), /› ✘ @Substitute\.add\(1, 2\)/)
  } finally {
    Error.stackTraceLimit = stackTraceLimit
  }
})

test('A:RT-13 Arg.is rejects a missing or non-function predicate when it is created', t => {
  t.throws(() => Arg.is(undefined), { instanceOf: TypeError, message: /Arg\.is expects a predicate function/ })
  t.throws(() => Arg.is(Object.create(null)), { instanceOf: TypeError, message: /Arg\.is expects a predicate function/ })
  t.throws(() => Arg.is(5 as any), { instanceOf: TypeError, message: /Arg\.is expects a predicate function/ })
  t.throws(() => Arg.is.not('x' as any), { instanceOf: TypeError, message: /Arg\.is expects a predicate function/ })
})

const withEnvironment = (environment: { NO_COLOR?: string, FORCE_COLOR?: string, tty: boolean }, run: () => void) => {
  // NODE_DISABLE_COLORS and TERM=dumb also turn colours off (D24): they are cleared so that the result does not
  // depend on the environment the tests run in.
  const names = ['NO_COLOR', 'FORCE_COLOR', 'NODE_DISABLE_COLORS', 'TERM'] as const
  const saved = names.map(name => [name, process.env[name]] as const)
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const set = (name: typeof names[number], value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    set('NO_COLOR', environment.NO_COLOR)
    set('FORCE_COLOR', environment.FORCE_COLOR)
    set('NODE_DISABLE_COLORS', undefined)
    set('TERM', undefined)
    Object.defineProperty(process.stdout, 'isTTY', { value: environment.tty, configurable: true, writable: true })
    run()
  } finally {
    for (const [name, value] of saved) set(name, value)
    if (ttyDescriptor !== undefined) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor)
    else delete (process.stdout as any).isTTY
  }
}

test('A:RT-14 messages contain ANSI codes only when colour output is appropriate', t => {
  const messageOf = () => {
    const calculator = Substitute.for<any>()
    calculator.add(1, 2)
    try {
      calculator.received().add(9, 9)
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('expected the assertion to fail')
  }
  const hasAnsi = (text: string) => /\x1b\[/.test(text)

  withEnvironment({ tty: false }, () => t.false(hasAnsi(messageOf()), 'not a TTY'))
  withEnvironment({ tty: true }, () => t.true(hasAnsi(messageOf()), 'TTY'))
  withEnvironment({ tty: true, NO_COLOR: '1' }, () => t.false(hasAnsi(messageOf()), 'NO_COLOR'))
  withEnvironment({ tty: false, FORCE_COLOR: '1' }, () => t.true(hasAnsi(messageOf()), 'FORCE_COLOR=1'))
  withEnvironment({ tty: true, FORCE_COLOR: '0' }, () => t.false(hasAnsi(messageOf()), 'FORCE_COLOR=0'))
})

test('A:DOC-1 the README "Match order" and "Partial mocks" examples work', t => {
  interface Calculator { add(a: number, b: number): number, subtract(a: number, b: number): number, divide(a: number, b: number): number }

  // Match order, example 1: a specific setup after a catch-all one goes through [configure]()
  const first = Substitute.for<Calculator>()
  first.add(Arg.all()).returns(10)
  configured(first).add(1, 3).returns(1337)
  t.is(1337, first.add(1, 3))
  t.is(10, first.add(5, 2))

  // Match order, example 2: the catch-all setup uses matchers, so it is a setup and the order does not matter
  const second = Substitute.for<Calculator>()
  second.add(1, 3).returns(1337)
  second.add(Arg.all()).returns(10)
  t.is(1337, second.add(1, 3))
  t.is(10, second.add(5, 2))

  // Partial mocks
  class RealCalculator implements Calculator {
    add(a: number, b: number) { return a + b }
    subtract(a: number, b: number) { return a - b }
    divide(a: number, b: number) { return a / b }
  }
  const realCalculator = new RealCalculator()
  const fakeCalculator = Substitute.for<Calculator>()
  fakeCalculator.add(Arg.is((x: number) => x < 10), Arg.any()).mimicks(realCalculator.add)
  fakeCalculator.add(Arg.is((x: number) => x >= 10), Arg.any()).returns(1337)
  fakeCalculator.subtract(Arg.any(), Arg.any()).mimicks(realCalculator.subtract)
  fakeCalculator.divide(10, 2).mimicks(realCalculator.divide)
  fakeCalculator.divide(Arg.all()).returns(1338)

  t.is(10, fakeCalculator.subtract(20, 10))
  t.is(-1, fakeCalculator.subtract(1, 2))
  t.is(105, fakeCalculator.add(5, 100))
  t.is(1337, fakeCalculator.add(10, 100))
  t.is(5, fakeCalculator.divide(10, 2))
  t.is(1338, fakeCalculator.divide(10, 5))
  t.is(1338, fakeCalculator.divide(9, 5))
})
