import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg, clearReceivedCalls, configure, didNotReceive, mimick, received, returns, throws, resolves, rejects, mimicks } from '../../../src'
import { isSubstituteProxy } from '../../../src/shared'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'
import { deferredReports } from '../../../src/internals/Assertions'

// Round 10: the behaviour findings of round 9 (R9-ADV-*, R9V-*) assigned to engine B, decided in the fix spec as
// E55-E58.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** What a substitute recorded and has configured, without the colours. */
const printout = (substitute: unknown) => plain(inspect(substitute))

// ---- E55: substitutes are recognised by identity, not by their prototype ----------------------------------------

class EventEmitter {
  on(_event: string): unknown { return 'real' }
  emit(_event: string): unknown { return 'real' }
}

/** Every way to get a substitute whose prototype was replaced: a root, a function substitute and an auto-substitute. */
const reprototypedSubstitutes = (): Array<[string, any]> => {
  const root = Substitute.for<any>()
  Object.setPrototypeOf(root, EventEmitter.prototype)
  const fn = Substitute.for<any>()
  Object.setPrototypeOf(fn, Function.prototype)
  const app = Substitute.for<any>()
  Object.setPrototypeOf(app.events, EventEmitter.prototype)
  return [['root', root], ['function', fn], ['auto-substitute', app.events]]
}

test('R9-ADV-2 (E55) after Object.setPrototypeOf(sub, Cls.prototype) every symbol API works as before', t => {
  for (const [name, s] of reprototypedSubstitutes()) {
    t.true(isSubstituteProxy(s), name)

    s.emit('a')
    t.notThrows(() => s[received](1).emit('a'), name)
    t.throws(() => s[received](2).emit('a'), { instanceOf: SubstituteException }, name)
    t.notThrows(() => s[didNotReceive]().emit('b'), name)
    t.throws(() => s[didNotReceive]().emit('a'), { instanceOf: SubstituteException }, name)

    s[configure]().on('x').returns(2)
    t.is(s.on('x'), 2, name)

    s[clearReceivedCalls]()
    t.notThrows(() => s[didNotReceive]().emit('a'), name)

    // the substitution symbols on its members and calls
    s.on('y')[returns]('y')
    t.is(s.on('y'), 'y', name)
    s.fail()[throws](new Error('boom'))
    t.throws(() => s.fail(), { message: 'boom' }, name)
    s.load()[resolves](1)
    s.lose()[rejects](new Error('lost'))
    s.twice(1)[mimicks]((n: number) => n * 2)
    t.is(s.twice(1), 2, name)

    s[mimick]({ ping: () => 'pong' })
    t.is(s.ping(), 'pong', name)

    // still an instance of the class
    if (name !== 'function') t.true(s instanceof EventEmitter, name)
  }
})

test('R9-ADV-2 (E55) a substitute whose prototype was replaced keeps its printout in String(), template strings and JSON', async t => {
  for (const [name, s] of reprototypedSubstitutes()) {
    s.emit('a')
    s.on('x').returns(1)
    const printed = String(s)
    t.true(printed.startsWith('@Substitute'), `${name}: ${printed}`)
    t.true(printed.includes("emit('a')"), `${name}: ${printed}`)
    t.true(printed.includes("on('x') => returns(1)"), `${name}: ${printed}`)
    t.is(`${s}`, printed, name)
    t.is(JSON.parse(JSON.stringify({ s })).s, printed, name)
    // (util.inspect still shows the library's internal function with the new prototype, as before round 9: it looks at
    // the target of a proxy without calling its traps)
  }

  // a substitute that mimicks an instance still serializes as the instance (E51)
  const mimicking = Substitute.for<any>()
  Object.setPrototypeOf(mimicking, EventEmitter.prototype)
  mimicking[mimick]({ id: 7 })
  t.is(JSON.stringify(mimicking), '{"id":7}')

  // setting the prototype back makes no difference
  const back = Substitute.for<any>()
  Object.setPrototypeOf(back, EventEmitter.prototype)
  Object.setPrototypeOf(back, Function.prototype)
  t.true(isSubstituteProxy(back))
  t.true(String(back).startsWith('@Substitute'))
  t.notThrows(() => back[didNotReceive]().emit())
  await Promise.resolve() // (no deferred report is left behind)
})

