import test, { ExecutionContext } from 'ava'
import { EventEmitter } from 'events'
import { mock } from 'node:test'

import { Substitute, Arg, mimick, configure, received, didNotReceive, clearReceivedCalls } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 18, engine (mimicked substitutes and messages): the round-17 findings R17-ADV-4, R17-ADV-8, R17-ADV-10 and
// R17-ADV-5, decided in the fix spec as E129, E130, E131 and E132.

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

/** What a call gives, or the name of the error it throws. */
const outcome = (run: () => unknown): unknown => {
  try {
    return run()
  } catch (error) {
    return `threw ${(error as Error).constructor.name}: ${(error as Error).message}`
  }
}

// ---- E129 (R17-ADV-4): node:test's mock of a member of a mimicked substitute comes after the substitute ----------------

const statInstance = () => {
  const stat = (path: string) => ({ size: path.length })
  return { stat, real: { stat } as { stat: (path: string) => { size: number } } }
}

test('R17-ADV-4 (E129) the finding: node:test mock.method with an implementation on a mimicked substitute: setups answer first, the implementation the other calls, each call is recorded once', t => {
  const { stat, real } = statInstance()
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/configured').returns({ size: 99 })

  const implemented: string[] = []
  const spied = mock.method(fs, 'stat', (path: string) => {
    implemented.push(path)
    return { size: -1, path }
  })
  try {
    t.deepEqual(fs.stat('/configured'), { size: 99 }, 'the setup answers, not the implementation')
    t.deepEqual(fs.stat('/xy'), { size: -1, path: '/xy' }, 'the implementation answers what no setup answers')
    t.deepEqual(implemented, ['/xy'], 'the implementation runs only for the call no setup answered')
    t.is(real.stat as unknown, spied, 'the mock is on the instance, behind the substitute')
    t.notThrows(() => fs.received(1).stat('/xy'))
    t.notThrows(() => fs.received(1).stat('/configured'))
    t.notThrows(() => fs.received(2).stat(Arg.any()))
    t.true(failureOf(t, () => fs.didNotReceive().stat('/xy')).includes('Expected to receive 0 method calls matching stat(\'/xy\'), but received 1.'))
    // the mock still counts every call, as when reads gave the mock itself: the one a setup answered with its answer
    t.is(spied.mock.callCount(), 2)
    t.deepEqual(spied.mock.calls.map((call: any) => [call.arguments, call.result]), [[['/configured'], { size: 99 }], [['/xy'], { size: -1, path: '/xy' }]])
  } finally {
    mock.restoreAll()
  }
  t.is(real.stat, stat, 'restoreAll() gives the instance its own function back')
  t.deepEqual(fs.stat('/abc'), { size: 4 })
  t.notThrows(() => fs.received(3).stat(Arg.any()))
})

test('R17-ADV-4 (E129) mock.method without an implementation, then mockImplementation() and mockImplementationOnce(): the setups still answer first', t => {
  const { stat, real } = statInstance()
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/configured').returns({ size: 99 })

  const spied = mock.method(fs, 'stat')
  try {
    t.deepEqual([fs.stat('/configured'), fs.stat('/xy')], [{ size: 99 }, { size: 3 }], 'without an implementation, the original runs')
    spied.mock.mockImplementation(() => ({ size: -2 }))
    t.deepEqual([fs.stat('/configured'), fs.stat('/ab')], [{ size: 99 }, { size: -2 }])
    spied.mock.mockImplementationOnce(() => ({ size: -3 }))
    t.deepEqual(fs.stat('/once'), { size: -3 }, 'a once-implementation for a call no setup answers')
    t.deepEqual(fs.stat('/after'), { size: -2 })
    t.is(spied.mock.callCount(), 6)
    t.notThrows(() => fs.received(2).stat('/configured'))
    t.notThrows(() => fs.received(1).stat('/ab'))
    t.notThrows(() => fs.received(1).stat('/once'))
    t.notThrows(() => fs.received(6).stat(Arg.any()))
  } finally {
    mock.restoreAll()
  }
  t.is(real.stat, stat)
})

