import test from 'ava'
import { interceptDeferredReports } from '../../helpers/deferredReports'
import { EventEmitter } from 'events'
import { inspect, types } from 'util'

import { Substitute, Arg, clearReceivedCalls, configure, mimick, received, returns, throws, resolves, rejects, mimicks } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { shouldUseColors } from '../../../src/internals/utilities/Colors'

// Round 2: the amendments of the fix spec (D22-D24, the amended D9 message), the message hints, and fixes from review.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')
const listedLines = (message: string) => plain(message).split('\n').filter(line => line.startsWith('› '))

const substitutionSymbols = { returns, throws, resolves, rejects, mimicks }

test('D22 a substitution symbol read on a root substitute is a usage error', t => {
  for (const [name, symbol] of Object.entries(substitutionSymbols)) {
    const substitute = Substitute.for<any>()
    const error = t.throws<SubstituteException>(() => substitute[symbol], { instanceOf: SubstituteException }, name)
    t.true(error.message.startsWith(`[${name}] cannot be used on a substitute itself`), name)
    t.true(error.message.includes(`sub.member[${name}](value)`), name)
    t.is(error.type, undefined, `${name}: a usage error, not a call count mismatch`)

    // the read was not recorded and nothing was configured
    t.notThrows(() => substitute.received(0)[name], name)
    t.true(types.isProxy(substitute.add(1)), name)

    // the configure view of the substitute rejects them as well
    t.throws(() => substitute[configure]()[symbol], { instanceOf: SubstituteException }, `${name}: configure view`)
    // a mimicking substitute too
    const mimicking = Substitute.for<any>()
    mimicking[mimick]({ value: 1 })
    t.throws(() => mimicking[symbol], { instanceOf: SubstituteException }, `${name}: mimicking`)
  }

  // the error starts at the user's line, not in the library
  const error = t.throws(() => (Substitute.for<any>() as any)[returns](1), { instanceOf: SubstituteException })
  t.regex(error.stack!.split('\n')[1], /amendments\.test/)
})

test('D22 substitution symbols on members and calls, and the string names on the root, keep working', t => {
  const substitute = Substitute.for<any>()
  substitute.value[returns](1)
  substitute.add(1, 2)[returns](3)
  substitute.find(Arg.any())[throws](new Error('nope'))
  substitute.logger.level[returns](4)
  substitute.getCalc()[returns]('calc')
  t.is(substitute.value, 1)
  t.is(substitute.add(1, 2), 3)
  t.throws(() => substitute.find(1), { message: 'nope' })
  t.is(substitute.logger.level, 4)
  t.is(substitute.getCalc(), 'calc')

  // the string names are ordinary members on the root (D11)
  const shop = Substitute.for<any>()
  shop.returns(5)
  t.notThrows(() => shop.received(1).returns(5))
  t.notThrows(() => shop[received](1).returns(5))

  // a substitute returned by a configured call is a root: [returns] on it points to configure()
  const factory = Substitute.for<any>()
  const repository = Substitute.for<any>()
  factory.create('a').returns(repository)
  const error = t.throws(() => factory.create('a')[returns](Substitute.for<any>()), { instanceOf: SubstituteException })
  t.true(error.message.includes('sub[configure]()'))
  factory[configure]().create('a').returns('reconfigured')
  t.is(factory.create('a'), 'reconfigured')
})