test('R9-ADV-2 (E55) a substitute whose prototype was replaced is an argument, a configured value and a new.target like any other substitute', t => {
  const repo = Substitute.for<any>()
  Object.setPrototypeOf(repo, EventEmitter.prototype)

  // as an argument: compared by identity, never as a matcher
  const host = Substitute.for<any>()
  host.use(repo)
  t.notThrows(() => host.received(1).use(repo))
  t.notThrows(() => host.received(1).use(Arg.any('function')))
  t.throws(() => host.received(1).use(Substitute.for<any>()), { instanceOf: SubstituteException })
  host.take(repo).returns(7)
  t.is(host.take(repo), 7)

  // as the new.target of `new` on itself: a construction of the substitute, which gives the auto-substitute of the call
  const made = new repo(1)
  t.true(isSubstituteProxy(made))
  t.is(new repo(1), made)
  t.notThrows(() => repo[received](2)(1))

  // as a configured value: a nested setup through it goes to it (D31), and a setup chained to it in the same
  // expression leaves out the read that handed it out (E39)
  const app = Substitute.for<any>()
  app.repo.returns(repo)
  app[configure]().repo.on('n').returns('nested')
  t.is(app.repo.on('n'), 'nested')
  app.repo.find(2).returns('found')
  t.is(repo.find(2), 'found')
  app[clearReceivedCalls]()
  app.repo.find(3).returns('three')
  t.notThrows(() => app[didNotReceive]().repo, 'the setup chained to the configured value recorded no read')

  // assignments by the code under test are recorded, as on any substitute (not created as real properties)
  repo.level = 3
  t.notThrows(() => { repo[received](1).level = 3 })
  t.false(Object.prototype.hasOwnProperty.call(repo, 'level'))
})

test('R9-ADV-2 (E55, E46) objects that inherit from a substitute are still no substitutes: Object.create, class extends, also of a substitute whose prototype was replaced', t => {
  const symbols = [received, didNotReceive, configure, mimick, clearReceivedCalls, returns, throws, resolves, rejects, mimicks]
  const reprototyped = Substitute.for<any>()
  Object.setPrototypeOf(reprototyped, EventEmitter.prototype)
  const sdk = Substitute.for<any>()
  class Plugin extends (sdk.Base as new () => object) {
    public readonly id = 1
  }
  class FromRoot extends (Substitute.for<any>() as new () => object) {
    public readonly id = 2
  }
  class FromReprototyped extends (reprototyped as new () => object) {
    public readonly id = 3
  }
  // what Object.prototype.toString gives for an object with any function proxy in its prototype chain (Node.js 20 says
  // Function)
  const tag = Object.prototype.toString.call(Object.create(new Proxy(function () { }, {})))
  const inheriting: Array<[string, any, string]> = [
    ['Object.create(sub)', Object.assign(Object.create(Substitute.for<any>()), { id: 0 }), '{"id":0}'],
    ['Object.create(sub.member)', Object.assign(Object.create(sdk.config), { id: 0 }), '{"id":0}'],
    ['Object.create(reprototyped)', Object.assign(Object.create(reprototyped), { id: 0 }), '{"id":0}'],
    ['instance of class extends sub.Base', new Plugin(), '{"id":1}'],
    ['instance of class extends a root substitute', new FromRoot(), '{"id":2}'],
    ['instance of class extends a reprototyped substitute', new FromReprototyped(), '{"id":3}']
  ]
  for (const [name, value, json] of inheriting) {
    t.false(isSubstituteProxy(value), name)
    for (const symbol of symbols) t.is(value[symbol], undefined, `${name}: ${String(symbol)}`)
    t.is(JSON.stringify(value), json, name)
    t.is(String(value), tag, name)
    t.is(`${value}`, tag, name)
    t.false(inspect(value).includes('@Substitute'), name)
    // an ordinary argument: recorded and checked (not a matcher)
    const sink = Substitute.for<any>()
    sink.accept(value)
    t.notThrows(() => sink.received(1).accept(value), name)
  }
  // the classes themselves
  for (const [name, cls] of [['Plugin', Plugin], ['FromRoot', FromRoot], ['FromReprototyped', FromReprototyped]] as const) {
    t.false(isSubstituteProxy(cls), name)
    for (const symbol of symbols) t.is((cls as any)[symbol], undefined, `${name}: ${String(symbol)}`)
    t.true(String(cls).startsWith('class '), name)
  }
  // nothing of this was recorded on the substitutes
  for (const s of [sdk, reprototyped]) {
    t.false(/Symbol\(|toJSON|toString|valueOf/.test(printout(s)), printout(s))
    t.false(/Symbol\(|toJSON|toString|valueOf/.test(String(s)), String(s))
  }
})

// ---- E57: lookups that only pass through a substitute for unknown symbols ---------------------------------------

test('R9V-2 (E57) a private symbol read through an object that inherits from a substitute reads undefined and records nothing', t => {
  const kKeyType = Symbol('kKeyType') // like Node.js 20's KeyObject probe in isDeepStrictEqual
  const sdk = Substitute.for<any>()
  class Plugin extends (sdk.Base as new () => object) {
    constructor(public readonly id: number) { super() }
  }
  const plugin = new Plugin(1) as any
  t.is(plugin[kKeyType], undefined)
  t.is((Plugin as any)[kKeyType], undefined)
  t.is(Object.create(sdk)[kKeyType], undefined)
  t.is(plugin[Symbol.iterator], undefined)
  t.false(printout(sdk).includes('kKeyType'), printout(sdk))
  t.false(printout(sdk).includes('Symbol('), printout(sdk))

  // the substitute itself still records such a read, and a configured key answers through an inheriting object too
  void sdk[kKeyType]
  t.true(printout(sdk).includes('Symbol(kKeyType)'))
  const base = Substitute.for<any>()
  base[configure]()[kKeyType].returns('configured')
  t.is(Object.create(base)[kKeyType], 'configured')
  const mimicking = Substitute.for<any>()
  mimicking[mimick]({ [kKeyType]: 'mimicked' })
  t.is(Object.create(mimicking)[kKeyType], 'mimicked')

  // registered symbols of other code read as usual (recorded)
  const registered = Symbol.for('some.library:probe')
  const other = Substitute.for<any>()
  void Object.create(other)[registered]
  t.true(printout(other).includes('Symbol(some.library:probe)'), printout(other))
})

test('R9V-2 (E57) comparing arguments that inherit from a substitute records nothing on it, and matches as for ordinary objects', t => {
  const sdk = Substitute.for<any>()
  class Plugin extends (sdk.Base as new () => object) {
    constructor(public readonly id: number) { super() }
  }
  const host = Substitute.for<any>()
  host.register(new Plugin(1))
  t.throws(() => host.received(1).register(new Plugin(999)), { instanceOf: SubstituteException })
  t.notThrows(() => host.received(1).register(new Plugin(1)))
  t.notThrows(() => host.didNotReceive().register(new Plugin(2)))
  const svc = Substitute.for<any>()
  svc.save(new Plugin(1)).returns('saved-1')
  t.is(svc.save(new Plugin(1)), 'saved-1')
  t.not(svc.save(new Plugin(5)), 'saved-1')

  // only the class definition (Base.prototype) and the constructions are recorded on the base substitute
  const lines = printout(sdk).split('\n').map(line => line.trim()).filter(line => line !== '' && !/^[@}]|received:|configured:/.test(line))
  t.deepEqual([...new Set(lines)], ['Base.prototype', 'new Base()'], printout(sdk))
})

// ---- E56: dangling check views, tracked one by one ---------------------------------------------------------------

const anyOf = Arg.any as unknown as (type: string) => unknown
const isOf = Arg.is as unknown as (predicate: unknown) => unknown

/** The messages of every report that the scheduled reports throw. */
const reportsOf = (clock: ReturnType<typeof interceptDeferredReports>): string[] =>
  clock.run().map(error => {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message)
  })