test('R17-ADV-4 (E129) reads give a member handle, whose `mock` is the mock\'s context; descriptors, configure() and setups that throw', t => {
  const { real } = statInstance()
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/bad').throws(new Error('bad path'))
  const spied = mock.method(fs, 'stat', () => ({ size: 0 }))
  try {
    t.not(fs.stat, spied, 'a read gives the member handle')
    t.is(fs.stat.mock, spied.mock, 'node:test\'s `obj.m.mock` works on it, as on the mock')
    t.is(fs.stat, fs.stat)
    // a setup made after the mock answers first, as any setup
    fs[configure]().stat('/later').returns({ size: 7 })
    t.deepEqual(fs.stat('/later'), { size: 7 })
    // a setup that throws: the error goes on, the call is recorded once and the mock sees it
    t.is(outcome(() => fs.stat('/bad')), 'threw Error: bad path')
    t.notThrows(() => fs.received(1).stat('/bad'))
    t.is(fs.stat.mock.callCount(), 2)
    t.is(spied.mock.calls[1].error?.message, 'bad path')
    // the descriptor's value is a member handle, and Object.keys lists the instance's keys
    t.not(Object.getOwnPropertyDescriptor(fs, 'stat')!.value, spied)
    t.deepEqual(Object.keys(fs), ['stat'])
    // a check, also one with a matcher, does not call the mock
    t.notThrows(() => fs.received(1).stat(Arg.is((path: string) => path === '/later')))
    t.is(spied.mock.callCount(), 2)
  } finally {
    mock.restoreAll()
  }
})

test('R17-ADV-4 (E129) a function that wraps a member handle on the instance (node:test\'s mock.fn of it) is a method, not a substitute value', t => {
  const real: any = { stat: (path: string) => ({ size: path.length }) }
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/configured').returns({ size: 99 })
  const wrapped = mock.fn(fs.stat, () => ({ size: -1 }))
  real.stat = wrapped
  t.deepEqual([fs.stat('/configured'), fs.stat('/xy')], [{ size: 99 }, { size: -1 }])
  t.notThrows(() => fs.received(1).stat('/xy'))
  t.notThrows(() => fs.received(2).stat(Arg.any()))
  t.is(wrapped.mock.callCount(), 2)
  // a substitute that the instance holds is still read as itself (D12, D31)
  const child = Substitute.for<any>()
  real.child = child
  t.is(fs.child, child)
})

test('R17-ADV-4 (E129) plain substitutes and other spies are unchanged: mock.method still throws on a substitute that mimicks nothing', t => {
  const api = Substitute.for<any>()
  t.throws(() => mock.method(api, 'fetch'), { instanceOf: TypeError })
  // a jest-style spy (an ordinary function) on a mimicked substitute sees only the calls no setup answers, as before
  const { real } = statInstance()
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/configured').returns({ size: 99 })
  const original = fs.stat
  const calls: unknown[][] = []
  fs.stat = function (this: unknown, ...args: unknown[]) {
    calls.push(args)
    return original.apply(this, args)
  }
  t.deepEqual([fs.stat('/configured'), fs.stat('/xy')], [{ size: 99 }, { size: 3 }])
  t.deepEqual(calls, [['/xy']])
  t.notThrows(() => fs.received(2).stat(Arg.any()))
})

// ---- E130 (R17-ADV-8): Object.defineProperty with default attributes on a mimicked substitute ------------------------