test('D23 a message lists at most 50 received calls, then "… and N more"', t => {
  const logger = Substitute.for<any>()
  for (let index = 0; index < 60; index++) logger.log(index)
  const error = t.throws(() => logger.received(1).log('x'), { instanceOf: SubstituteException })
  const message = plain(error.message)
  t.true(message.includes('\n› … and 10 more\n'))
  const lines = listedLines(message)
  t.is(lines.length, 51)
  t.is(lines[0], '› ✘ @Substitute.log(0)')
  t.is(lines[49], '› ✘ @Substitute.log(49)')
  t.is(lines[50], '› … and 10 more')
  t.false(message.includes('@Substitute.log(50)'))
  t.true(message.endsWith('› … and 10 more\n'))

  // the count in the expectation line still covers every call
  const tooMany = t.throws(() => logger.received(61).log(Arg.any()), { instanceOf: SubstituteException })
  t.regex(plain(tooMany.message), /Expected to receive 61 method calls matching log\(Arg\.any\{any\}\), but received 60\./)
  t.true(plain(tooMany.message).includes('› ✔ @Substitute.log(49)\n'))
  t.true(plain(tooMany.message).includes('› … and 10 more'))

  // exactly 50 calls: no "more" line
  const fifty = Substitute.for<any>()
  for (let index = 0; index < 50; index++) fifty.log(index)
  const complete = plain(t.throws(() => fifty.received(1).log('x'), { instanceOf: SubstituteException }).message)
  t.is(listedLines(complete).length, 50)
  t.false(complete.includes('more'))

  // property reads and assignments are capped the same way
  const settings = Substitute.for<any>()
  for (let index = 0; index < 55; index++) {
    void settings.value
    settings.value = index
  }
  const reads = plain(t.throws(() => settings.received(56).value, { instanceOf: SubstituteException }).message)
  t.true(reads.includes('› … and 5 more'))
  const sets = plain(t.throws(() => { settings.received(1).value = -1 }, { instanceOf: SubstituteException }).message)
  t.is(listedLines(sets).length, 51)
  t.true(sets.includes('› ✘ @Substitute.value = 49\n'))
  t.true(sets.includes('› … and 5 more'))
})

test('D24 the colour decision honours FORCE_COLOR, NO_COLOR, NODE_DISABLE_COLORS, TERM=dumb and the TTY', t => {
  const cases: Array<[Record<string, string>, boolean, boolean]> = [
    // [environment, stdout is a TTY, colours]
    [{}, true, true],
    [{}, false, false],
    [{ TERM: 'xterm-256color' }, true, true],
    [{ NO_COLOR: '1' }, true, false],
    [{ NO_COLOR: '' }, true, true],
    [{ NODE_DISABLE_COLORS: '1' }, true, false],
    [{ NODE_DISABLE_COLORS: 'true' }, true, false],
    [{ NODE_DISABLE_COLORS: '' }, true, true],
    [{ TERM: 'dumb' }, true, false],
    [{ TERM: 'dumb', NODE_DISABLE_COLORS: '1', NO_COLOR: '1' }, true, false],
    // FORCE_COLOR forces them on, whatever else is set, and also without a TTY
    [{ FORCE_COLOR: '1' }, false, true],
    [{ FORCE_COLOR: '' }, false, true],
    [{ FORCE_COLOR: '3' }, false, true],
    [{ FORCE_COLOR: '1', TERM: 'dumb' }, false, true],
    [{ FORCE_COLOR: '1', NODE_DISABLE_COLORS: '1' }, false, true],
    [{ FORCE_COLOR: '1', NO_COLOR: '1' }, false, true],
    // ... or off
    [{ FORCE_COLOR: '0' }, true, false],
    [{ FORCE_COLOR: 'false' }, true, false],
    [{ FORCE_COLOR: 'FALSE', TERM: 'xterm' }, true, false]
  ]
  for (const [env, tty, expected] of cases)
    t.is(shouldUseColors(env, () => tty), expected, `${JSON.stringify(env)}, TTY: ${tty}`)

  // the TTY is only looked at when the environment does not decide, and a throwing check means no colours
  let asked = 0
  const askTTY = () => { asked++; return true }
  shouldUseColors({ FORCE_COLOR: '1' }, askTTY)
  shouldUseColors({ NO_COLOR: '1' }, askTTY)
  shouldUseColors({ TERM: 'dumb' }, askTTY)
  t.is(asked, 0)
  t.false(shouldUseColors({}, () => { throw new Error('no stdout') }))
})

