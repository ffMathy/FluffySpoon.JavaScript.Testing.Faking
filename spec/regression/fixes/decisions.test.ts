import test, { ExecutionContext, ThrowsExpectation } from 'ava'
import { interceptDeferredReports } from '../../helpers/deferredReports'
import { inspect, types } from 'util'

import { Substitute, Arg, received, didNotReceive, clearReceivedCalls, mimick, configure, returns } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

const throwsUncaughtException = (callback: () => unknown, t: ExecutionContext, expectation: ThrowsExpectation) => {
  const clock = interceptDeferredReports()
  try {
    callback()
    t.throws(() => clock.tick(1), expectation)
  } finally {
    clock.uninstall()
  }
}

const doesNotThrowLater = (callback: () => unknown, t: ExecutionContext) => {
  const clock = interceptDeferredReports()
  try {
    callback()
    t.notThrows(() => clock.tick(1))
  } finally {
    clock.uninstall()
  }
}

test('D2 repeated access to the same member path returns the same auto-substitute', t => {
  const app = Substitute.for<any>()
  t.is(app.logger, app.logger)
  t.is(app.getCalc(), app.getCalc())
  t.is(app.getUser({ id: 1 }), app.getUser({ id: 1 }))
  t.not(app.getUser({ id: 1 }), app.getUser({ id: 2 }))
  t.not(app.getCalc(), app.getCalc(1))

  // nested setups
  app.getCalc().add(1, 2).returns(99)
  t.is(app.getCalc().add(1, 2), 99)
  app.logger.level.returns(3)
  t.is(app.logger.level, 3)
  app.find(Arg.any()).name.returns('any')
  t.is(app.find(5).name, 'any')
  t.is(app.find('x').name, 'any')

  // nested assertions
  app.logger.info('hi')
  app.logger.received().info('hi')
  app.logger.received(1).info('hi')
  t.throws(() => app.logger.received().info('bye'), { instanceOf: SubstituteException })
  t.throws(() => app.logger.didNotReceive().info('hi'), { instanceOf: SubstituteException })

  // the expressions used for setups and assertions are not received calls themselves
  const fresh = Substitute.for<any>()
  fresh.getCalc().add(1, 2).returns(99)
  fresh.logger.level.returns(3)
  fresh.logger.received(0).info('hi')
  fresh.getCalc()[received](0).add(1, 2)
  t.notThrows(() => fresh.didNotReceive().getCalc())
  t.notThrows(() => fresh.didNotReceive().logger)
  t.is(fresh.getCalc().add(1, 2), 99)
  t.notThrows(() => fresh.received(1).getCalc())
})

test('D2 the same auto-substitute is shared with the code under test', t => {
  interface Repository { save(item: string): void }
  interface Unit { repository(name: string): Repository }
  const unit = Substitute.for<Unit>()
  const codeUnderTest = (u: Unit) => u.repository('users').save('alice')
  codeUnderTest(unit)
  t.notThrows(() => (unit.repository('users') as any).received(1).save('alice'))
  t.throws(() => (unit.repository('orders') as any).received().save('alice'), { instanceOf: SubstituteException })
  t.notThrows(() => unit.received(1).repository('users'))
})

test('D5 sub[configure]() makes every call a setup', t => {
  const calculator = Substitute.for<any>()
  calculator.add(1, 3).returns(1)
  const reconfigure = calculator[configure]()
  reconfigure.add(1, 3).returns(1337)
  t.is(calculator.add(1, 3), 1337)

  // configure never runs substitutions and records nothing
  let mimicked = 0
  calculator.multiply(Arg.all()).mimicks(() => ++mimicked)
  calculator.divide(Arg.all()).throws(new Error('no'))
  t.notThrows(() => calculator[configure]().divide(4, 2).returns(2))
  calculator[configure]().multiply(2, 2).returns(4)
  t.is(mimicked, 0)
  t.is(calculator.divide(4, 2), 2)
  t.throws(() => calculator.divide(1, 1), { message: 'no' })
  t.notThrows(() => calculator.received(1).add(1, 3))
  t.notThrows(() => calculator.didNotReceive().multiply(Arg.all()))

  // properties, nested members and the symbol substitution methods
  calculator.isEnabled.returns(true)
  calculator[configure]().isEnabled.returns(false)
  t.is(calculator.isEnabled, false)
  calculator[configure]().logger.level[returns](5)
  t.is(calculator.logger.level, 5)
  calculator[configure]().getCalc(1).add(Arg.any(), 1).returns(42)
  t.is(calculator.getCalc(1).add(7, 1), 42)
  t.throws(() => { calculator[configure]().isEnabled = true }, { instanceOf: SubstituteException })
})