test('R17-ADV-8 (E130) the finding: a key defined with default attributes is the substitute\'s own, non-configurable property, as on a plain object', t => {
  const kBrand = Symbol('kBrand')
  for (const key of [kBrand, 'brand']) {
    const instance: any = { m: () => 1 }
    const sub = Substitute.for<any>()
    sub[mimick](instance)
    const object = {}
    Object.defineProperty(object, key, { value: true })
    Object.defineProperty(sub, key, { value: true })

    t.true(Object.prototype.hasOwnProperty.call(sub, key))
    t.deepEqual(Object.getOwnPropertyDescriptor(sub, key), Object.getOwnPropertyDescriptor(object, key))
    t.deepEqual(Object.getOwnPropertyDescriptor(sub, key), { value: true, writable: false, enumerable: false, configurable: false })
    t.true(Reflect.ownKeys(sub).includes(key))
    t.is(sub[key], true)
    t.false(Object.prototype.hasOwnProperty.call(instance, key), 'the instance is left alone')
    // a forbidden redefinition throws, as on the object
    t.throws(() => Object.defineProperty(object, key, { value: false }), { instanceOf: TypeError })
    t.throws(() => Object.defineProperty(sub, key, { value: false }), { instanceOf: TypeError })
    t.is(sub[key], true)
    // the Proxy invariants hold, and the substitute still delegates to the instance
    t.notThrows(() => Object.getOwnPropertyDescriptors(sub))
    t.is(sub.m(), 1)
    t.notThrows(() => sub.received(1).m())
    t.notThrows(() => Object.freeze(sub))
    t.true(Object.isFrozen(sub))
  }
})

test('R17-ADV-8 (E130) a key the instance has keeps its attributes, and a configurable definition goes to the instance, as before', t => {
  const instance: any = { port: 80 }
  const sub = Substitute.for<any>()
  sub[mimick](instance)
  // an own key of the instance: defined there, with the instance's attributes for those not given
  Object.defineProperty(sub, 'port', { value: 443 })
  t.is(instance.port, 443)
  t.deepEqual(Object.getOwnPropertyDescriptor(instance, 'port'), { value: 443, writable: true, enumerable: true, configurable: true })
  t.is(sub.port, 443)
  // a new key with `configurable: true` (what spies define): on the instance, and listed as the instance's (E51)
  Object.defineProperty(sub, 'host', { value: 'localhost', enumerable: true, configurable: true, writable: true })
  t.is(instance.host, 'localhost')
  t.deepEqual(Object.keys(sub), ['port', 'host'])

  // a method on the prototype of a class instance, defined as vi.spyOn does (configurable): on the instance, deleted again
  class Client { query(sql: string) { return 'rows for ' + sql } }
  const client = new Client()
  const substitute = Substitute.for<any>()
  substitute[mimick](client)
  const original = substitute.query
  Object.defineProperty(substitute, 'query', { configurable: true, writable: true, value: (sql: string) => 'spied ' + original(sql) })
  t.true(Object.prototype.hasOwnProperty.call(client, 'query'))
  t.is(substitute.query('x'), 'spied rows for x')
  t.true(delete substitute.query)
  t.false(Object.prototype.hasOwnProperty.call(client, 'query'))
})

// ---- E131 (R17-ADV-10): the instance's own calls through `this` of a member a spy replaced ----------------------------

class OrderService {
  place(order: { id: number }): string { return this.validate(order) ? 'placed' : 'rejected' }
  validate(order: { id: number }): boolean { return order.id > 0 }
}

/** The same with own methods (node:test's mock.method takes only own methods). */
const orderObject = () => ({
  place(order: { id: number }): string { return this.validate(order) ? 'placed' : 'rejected' },
  validate(order: { id: number }): boolean { return order.id > 0 }
})

/** jest.spyOn's steps on an object (see round17-mimick.test.ts): an assignment of a mock that forwards to the original. */
const jestStyleSpy = (object: any, key: string): unknown[][] => {
  const original = object[key]
  const calls: unknown[][] = []
  object[key] = function (this: unknown, ...args: unknown[]) {
    calls.push(args)
    return original.apply(this, args)
  }
  return calls
}

/** vi.spyOn's steps (@vitest/spy): the spy is defined by descriptor in place of the method found. */
const viStyleSpy = (object: any, key: string): unknown[][] => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  const original = descriptor !== undefined ? descriptor.value : object[key]
  const calls: unknown[][] = []
  const spy = function (this: unknown, ...args: unknown[]) {
    calls.push(args)
    return original.apply(this, args)
  }
  const { value: _value, ...attributes } = descriptor ?? { configurable: true, writable: true }
  Object.defineProperty(object, key, { ...attributes, value: spy })
  return calls
}