test('R9V-1 (E56) a check whose matcher argument throws a usage error leaves no "checked nothing" report behind', t => {
  const clock = interceptDeferredReports()
  try {
    const listener = Substitute.for<any>()
    listener('x')
    t.throws(() => listener.received(1)(anyOf('String')), { instanceOf: TypeError })
    t.throws(() => listener.didNotReceive()(isOf('x')), { instanceOf: TypeError })
    t.throws(() => listener[received](1)(anyOf('Strin')), { instanceOf: TypeError })
    t.throws(() => listener[didNotReceive]()(isOf(5)), { instanceOf: TypeError })
    const sub = Substitute.for<any>()
    t.throws(() => sub.m.received(1)(isOf('bad')), { instanceOf: TypeError })
    t.throws(() => sub.m[didNotReceive]()(anyOf('Number')), { instanceOf: TypeError })
    t.deepEqual(reportsOf(clock), [])

    // the member forms, as before
    sub.add(1, 2)
    t.throws(() => sub.received(1).add(anyOf('String'), 2), { instanceOf: TypeError })
    t.throws(() => sub[received](1).add(anyOf('String'), 2), { instanceOf: TypeError })
    t.deepEqual(reportsOf(clock), [])

    // a check view that nothing followed on an earlier line is still reported
    listener[received](1)
    t.throws(() => listener[received](1)(anyOf('Strin')), { instanceOf: TypeError })
    listener.didNotReceive()
    t.throws(() => listener.didNotReceive()(anyOf('Strin')), { instanceOf: TypeError })
    const messages = reportsOf(clock)
    t.is(messages.length, 2, messages.join('\n'))
    t.true(messages[0].startsWith('@Substitute[received](1) checked nothing'), messages[0])
    t.true(messages[1].startsWith('@Substitute.didNotReceive() checked nothing'), messages[1])
  } finally {
    clock.uninstall()
  }
})