const withProcessEnvironment = (environment: Record<string, string | undefined>, tty: boolean, run: () => void) => {
  const names = ['FORCE_COLOR', 'NO_COLOR', 'NODE_DISABLE_COLORS', 'TERM']
  const saved = names.map(name => [name, process.env[name]] as const)
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    for (const name of names) set(name, environment[name])
    Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true, writable: true })
    run()
  } finally {
    for (const [name, value] of saved) set(name, value)
    if (ttyDescriptor !== undefined) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor)
    else delete (process.stdout as any).isTTY
  }
}

test('D24 assertion messages have no ANSI codes with NODE_DISABLE_COLORS or TERM=dumb, unless FORCE_COLOR is set', t => {
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

  withProcessEnvironment({ TERM: 'xterm' }, true, () => t.true(hasAnsi(messageOf()), 'TTY'))
  withProcessEnvironment({ TERM: 'dumb' }, true, () => t.false(hasAnsi(messageOf()), 'TERM=dumb'))
  withProcessEnvironment({ NODE_DISABLE_COLORS: '1' }, true, () => t.false(hasAnsi(messageOf()), 'NODE_DISABLE_COLORS=1'))
  withProcessEnvironment({ NODE_DISABLE_COLORS: '1', FORCE_COLOR: '1' }, true, () => t.true(hasAnsi(messageOf()), 'forced'))
  withProcessEnvironment({ TERM: 'dumb', FORCE_COLOR: '1' }, false, () => t.true(hasAnsi(messageOf()), 'forced without a TTY'))
})

const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message)
  }
  throw new Error('expected the assertion to fail')
}

test('hint: a failed method assertion says when the method was read without being called', t => {
  const hint = (path: string, times: string) =>
    `${path} was read ${times} without being called; reading a method does not count as calling it.`

  const handler = Substitute.for<any>()
  new EventEmitter().on('click', handler.onClick)
  const message = messageOf(() => handler.received(1).onClick('x', 1))
  t.true(message.includes("Expected to receive 1 method call matching onClick('x', 1), but received none."))
  t.true(message.endsWith(`\n${hint('@Substitute.onClick', '1 time')}\n`))
  void handler.onClick
  t.true(messageOf(() => handler.received().onClick(Arg.all())).includes(hint('@Substitute.onClick', '2 times')))

  // nested paths; a read and a call, with a count above the calls (decided when the member is read, D9)
  const app = Substitute.for<any>()
  void app.logger.flush
  app.logger.flush()
  t.true(messageOf(() => app.logger.received(2).flush()).includes(hint('@Substitute.logger.flush', '1 time')))
  t.true(messageOf(() => app.logger.received(1).flush(1)).includes(hint('@Substitute.logger.flush', '1 time')))

  // no hint when there were no reads, or when there were too many calls
  const calculator = Substitute.for<any>()
  calculator.add(1)
  t.false(messageOf(() => calculator.received(2).add(1)).includes('without being called'))
  t.false(messageOf(() => app.logger.didNotReceive().flush()).includes('without being called'))
  // D36 (round 3): a member that was only read, with a count above the reads, may be a method (the failure is
  // decided at the read), so it gets the hint too; with fewer expected reads it is a property failure without it
  const settings = Substitute.for<any>()
  void settings.flag
  const property = messageOf(() => settings.received(2).flag)
  t.true(property.includes(hint('@Substitute.flag', '1 time')))
  t.false(property.includes('never called'))
  void settings.flag
  t.false(messageOf(() => settings.received(1).flag).includes('without being called'))
})