/** An assignment wrapper that forwards with call (instrumentation). */
const wrapperSpy = (object: any, key: string): unknown[][] => {
  const original = object[key]
  const calls: unknown[][] = []
  object[key] = function (this: unknown, order: unknown) {
    calls.push([order])
    return original.call(this, order)
  }
  return calls
}

/** node:test's mock.method, without an implementation. */
const nodeMock = (object: any, key: string): unknown[][] => {
  const spied: any = mock.method(object, key)
  return new Proxy([], { get: (_target, property) => (spied.mock.calls.map((call: any) => call.arguments) as any)[property] })
}

test('R17-ADV-10 (E131) the finding: with a spy or a wrapper on a mimicked member, the instance\'s own call of it through `this` is not recorded and no setup answers it', t => {
  const tools = [['jest-style', jestStyleSpy], ['vi-style', viStyleSpy], ['wrapper', wrapperSpy], ['node:test', nodeMock]] as const
  for (const [tool, spyOn, kind] of tools.flatMap(([tool, spyOn]) => [[tool, spyOn, 'class'], [tool, spyOn, 'object']] as const)) {
    if (tool === 'node:test' && kind === 'class') continue // (it throws for a method on the prototype, as on any substitute)
    const svc = Substitute.for<any>()
    svc[mimick](kind === 'class' ? new OrderService() : orderObject())
    svc[configure]().validate({ id: 0 }).returns(true) // for other callers of validate()
    const calls = spyOn(svc, 'validate')
    // (installing some of the spies reads the member, which is recorded: E77's hint would name those reads)
    svc[clearReceivedCalls]()
    try {
      t.is(svc.place({ id: 0 }), 'rejected', `${tool} (${kind}): as without the spy, the instance's own validate() decides`)
      t.deepEqual([...calls], [[{ id: 0 }]], `${tool}: the spy still runs`)
      t.true(failureOf(t, () => svc.received(1).validate({ id: 0 }), tool).includes('but received none'), tool)
      t.notThrows(() => svc.didNotReceive().validate(Arg.all()), tool)
      t.notThrows(() => svc.received(1).place({ id: 0 }), tool)
      // a call of the member by the test (or the code under test) is a call of the substitute, as before
      t.true(svc.validate({ id: 0 }), `${tool}: the setup answers`)
      t.false(svc.validate({ id: -1 }), tool)
      t.notThrows(() => svc.received(2).validate(Arg.any()), tool)
    } finally {
      mock.restoreAll()
    }
  }
  // without a spy, as before
  const plainSvc = Substitute.for<any>()
  plainSvc[mimick](new OrderService())
  plainSvc[configure]().validate({ id: 0 }).returns(true)
  t.is(plainSvc.place({ id: 0 }), 'rejected')
  t.notThrows(() => plainSvc.didNotReceive().validate(Arg.all()))
})

test('R17-ADV-10 (E131) EventEmitter.once calls this.on: with a spy on `on`, once() is recorded and `on` is not, and once() answers the substitute (E76)', t => {
  const emitter = Substitute.for<any>()
  emitter[mimick](new EventEmitter())
  const calls = jestStyleSpy(emitter, 'on')
  emitter[clearReceivedCalls]()
  const listener = (): void => undefined
  t.is(emitter.once('saved', listener), emitter)
  t.is(calls.length, 1, 'the spy sees the instance\'s own call')
  t.notThrows(() => emitter.received(1).once('saved', listener))
  t.notThrows(() => emitter.didNotReceive().on(Arg.all()))
  // the test's own call of on() through the substitute is recorded, and the fluent chain stays on the substitute
  t.is(emitter.on('deleted', listener).on('created', listener), emitter)
  t.notThrows(() => emitter.received(2).on(Arg.all()))
  t.is(calls.length, 3)
})