test('D11 the string received/didNotReceive is an assertion only when invoked and followed by a member access', t => {
  const substitute = Substitute.for<any>()
  substitute.add(1, 2)
  t.notThrows(() => substitute.received(1).add(1, 2))
  t.notThrows(() => substitute.received().add(1, 2))
  t.throws(() => substitute.didNotReceive().add(1, 2), { instanceOf: SubstituteException })

  // a non-invoked received is an ordinary property chain
  t.true(types.isProxy(substitute.received.x))

  // a substitution method right after it configures a user member called received
  substitute.received(10).returns('foo')
  t.is(substitute.received(10), 'foo')
  t.notThrows(() => substitute[received](1).received(10))

  // the symbol forms are always assertions, whatever the member name
  substitute.returns(5)
  t.notThrows(() => substitute[received](1).returns(5))
  t.throws(() => substitute[received](1).returns(6), { instanceOf: SubstituteException })
  t.throws(() => substitute[didNotReceive]().returns(5), { instanceOf: SubstituteException })

  // the assertion did not configure anything: add still records and returns an auto-substitute
  t.true(types.isProxy(substitute.add(1, 2)))
})

test('D12 sub[mimick](instance) delegates unconfigured members to the instance', t => {
  class Real {
    public calls = 0
    public name = 'real'
    add(a: number, b: number) { this.calls++; return a + b }
    whoAmI() { return this }
    get upper() { return this.name.toUpperCase() }
  }
  const instance = new Real()
  const substitute = Substitute.for<Real>()
  ;(substitute as any)[mimick](instance)

  t.is<unknown, unknown>(substitute.add(1, 2), 3)
  t.is<unknown, unknown>(substitute.whoAmI(), instance)
  t.is<unknown, unknown>(substitute.name, 'real')
  t.is<unknown, unknown>(substitute.upper, 'REAL')
  ;(substitute as any).name = 'changed'
  t.is(instance.name, 'changed')
  t.is<unknown, unknown>(substitute.upper, 'CHANGED')

  // explicit substitutions win, and calls are recorded
  ;(substitute as any)[configure]().add(5, 5).returns(0)
  // a mimicked property read returns the instance value, so it is configured through [configure]()
  ;(substitute as any)[configure]().calls.returns(-1)
  t.is<unknown, unknown>(substitute.add(5, 5), 0)
  t.is<unknown, unknown>(substitute.calls, -1)
  t.is(instance.calls, 1)
  substitute.received(1).add(1, 2)
  substitute.received(1).add(5, 5)
  substitute.received(2).upper
  ;(substitute as any).received(1).name = 'changed'

  // assertions never run the instance
  t.is(instance.calls, 1)

  // a member the instance does not have reads as undefined, like on the instance itself,
  // unless the substitute configures it
  const loose = substitute as any
  t.is(loose.missing, undefined)
  t.throws(() => loose.missingMethod(), { instanceOf: TypeError })
  loose[configure]().extra(1).returns(5)
  t.is(loose.extra(1), 5)
  loose[configure]().nested.value.returns('n')
  t.is(loose.nested.value, 'n')
  loose.received(1).extra(1)
  loose.received(1).missing

  // the string mimick is an ordinary member
  const other = Substitute.for<any>()
  other.mimick(instance)
  t.true(types.isProxy(other.add(1, 2)))
  t.throws(() => (Substitute.for<any>() as any)[mimick](42), { instanceOf: SubstituteException })
})

test('D13 sub[clearReceivedCalls]() clears received calls of a substitute and its auto-substitutes only', t => {
  const app = Substitute.for<any>()
  app.add(1, 2).returns(3)
  app.logger.level.returns(2)
  t.is(app.add(1, 2), 3)
  app.logger.info('x')
  app[clearReceivedCalls]()
  t.notThrows(() => app.didNotReceive().add(1, 2))
  t.notThrows(() => app.logger.didNotReceive().info('x'))
  t.is(app.add(1, 2), 3)
  t.is(app.logger.level, 2)
})

test('D14 Arg.all() matches the remaining arguments and must be the last argument', t => {
  const logger = Substitute.for<any>()
  logger.log('x')
  logger.log('x', 1, 2)
  logger.log('y', 1)
  logger.received(2).log('x', Arg.all())
  logger.received(3).log(Arg.all())
  logger.received(1).log('y', Arg.all())
  logger.received(1).log('y', 1, Arg.all())
  t.throws(() => logger.received().log('z', Arg.all()), { instanceOf: SubstituteException })

  t.throws(() => logger.received().log(Arg.all(), 'x'), { instanceOf: SubstituteException, message: /must be the last argument/ })
  t.throws(() => logger.log(Arg.all(), 1).returns(1), { instanceOf: SubstituteException, message: /must be the last argument/ })

  logger.format('a', Arg.all()).returns('A')
  t.is(logger.format('a'), 'A')
  t.is(logger.format('a', 1, 2, 3), 'A')
  t.true(types.isProxy(logger.format('b')))
})