test('hint: didNotReceive() on a member that was only read points to clearReceivedCalls (A:RT-3 residual)', t => {
  const handler = Substitute.for<any>()
  const callback = handler.onClick
  new EventEmitter().on('click', callback)

  // forced by D9: the assertion is decided when onClick is read, and it was read once
  const message = messageOf(() => handler.didNotReceive().onClick(42))
  t.true(message.includes('Expected to receive 0 property reads matching onClick, but received 1.'))
  const hint = '@Substitute.onClick was read 1 time but never called. ' +
    'If it is a method that was only read, for example passed as a callback, these reads still fail didNotReceive().onClick(...): ' +
    'the assertion is decided when onClick is read, before it is known whether it is called. ' +
    'Call sub[clearReceivedCalls]() after the arrange step to reset the reads.'
  t.true(message.endsWith(`\n${hint}\n`))
  t.true(messageOf(() => handler.received(0).onClick).includes(hint))

  // the workaround from the hint
  handler[clearReceivedCalls]()
  t.notThrows(() => handler.didNotReceive().onClick(42))
  callback(42)
  const called = messageOf(() => handler.didNotReceive().onClick(42))
  t.true(called.includes('Expected to receive 0 method calls matching onClick(42), but received 1.'))
  t.false(called.includes('never called'))
  t.notThrows(() => handler.didNotReceive().onClick(43))
})

/** The message of a failure that is only reported on process.nextTick (D9); asserts that nothing is thrown before. */
const deferredMessageOf = (t: any, assertion: () => unknown): string => {
  const clock = interceptDeferredReports()
  try {
    t.notThrows(assertion, 'nothing is thrown synchronously')
    const error = t.throws(() => clock.tick(1), { instanceOf: SubstituteException }) as SubstituteException
    return plain(error.message)
  } finally {
    clock.uninstall()
  }
}

test('D9 (amended) the deferred report on a member that was only invoked says it was called as a method', t => {
  const calculator = Substitute.for<any>()
  calculator.m(1)
  const message = deferredMessageOf(t, () => calculator.received(2).m)
  t.is(message.split('\n')[1],
    'Expected to receive 2 property reads matching m, but received none. ' +
    'm was never read as a property; it was called 1 time as a method. To assert calls, invoke it: sub.received(2).m(...)')
  t.true(message.includes('\n› ✘ @Substitute.m(1)\n'))
  // it does not report property reads that never happened
  t.false(/received \d+ property read/.test(message))
  t.false(message.includes('reads and'))

  // more calls than expected, nested substitutes, members that are not identifiers
  const app = Substitute.for<any>()
  app.logger.info('a')
  app.logger.info('b')
  app.logger.info('c')
  t.true(deferredMessageOf(t, () => app.logger.received(2).info)
    .includes('info was never read as a property; it was called 3 times as a method. To assert calls, invoke it: sub.logger.received(2).info(...)'))
  app.getRepository('users')['find-all']()
  t.true(deferredMessageOf(t, () => app.getRepository('users').received(4)['find-all'])
    .includes("To assert calls, invoke it: sub.getRepository('users').received(4)['find-all'](...)"))

  // invoking the member right away cancels the report and gives the method assertion's message
  const error = t.throws(() => calculator.received(2).m(1), { instanceOf: SubstituteException })
  t.regex(plain(error.message), /Expected to receive 2 method calls matching m\(1\), but received 1\./)

  // a member that was also read keeps the property wording, without the explanation
  const component = Substitute.for<any>()
  void component.onChange
  void component.onChange
  component.onChange()
  const ambiguous = deferredMessageOf(t, () => component.received(1).onChange)
  t.true(ambiguous.includes('Expected to receive 1 property read matching onChange, but received 2.\n'))
  t.false(ambiguous.includes('never read as a property'))
})