test('R17-ADV-10 (E131) recursion through `this`, a stale handle outside a delegation, and the instance\'s own calls through call and apply', t => {
  // recursion through `this` with a spy: one record, as without the spy
  const recursive = Substitute.for<any>()
  recursive[mimick]({ fact(this: any, n: number): number { return n <= 1 ? 1 : n * this.fact(n - 1) } })
  const factCalls = jestStyleSpy(recursive, 'fact')
  t.is(recursive.fact(4), 24)
  t.is(factCalls.length, 4)
  t.notThrows(() => recursive.received(1).fact(Arg.any()))
  t.notThrows(() => recursive.received(1).fact(4))

  // with the substitute as `this`, the first recursive read is a fresh read of the substitute, as before
  const onSubstitute = Substitute.for<any>()
  onSubstitute[mimick]({ fact(this: any, n: number): number { return n <= 1 ? 1 : n * this.fact(n - 1) } })
  t.is(onSubstitute.fact.call(onSubstitute, 4), 24)
  t.notThrows(() => onSubstitute.received(2).fact(Arg.any()))

  // a stale handle called from the test, outside any delegation, is a call like any other
  const svc = Substitute.for<any>()
  svc[mimick](new OrderService())
  const original = svc.validate
  jestStyleSpy(svc, 'validate')
  t.true(original({ id: 1 }))
  t.notThrows(() => svc.received(1).validate({ id: 1 }))

  // the instance's own calls made with call() and apply() through the spy
  class Viaapply {
    run(this: any, x: number): number { return this.helper.apply(this, [x]) + this.helper.call(this, x) }
    helper(x: number): number { return x * 2 }
  }
  const via = Substitute.for<any>()
  via[mimick](new Viaapply())
  via[configure]().helper(1).returns(100)
  const helperCalls = jestStyleSpy(via, 'helper')
  via[clearReceivedCalls]()
  t.is(via.run(1), 4)
  t.is(helperCalls.length, 2)
  t.notThrows(() => via.didNotReceive().helper(Arg.all()))
  t.is(via.helper(1), 100)
})

// ---- E132 (R17-ADV-5): the 'check that substitute' remedy is code only when its arguments print as code ---------------

/** The fluent-chain hint of a failure message: its line that says where the member was called. */
const fluentHintOf = (message: string): string => message.split('\n').find(line => line.includes('further down')) ?? ''

const run = (code: string, sub: unknown) => new Function('sub', 'Arg', 'Symbol', code)(sub, Arg, Symbol)

/**
 * Makes `sub.users.where(value).exec(1)` and checks `sub.received(1).exec(1)`: the hint of the failure, from the line that
 * says where the member was called to the end (an array of more than 6 items prints on several lines).
 */
const whereHint = (t: ExecutionContext, value: unknown): { sub: any, hint: string } => {
  const sub = Substitute.for<any>()
  sub.users.where(value).exec(1)
  const message = failureOf(t, () => sub.received(1).exec(1))
  return { sub, hint: message.slice(message.lastIndexOf('\n', message.indexOf('further down')) + 1).trim() }
}

test('R17-ADV-5 (E132) the finding: arguments that do not print as code give no code; the remedy names the substitute as messages print it, to be reached with the same arguments', t => {
  class Foo { a = 1 }
  const notCode: Record<string, unknown> = {
    date: new Date(0), map: new Map([['a', 1]]), set: new Set([1]), instance: new Foo(), function: function named() { /* empty */ },
    symbol: Symbol('s'), registeredSymbol: Symbol.for('s'), buffer: Buffer.from('ab'), typed: new Uint8Array([1, 2]),
    url: new URL('http://x/y'), error: new Error('boom'), regexp: /x+/g, nullPrototype: Object.assign(Object.create(null), { a: 1 }),
    nestedObject: { a: { b: { c: 1 } } }, nestedArray: [1, [2, { b: 3 }]], longString: 'x'.repeat(150), substitute: Substitute.for<any>(),
    getter: { get a() { return 1 } }, symbolKey: { [Symbol.for('k')]: 1 }, hole: [1, , 3], arrayKeys: Object.assign([1], { total: 1 }),
    manyItems: Array.from({ length: 11 }, (_item, index) => index), manyKeys: Object.fromEntries(Array.from({ length: 11 }, (_item, index) => [`k${index}`, index]))
  }
  for (const [kind, value] of Object.entries(notCode)) {
    const { hint } = whereHint(t, value)
    t.false(hint.includes('check that substitute: sub'), `${kind}: ${hint}`)
    t.regex(hint, /To check calls there, check that substitute, @Substitute\.users\.where\([\s\S]*\), reached with the same arguments, with received\(1\) on it; its arguments cannot be written as code\.$/, `${kind}: ${hint}`)
  }
  // exactly
  t.true(whereHint(t, new Date(0)).hint.endsWith('To check calls there, check that substitute, @Substitute.users.where(1970-01-01T00:00:00.000Z), reached ' +
    'with the same arguments, with received(1) on it; its arguments cannot be written as code.'))
  // the substitute reached with the same arguments: the check passes
  const date = new Date(0)
  const { sub } = whereHint(t, date)
  t.notThrows(() => sub.users.where(date).received(1).exec(1))
})