test('D3/D4 precedence: the most specific setup wins, then the most recent one', t => {
  const calculator = Substitute.for<any>()
  calculator.add(Arg.all()).returns('all')
  calculator.add(Arg.any(), Arg.any()).returns('any-any')
  calculator.add(1, Arg.any()).returns('one-any')
  t.is(calculator.add(1, 2), 'one-any')
  t.is(calculator.add(2, 2), 'any-any')
  // E22 (round 7): add(2) has an omitted second argument, which Arg.any() matches
  t.is(calculator.add(2), 'any-any')
  t.is(calculator.add(2, 2, 2), 'all')
  calculator[configure]().add(1, 2).returns('literal')
  t.is(calculator.add(1, 2), 'literal')
  calculator.add(Arg.is((x: number) => x === 1), Arg.any()).returns('newer predicate')
  t.is(calculator.add(1, 5), 'newer predicate')
  t.is(calculator.add(1, 2), 'literal')
  // a call with matchers is never recorded and never runs a substitution
  calculator.add(Arg.any(), 2)
  t.notThrows(() => calculator.received(7).add(Arg.all()))
})

test('D9 a failing property-style assertion is deferred only in the ambiguous case', t => {
  const component = Substitute.for<any>()
  void component.onChange
  void component.onChange
  component.onChange()
  // 2 reads and 1 call: received(1).onChange() would pass, so the property-style failure is reported later
  throwsUncaughtException(() => component.received(1).onChange, t, { instanceOf: SubstituteException })
  // ... and is cancelled when the member is invoked
  doesNotThrowLater(() => component.received(1).onChange(), t)
  // not ambiguous: thrown synchronously
  t.throws(() => component.received(3).onChange, { instanceOf: SubstituteException })

  // a member that was only invoked: the access is the start of a method assertion
  const calculator = Substitute.for<any>()
  calculator.add(1, 2)
  const error = t.throws(() => calculator.received(2).add(1, 2), { instanceOf: SubstituteException })
  t.regex(plain(error.message), /Expected to receive 2 method calls matching add\(1, 2\), but received 1\./)
  doesNotThrowLater(() => calculator.received(1).add(1, 2), t)
  // ... so a property-style assertion on it that is never invoked is reported later
  throwsUncaughtException(() => calculator.received(2).add, t, { instanceOf: SubstituteException })

  // a member that was never invoked is a property: decided now
  const handler = Substitute.for<any>()
  void handler.onClick
  t.throws(() => handler.didNotReceive().onClick, { instanceOf: SubstituteException })
  t.throws(() => handler.received(2).onClick, { instanceOf: SubstituteException })
})

test('D16 Arg.any types', t => {
  const substitute = Substitute.for<any>()
  t.true(Arg.any('object').matches(substitute))
  t.true(Arg.any('object').matches([1]))
  t.false(Arg.any('object').matches(null))
  t.false(Arg.any('object').matches(() => 1))
  t.true(Arg.any('function').matches(substitute))
  t.true(Arg.any('function').matches(class { }))
  t.true(Arg.any('array').matches([]))
  t.false(Arg.any('array').matches(substitute))
  t.false(Arg.any('array').matches({ length: 0 } as any))
  t.true(Arg.any.not('object').matches(null))
})

test('D17 Arg.is predicates: validated at creation, a throw is a non-match', t => {
  t.throws(() => Arg.is(null as any), { instanceOf: TypeError })
  const throwing = Arg.is((x: any) => x.deep.value === 1)
  t.false(throwing.matches(undefined))
  t.false(Arg.is.not((x: any) => x.deep.value === 1).matches(undefined))
  t.true(throwing.matches({ deep: { value: 1 } }))
})

test('D18 assertion messages', t => {
  const substitute = Substitute.for<any>()
  substitute.isEnabled = true
  void substitute.mode
  const setError = t.throws(() => { substitute.received(2).isEnabled = true }, { instanceOf: SubstituteException })
  t.regex(plain(setError.message), /Expected to receive 2 property assignments matching isEnabled = true, but received 1\./)
  t.regex(plain(setError.message), /› ✔ @Substitute\.isEnabled = true/)
  const readError = t.throws(() => substitute.received(2).mode, { instanceOf: SubstituteException })
  // D36 (round 3): mode was only read, with a count above the reads, so the failure is kind-neutral
  t.regex(plain(readError.message), /Expected to receive 2 property reads or method calls matching mode, but received 1 property read and no method calls\./)
  t.false(plain(readError.message).includes('property calls'))

  substitute(1, 2)
  t.notThrows(() => substitute[received](1)(1, 2))
  const selfError = t.throws(() => substitute[received](1)(3), { instanceOf: SubstituteException })
  t.regex(plain(selfError.message), /Expected to receive 1 method call matching @Substitute\(3\), but received none\./)

  t.is(inspect(Substitute.for<any>()), '@Substitute {\n}')
  t.is(`${substitute.someProperty}`, 'property<someProperty>: ')
})