test('R:RT-8 / D4 / D15 indexing literal substitutions does not change which substitution answers a call', t => {
  const calculator = Substitute.for<any>()
  // the most specific class wins, then the most recent one (D4)
  calculator.add(1, 2).returns('literal')
  calculator.add(Arg.any(), 2).returns('predicate')
  calculator.add(Arg.all()).returns('wildcard')
  calculator.add(Arg.any(), Arg.any()).returns('newer predicate')
  t.is(calculator.add(1, 2), 'literal')
  t.is(calculator.add(5, 2), 'newer predicate')
  // E22 (round 7): add(5) has an omitted second argument, which Arg.any() matches, so the predicate class answers it
  t.is(calculator.add(5), 'newer predicate')
  t.is(calculator.add(5, 2, 3), 'wildcard')
  calculator[configure]().add(1, 2).returns('newer literal')
  t.is(calculator.add(1, 2), 'newer literal')

  // values that look alike are still told apart, values that are equal still match
  const values = Substitute.for<any>()
  const long = 'x'.repeat(100)
  const symbol = Symbol('s')
  const fn = () => 1
  const other = Substitute.for<any>()
  values.f(0).returns('0')
  values[configure]().f(-0).returns('-0')
  values.f(NaN).returns('NaN')
  values.f(1).returns('number')
  values.f('1').returns('string')
  values.f(BigInt(1)).returns('bigint')
  values.f(`${long}a`).returns('long a')
  values.f(`${long}b`).returns('long b')
  values.f(symbol).returns('symbol')
  values.f(fn).returns('function')
  values.f(other).returns('substitute')
  values.f(undefined).returns('undefined')
  values.f(null).returns('null')
  values.f([1, 2]).returns('array')
  values.f({ a: 1 }).returns('object')
  values.f(new Date(5)).returns('date')
  t.deepEqual(
    [0, -0, NaN, 1, '1', BigInt(1), `${long}a`, `${long}b`, symbol, fn, other, undefined, null].map(value => values.f(value)),
    ['0', '-0', 'NaN', 'number', 'string', 'bigint', 'long a', 'long b', 'symbol', 'function', 'substitute', 'undefined', 'null']
  )
  // E22 (round 7): an omitted argument is undefined, so f() is f(undefined), and so is f(1, undefined) f(1)
  t.is(values.f(), 'undefined')
  t.is(values.f(1, undefined), 'number')
  t.is(values.f([1, 2]), 'array')
  t.is(values.f({ a: 1 }), 'object')
  t.is(values.f(new Date(5)), 'date')
  t.true(types.isProxy(values.f([2, 1])))
  t.true(types.isProxy(values.f({ a: 2 })))
  t.true(types.isProxy(values.f(Symbol('s'))))
  t.true(types.isProxy(values.f(() => 1)))
  t.true(types.isProxy(values.f(1, null)))

  // amended D15 (round 3): mutating an argument object after the setup is not supported, except that the same
  // object still matches; a fresh object equal to the mutated one no longer does, nor one equal to the original
  const repository = Substitute.for<any>()
  const user = { name: 'a', tags: ['x'] }
  repository.save(user).returns('saved')
  user.name = 'b'
  user.tags.push('y')
  t.is(repository.save(user), 'saved')
  t.true(types.isProxy(repository.save({ name: 'b', tags: ['x', 'y'] })))
  t.true(types.isProxy(repository.save({ name: 'a', tags: ['x'] })))
  // ... and the most recent of several matching literal substitutions wins
  const copy = { name: 'b', tags: ['x', 'y'] }
  repository.save(copy, 1).returns('older')
  repository[configure]().save({ name: 'c', tags: [] }, 1).returns('newer')
  copy.name = 'c'
  copy.tags.length = 0
  t.is(repository.save({ name: 'c', tags: [] }, 1), 'newer')

  // re-configuring the same specification replaces the earlier substitution
  const printed = Substitute.for<any>()
  printed.f(1).returns('a')
  printed[configure]().f(1).returns('b')
  printed.f(Arg.any()).returns('c')
  printed[configure]().f(Arg.any()).returns('d')
  t.is(printed.f(1), 'b')
  t.is(printed.f(2), 'd')
  t.regex(inspect(printed), /configured:\n {4}f\(1\) => returns\('b'\)\n {4}f\(Arg\.any\{any\}\) => returns\('d'\)\n\}$/)
})