test('R9-ADV-4 (E56) a dangling check view is reported, also when the same check is completed later in the same tick', t => {
  const clock = interceptDeferredReports()
  try {
    const repo = Substitute.for<any>()
    repo.didNotReceive()
    repo.didNotReceive().delete(Arg.all())
    let messages = reportsOf(clock)
    t.is(messages.length, 1, messages.join('\n'))
    t.true(messages[0].startsWith('@Substitute.didNotReceive() checked nothing'), messages[0])

    const s = Substitute.for<any>()
    s.a()
    s.received(1)
    s.received(1).a()
    s.logger.info('x')
    s.logger.received()
    s.logger.received().info('x')
    messages = reportsOf(clock)
    t.is(messages.length, 2, messages.join('\n'))
    t.true(messages[0].startsWith('@Substitute.received(1) checked nothing'), messages[0])
    t.true(messages[1].startsWith('@Substitute.logger.received() checked nothing'), messages[1])

    // the symbol forms (as before)
    repo[didNotReceive]()
    repo[didNotReceive]().delete(Arg.all())
    t.is(reportsOf(clock).length, 1)

    // the report points at the line of the dangling view
    s.received(1); const danglingLine = new Error().stack!.split('\n')[1]
    s.received(1).a()
    const errors = clock.run()
    t.is(errors.length, 1)
    const at = (frame: string) => frame.replace(/^.*\((.*):\d+\)$/, '$1').replace(/^\s*at /, '')
    t.is(at((errors[0] as Error).stack!.split('\n').find(line => line.includes('round10.test'))!), at(danglingLine))

    // complete checks, and a view stored and used later in the same tick, report nothing
    s.received(1).a()
    s.received(1).a()
    const stored = s.received(1)
    s.b()
    stored.a()
    const twice = s.didNotReceive()
    twice.c()
    twice.d()
    t.deepEqual(reportsOf(clock), [])
    // two views of the same call (the same auto-substitute, D2), each used: nothing is reported, in either order
    const first = s.received(1)
    const second = s.received(1)
    first.a()
    second.a()
    const third = s.received(1)
    const fourth = s.received(1)
    s.b()
    fourth.a()
    third.a()
    t.deepEqual(reportsOf(clock), [])
    // a stored view used later is matched with the latest of the calls still pending: one report for two views
    s.received(1)
    const later = s.received(1)
    s.b()
    later.a()
    t.is(reportsOf(clock).length, 1)
  } finally {
    clock.uninstall()
  }
})

// ---- E58: what a check costs -----------------------------------------------------------------------------------

/** `file:line` of a stack frame line. */
const lineOf = (frame: string): string => {
  const match = /\(?([^\s()]+):(\d+):\d+\)?\s*$/.exec(frame)
  return match === null ? frame : `${match[1]}:${match[2]}`
}

test('R9-ADV-5 (E58) the checks of one synchronous run schedule one microtask, not one each, and their reports come one per microtask, in order', t => {
  const clock = interceptDeferredReports()
  const intercepted = deferredReports.schedule
  let scheduled = 0
  deferredReports.schedule = callback => {
    scheduled++
    intercepted(callback)
  }
  try {
    const s = Substitute.for<any>()
    s.f(1)
    for (let i = 0; i < 100; i++) {
      s[received](1).f(1) // a check view, and the property-style half of .f (f was called: decided when it is invoked)
      s[didNotReceive]().g()
      s.received(1).f(1)
      s.logger.didNotReceive().warn(Arg.all())
    }
    t.is(scheduled, 1)
    t.deepEqual(reportsOf(clock), [])
    t.is(scheduled, 1)

    // three reports in one run: thrown one per microtask, in the order of the checks
    scheduled = 0
    s[received](1)
    s.didNotReceive()
    void s.received(2).f
    const messages = reportsOf(clock)
    t.is(messages.length, 3, messages.join('\n'))
    t.true(messages[0].startsWith('@Substitute[received](1) checked nothing'), messages[0])
    t.true(messages[1].startsWith('@Substitute.didNotReceive() checked nothing'), messages[1])
    t.true(messages[2].includes('Expected to receive 2 property reads matching f, but received none. f was never read as a property'), messages[2])
    t.is(scheduled, 3)
  } finally {
    clock.uninstall()
  }
})