test('R17-ADV-5 (E132) every code remedy the hint gives runs and makes the check pass', t => {
  const code: Record<string, unknown> = {
    number: 1, negativeZero: -0, nan: NaN, infinity: -Infinity, bigint: BigInt(10), boolean: true, null: null, undefined: undefined,
    string: 'x', quotes: "it's \"q\"\n", template: "it's \"${x}\" `y`", unicode: 'a bé',
    object: { id: 1, name: 'n', 'my-key': null, 2: 'x', nested: {}, list: [] }, array: [1, 'a', null, undefined, {}, []], empty: {},
    emptyArray: [], tenItems: Array.from({ length: 10 }, (_item, index) => index)
  }
  for (const [kind, value] of Object.entries(code)) {
    const { sub, hint } = whereHint(t, value)
    const remedy = /check that substitute: (sub[\s\S]*)\(\.\.\.\)$/.exec(hint)
    if (remedy === null) {
      t.fail(`${kind}: no code remedy: ${hint}`)
      continue
    }
    t.notThrows(() => run(`${remedy[1]}(1)`, sub), `${kind}: ${remedy[1]}(1)`)
  }
  // several arguments, all code
  const sub = Substitute.for<any>()
  sub.users.where({ id: 1 }, 'a', BigInt(2)).limit(1).exec(1)
  const hint = fluentHintOf(failureOf(t, () => sub.received(1).exec(1)))
  t.true(hint.endsWith("check that substitute: sub.users.where({ id: 1 }, 'a', 2n).limit(1).received(1).exec(...)"), hint)
  t.notThrows(() => run("sub.users.where({ id: 1 }, 'a', 2n).limit(1).received(1).exec(1)", sub))
  // one argument on the path is not code: no code for the path
  const mixed = Substitute.for<any>()
  mixed.users.where({ id: 1 }).at(new Date(0)).exec(1)
  t.true(fluentHintOf(failureOf(t, () => mixed.received(1).exec(1))).includes('check that substitute, @Substitute.users.where({ id: 1 }).at(1970-01-01T00:00:00.000Z), reached'))
})

test('R17-ADV-5 (E132) the other remedies are unchanged: unregistered symbols and long paths, shared substitutes, and checks in every form', t => {
  // a member that cannot be written: as before, also when an argument is not code either
  const local = Symbol('local')
  const symbolCheck = Substitute.for<any>()
  symbolCheck.p[local](new Date(0)).run()
  t.true(fluentHintOf(failureOf(t, () => symbolCheck.received(1).run())).endsWith('its path cannot be written as code ' +
    '(a symbol that is not registered with Symbol.for(), or more than 1000 characters).'))
  // a shared substitute returned to one call: written as that call, when its arguments are code
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  io.to('room-a').volatile.emit('m')
  const shared = fluentHintOf(failureOf(t, () => io.to('room-a').received(1).emit('m')))
  t.true(shared.includes("check that substitute: sub.to('room-a').volatile.received(1).emit(...)"), shared)
  // the symbol forms and didNotReceive-free counts give the same remedy
  const sub = Substitute.for<any>()
  sub.users.where(new Map()).exec(1)
  t.true(fluentHintOf(failureOf(t, () => sub[received](1).exec(1))).includes('reached with the same arguments, with received(1) on it'))
  t.true(fluentHintOf(failureOf(t, () => sub[received]().exec(1))).includes('reached with the same arguments, with received() on it'))
  t.notThrows(() => sub[didNotReceive]().exec(1))
})