test('D2 an argument object that is mutated after a call keeps its auto-substitute', t => {
  const api = Substitute.for<any>()
  const request: { id: number, headers?: object } = { id: 1 }
  api.get(request).body.returns('ok')
  const response = api.get(request)
  request.headers = { accept: 'json' }
  t.is(api.get(request), response)
  t.is(api.get(request).body, 'ok')
  t.notThrows(() => api.received(3).get(request))

  // a fresh object that is only equal to the arguments as they were gets its own auto-substitute
  t.not(api.get({ id: 1 }), response)

  // nested assertions through the same object
  const service = Substitute.for<any>()
  const query = { page: 1 }
  service.find(query).log('first')
  query.page = 2
  t.notThrows(() => service.find(query).received(1).log('first'))
})

test('D10 / D11 received(Arg...) followed by a member access is an assertion and reports the invalid count', t => {
  const calculator = Substitute.for<any>()
  calculator.add(1)
  calculator.value = 1

  // it used to configure a member called `received` silently, so the "assertion" always passed
  for (const count of [Arg.any(), Arg.is(() => true), Arg.all()]) {
    t.throws(() => calculator.received(count).add(1), { instanceOf: SubstituteException, message: /non-negative integer/ })
    t.throws(() => calculator.received(count).add(2), { instanceOf: SubstituteException, message: /non-negative integer/ })
    t.throws(() => { calculator.received(count).value = 1 }, { instanceOf: SubstituteException, message: /non-negative integer/ })
    t.throws(() => calculator.received(count).value, { instanceOf: SubstituteException, message: /non-negative integer/ })
  }
  t.throws(() => calculator.logger.received(Arg.any()).info('x'), { instanceOf: SubstituteException, message: /non-negative integer/ })

  // didNotReceive() ignores its arguments, as without matchers: these are real assertions
  t.notThrows(() => calculator.didNotReceive(Arg.any()).add(2))
  t.throws(() => calculator.didNotReceive(Arg.any()).add(1), { instanceOf: SubstituteException, message: /Call count mismatch/ })
  t.notThrows(() => { calculator.didNotReceive(Arg.any()).value = 2 })
  t.throws(() => { calculator.didNotReceive(Arg.any()).value = 1 }, { instanceOf: SubstituteException, message: /Call count mismatch/ })

  // none of this was recorded or configured
  t.notThrows(() => calculator.didNotReceive().received)
  t.notThrows(() => calculator.didNotReceive().didNotReceive)
  t.true(types.isProxy(calculator.received(5)))

  // followed by a substitution method it stays a setup of a member called received (D3, D11)
  const overlapping = Substitute.for<any>()
  overlapping.received(Arg.any()).returns('any')
  overlapping.didNotReceive(Arg.all()).returns('all')
  t.is(overlapping.received(7), 'any')
  t.is(overlapping.didNotReceive(), 'all')
  // ... and so is everything in a configure() view
  overlapping[configure]().received(Arg.any()).returns('configured')
  t.is(overlapping.received(8), 'configured')
})

test('D18 an assignment assertion lists the assignments under "All property assignments to"', t => {
  const settings = Substitute.for<any>()
  settings.isEnabled = true
  void settings.isEnabled
  const message = messageOf(() => { settings.received(1).isEnabled = false })
  t.true(message.startsWith(
    'Call count mismatch in @Substitute.isEnabled:\n' +
    'Expected to receive 1 property assignment matching isEnabled = false, but received none.\n' +
    'All property assignments to @Substitute.isEnabled received so far:\n' +
    '› ✘ @Substitute.isEnabled = true\n'
  ))
  t.is(listedLines(message).length, 1)
  t.true(messageOf(() => settings.received(2).isEnabled).includes('All property or method calls to @Substitute.isEnabled received so far:'))
})