test('R9-ADV-5 (E58) the report of a property-style check that fails later points at the line of the check, with that frame only', t => {
  const clock = interceptDeferredReports()
  const limit = Error.stackTraceLimit
  try {
    Error.stackTraceLimit = 30
    const calculator = Substitute.for<any>()
    calculator.add(1, 2)
    void calculator.received(2).add; const line = new Error().stack!.split('\n')[1]
    void calculator[received](2).add; const symbolLine = new Error().stack!.split('\n')[1]
    const errors = clock.run()
    t.is(errors.length, 2)
    for (const [index, error] of errors.entries()) {
      t.true(error instanceof SubstituteException)
      const frames = (error as Error).stack!.split('\n').filter(text => /^\s+at /.test(text))
      t.is(frames.length, 1, (error as Error).stack)
      t.is(lineOf(frames[0]), lineOf(index === 0 ? line : symbolLine))
    }
    t.true(Error.stackTraceLimit === 30)
  } finally {
    Error.stackTraceLimit = limit
    clock.uninstall()
  }
})

test('R9-ADV-5 (E58) the views that share their traps and printer still print as before: util.inspect, String(), nested, without custom inspection', t => {
  const clock = interceptDeferredReports()
  try {
    const p = Substitute.for<any>()
    p.flag.returns(1)
    p.both(1).returns(2)
    p[configure]().both.returns({ v: 1 })
    const views: Array<[unknown, string]> = [
      [p[received](), '@Substitute.received()'],
      [p.didNotReceive().flag, '@Substitute.didNotReceive().flag'],
      [p[configure](), '@Substitute[configure]()'],
      [p[configure]().flag, '@Substitute.flag (configure)'],
      [p.x.bind(null), '@Substitute.x.bind(null)'],
      [p.both, '@Substitute.both']
    ]
    for (const [view, label] of views) {
      t.is(plain(inspect(view)), label)
      t.is(plain(inspect(view, { colors: true })), label)
      t.is(String(view), label)
      t.is(plain(inspect({ view })), `{ view: ${label} }`)
      // (Node.js 26 marks a proxy there: `Proxy([Function: bound substitute])`)
      t.true(inspect([view], { customInspect: false }).includes('[Function: bound substitute]'), label)
    }
    clock.run() // (the check views above were left on their own on purpose)
  } finally {
    clock.uninstall()
  }
})

// ---- R10-ADV-3, R10-ADV-4: functions that copy a substitute's prototype are not the library's -------------------

/** What mimic-fn does (used by mem, p-memoize, debounce-fn and onetime 6+): the wrapper takes the wrapped function's prototype. */
const mimic = <T extends Function>(wrapper: T, wrapped: Function): T => {
  Object.setPrototypeOf(wrapper, Object.getPrototypeOf(wrapped))
  return wrapper
}

const memoize = (fn: (...args: any[]) => any) => {
  const cache = new Map<string, unknown>()
  return mimic(function memoized(...args: any[]) {
    const key = JSON.stringify(args)
    if (!cache.has(key)) cache.set(key, fn(...args))
    return cache.get(key)
  }, fn)
}

test('R10-ADV-3 a function that copies the prototype of a substitute method prints as a function, is never called by printing and is no substitute', t => {
  const api = Substitute.for<any>()
  api.getUser(1).returns({ id: 1 })
  const getUser = memoize(api.getUser)
  t.deepEqual(getUser(1), { id: 1 })

  t.is(plain(inspect(getUser)), '[Function: memoized]')
  t.false(isSubstituteProxy(getUser))
  t.notThrows(() => api.didNotReceive().getUser(undefined), 'printing did not call the wrapper')

  const registry = Substitute.for<any>()
  registry.register('user', getUser)
  const error = t.throws(() => registry.received(1).register('order', Arg.any()), { instanceOf: SubstituteException })
  t.true(plain(error!.message).includes("register('user', [Function: memoized])"))
  t.notThrows(() => api.received(1).getUser(1))
})

test('R10-ADV-4 a function that copies the prototype of a bound substitute method prints as a function and is never called by printing', t => {
  const api = Substitute.for<any>()
  api.getUser(1).returns({ id: 1 })
  const getUser = memoize(api.getUser.bind(api))
  t.deepEqual(getUser(1), { id: 1 })

  t.is(plain(inspect(getUser)), '[Function: memoized]')
  t.notThrows(() => api.didNotReceive().getUser(), 'printing did not call the wrapper')
  t.false(printout(api).includes('stylize'))
  t.notThrows(() => api.received(1).getUser(1))
})
