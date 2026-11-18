import test, { ExecutionContext } from 'ava'
import { deepStrictEqual } from 'assert'
import { callbackify, format, inspect, isDeepStrictEqual, promisify } from 'util'

import { Substitute, Arg, configure, mimick, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 12: the engine part of the round-11 findings (R11-ADV-2, R11-ADV-3, R11FE-5, R11FE-3), decided in the fix spec
// as E64-E66.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')
const printout = (substitute: unknown) => plain(inspect(substitute))

/**
 * What mimic-fn 3 does (used by mem, p-memoize, debounce-fn and onetime) for the function that a wrapper wraps: it
 * copies its own properties (but `length`), its prototype and, lazily, a toString that names it.
 */
const mimicFn = <T extends Function>(to: T, from: Function): T => {
  for (const key of Reflect.ownKeys(from)) {
    if (key === 'length' || key === 'prototype' || key === 'arguments' || key === 'caller') continue
    const descriptor = Object.getOwnPropertyDescriptor(from, key)
    if (descriptor !== undefined) Object.defineProperty(to, key, descriptor)
  }
  if (Object.getPrototypeOf(to) !== Object.getPrototypeOf(from)) Object.setPrototypeOf(to, Object.getPrototypeOf(from))
  return to
}

/** mem: a memoizing wrapper that takes over what it wraps (mimic-fn). */
const mem = (fn: (...args: any[]) => any) => {
  const cache = new Map<string, unknown>()
  return mimicFn(function memoized(...args: any[]) {
    const key = JSON.stringify(args)
    if (!cache.has(key)) cache.set(key, fn(...args))
    return cache.get(key)
  }, fn)
}

/** Every way the code under test or the test prints a value; none of them may throw, call it or record anything. */
const printings = (value: unknown): Record<string, () => string> => ({
  'util.inspect': () => inspect(value),
  'console.log': () => format('%O', { onLoad: value }),
  "util.format('%o')": () => format('%o', value),
  'showProxy': () => inspect([value], { showProxy: true }),
  'colors': () => inspect(value, { colors: true })
})

/** The text that `print` gives, failing the test if it throws. */
const printedBy = (t: ExecutionContext, print: () => string, how: string): string => {
  let text = ''
  t.notThrows(() => { text = plain(print()) }, how)
  return text
}

/** The failure message of a check of another substitute that received the value as an argument. */
const asArgumentInMessage = (value: unknown): string => {
  const registry = Substitute.for<any>()
  registry.register('handler', value)
  const error = (() => {
    try {
      registry.received(1).register('other', Arg.any())
    } catch (error) {
      return error as Error
    }
    return undefined
  })()
  if (!(error instanceof SubstituteException)) throw new Error('the check did not fail')
  return plain(error.message)
}

// ---- E64 (R11-ADV-2, R11-ADV-3): the inspect.custom hooks call `this` only for the library's own targets ----------------

test('R11-ADV-2 printing a natively re-bound memoized handler (mem(api.m.bind(api)).bind(null, x)) never calls it and records nothing', t => {
  const api = Substitute.for<any>()
  api.getUser(1).returns({ id: 1, name: 'Ann' })
  // the code under test memoizes a bound client method, and hands out a callback bound to an id
  const getUser = mem(api.getUser.bind(api))
  const loadFirst = getUser.bind(null, 1)
  const before = printout(api)

  for (const [how, print] of Object.entries(printings(loadFirst))) {
    const text = printedBy(t, print, how)
    t.regex(text, /\[Function: bound [^\]]*\]/, how)
    t.false(text.includes('stylize'), how)
  }
  const message = asArgumentInMessage(loadFirst)
  t.regex(message, /register\('handler', \[Function: bound [^\]]*\]\)/)
  t.false(message.includes('stylize'), message)
  t.is(printout(api), before, 'printing recorded nothing')

  // the code under test calls it once: one call of getUser(1)
  t.deepEqual(loadFirst(), { id: 1, name: 'Ann' })
  t.notThrows(() => api.received(1).getUser(1))
})

test('R11-ADV-2 a handler that the code under test binds, and binds again per action, prints as a function in failure messages and is never called by them', t => {
  class Toolbar {
    readonly bound: Record<string, () => void> = {}
    private readonly onAction: (action: string) => void
    constructor(private readonly bus: any, onAction: (action: string) => void) { this.onAction = onAction.bind(this) }
    render(actions: string[]) {
      for (const action of actions) {
        this.bound[action] = this.onAction.bind(null, action)
        this.bus.on(`click:${action}`, this.bound[action])
      }
    }
    click(action: string) { this.bound[action]() }
  }
  const bus = Substitute.for<any>()
  const handlers = Substitute.for<any>()
  const toolbar = new Toolbar(bus, handlers.select)
  toolbar.render(['save', 'open'])
  const before = printout(handlers)

  const error = t.throws(() => bus.received(1).on('click:close', Arg.any()), { instanceOf: SubstituteException })
  const message = plain(error!.message)
  t.true(message.includes("on('click:save', [Function: bound ])"), message)
  t.false(message.includes('stylize'), message)
  t.notThrows(() => format('registered %O %o', bus, bus))
  t.notThrows(() => inspect(toolbar.bound, { showProxy: true }))
  t.is(printout(handlers), before, 'printing recorded nothing')

  toolbar.click('save')
  t.notThrows(() => handlers.received(1).select('save'))
  t.notThrows(() => handlers.received(1).select(Arg.all()))
})

test('R11-ADV-3 a natively bound substitute (Function.prototype.bind.call(listener, ctx)) prints as a bound function, is never called by printing and records nothing', t => {
  const listener = Substitute.for<any>()
  const bound = Function.prototype.bind.call(listener, { ctx: 1 }) as (...args: any[]) => unknown
  const before = printout(listener)
  for (const [how, print] of Object.entries(printings(bound))) {
    const text = printedBy(t, print, how)
    t.true(text.includes('[Function: bound ]'), `${how}: ${text}`)
  }
  t.true(asArgumentInMessage(bound).includes("register('handler', [Function: bound ])"))
  t.is(printout(listener), before, 'printing recorded nothing')
  t.notThrows(() => listener.didNotReceive()(Arg.all()))

  bound('saved')
  t.notThrows(() => listener.received(1)('saved'))
})

test('R11-ADV-3 a natively bound member, a bound util.promisify wrapper and a re-bound bind view print as functions and record nothing', t => {
  const svc = Substitute.for<any>()
  const fs = Substitute.for<any>()
  const onSaved = Function.prototype.bind.call(svc.onSaved, null, 'x') as () => unknown
  const readConfig = promisify(fs.readFile).bind(null, '/etc/app.json')
  const onDeleted = Function.prototype.bind.call(svc.onDeleted.bind(null), null) as () => unknown
  const before = { svc: printout(svc), fs: printout(fs) }

  for (const value of [onSaved, readConfig, onDeleted]) {
    for (const [how, print] of Object.entries(printings(value))) {
      const text = printedBy(t, print, how)
      t.regex(text, /\[Function: bound [^\]]*\]/, `${how}: ${text}`)
      t.false(text.includes('stylize') || text.includes('.path'), `${how}: ${text}`)
    }
    const message = asArgumentInMessage(value)
    t.regex(message, /register\('handler', \[Function: bound [^\]]*\]\)/, message)
  }
  t.deepEqual({ svc: printout(svc), fs: printout(fs) }, before, 'printing recorded nothing')
  t.false(before.svc.includes("onSaved('x')"))
  t.false(before.fs.includes('/etc/app.json'))

  onSaved()
  t.notThrows(() => svc.received(1).onSaved('x'))
})

test('E64 the targets of substitutes, auto-substitutes and views still print through showProxy and util.format(\'%o\'), frozen or not', t => {
  const sub = Substitute.for<any>()
  sub.a(1)
  sub.b.returns(2)
  const frozen = Substitute.for<any>()
  frozen.x(1)
  Object.freeze(frozen)
  const defined = Substitute.for<any>()
  defined.y(1)
  Object.defineProperty(defined, 'k', { value: 1 })
  const view = sub[received](1)
  const bound = sub.m.bind(null)

  const shown = (value: unknown) => plain(inspect(value, { showProxy: true, depth: 1 }))
  t.true(shown(sub).includes('a(1)'), shown(sub))
  t.true(shown(sub).includes('b => returns(2)'), shown(sub))
  t.true(shown(sub.member).includes('@Substitute.member'), shown(sub.member))
  t.true(shown(frozen).includes('x(1)'), shown(frozen))
  t.true(shown(defined).includes('y(1)'), shown(defined))
  t.true(shown(view).includes('@Substitute.received(1)'), shown(view))
  t.true(shown(bound).includes('@Substitute.m.bind(null)'), shown(bound))
  t.true(plain(format('%o', sub)).includes('a(1)'))
  view.a(1)
})

test('E64 the brand of the targets is not reproduced by a function named like them, by binding a function of that name or by copying prototypes', t => {
  const api = Substitute.for<any>()
  const prototype = Object.getPrototypeOf(api.getUser)
  let calls = 0
  const named = function substitute() { calls++ }
  Object.setPrototypeOf(named, prototype)
  const boundNamed = named.bind(null)
  const lookalike = mimicFn(function () { calls++ }, api.getUser)
  Object.defineProperty(lookalike, 'name', { value: 'bound substitute' })
  Object.defineProperty(lookalike, 'length', { value: 7 })
  for (const value of [named, boundNamed, lookalike, lookalike.bind(null)]) {
    t.notThrows(() => inspect(value))
    t.notThrows(() => inspect(value, { showProxy: true }))
  }
  t.is(calls, 0)
  t.true(inspect(boundNamed).includes('[Function: bound substitute]'))

  // the `name` a substitute reports (E65) never makes a copy look like a target, not even for a member called
  // `substitute` (`bound substitute` is the name of its bound function, but its `length` is 0)
  const odd = Substitute.for<any>()
  const boundMember = odd.substitute.bind(null)
  t.is(Object.getOwnPropertyDescriptor(boundMember, 'name')!.value, 'bound substitute')
  const wrapped = mimicFn(function () { calls++ }, boundMember)
  const promisified = promisify(boundMember)
  for (const value of [wrapped, wrapped.bind(null), promisified, promisified.bind(null), mem(odd.substitute), mem(odd.substitute).bind(null)]) {
    t.notThrows(() => inspect(value))
    t.notThrows(() => inspect(value, { showProxy: true }))
  }
  t.is(calls, 0)
  t.false(printout(odd).includes('substitute()'), printout(odd))
  // an object that inherits the hook directly prints as itself
  const inheriting = Object.create(prototype)
  t.not(inspect(inheriting), '')
  t.false(printout(api).includes('getUser('), printout(api))
})

// ---- E65 (R11FE-5): substitutes have the own `length` and `name` of a function ------------------------------------------

test('R11FE-5 util.callbackify(sub.method), util.callbackify(sub) and util.callbackify of a bound method work as for a plain function', async t => {
  const keys = Substitute.for<any>()
  keys.getKey(Arg.any()).resolves('secret')
  const fn = Substitute.for<any>()
  fn(Arg.all()).resolves(42)
  const api = Substitute.for<any>()
  api.load(1).rejects(new Error('offline'))

  const callbackified = (original: any) => {
    let adapted: any
    t.notThrows(() => { adapted = callbackify(original) })
    return (...args: any[]) => new Promise<[unknown, unknown]>(resolve => adapted(...args, (error: unknown, value: unknown) => resolve([error, value])))
  }
  t.deepEqual(await callbackified(keys.getKey)('kid'), [null, 'secret'])
  t.deepEqual(await callbackified(fn)(1, 2), [null, 42])
  const [error] = await callbackified(api.load.bind(api))(1)
  t.is((error as Error).message, 'offline')

  keys.received(1).getKey('kid')
  fn.received(1)(1, 2)
  api.received(1).load(1)
  // named and sized as Node.js names and sizes the adapter of a function
  const adapted = callbackify(keys.getKey)
  t.is(adapted.name, 'getKeyCallbackified')
  t.is(adapted.length, 1)
  const promisified = promisify(keys.getKey)
  t.is(promisified.name, 'getKey')
  t.is(promisified.length, 0)
})

test('E65 substitutes, auto-substitutes and the views report own, non-enumerable, configurable `length` and `name` data properties', t => {
  const sub = Substitute.for<any>()
  const symbol = Symbol('handler')
  const descriptor = (value: number | string) => ({ value, writable: false, enumerable: false, configurable: true })
  t.deepEqual(Object.getOwnPropertyDescriptors(sub), { length: descriptor(0), name: descriptor('') })
  t.deepEqual(Object.getOwnPropertyDescriptors(sub.getKey), { length: descriptor(0), name: descriptor('getKey') })
  t.deepEqual(Object.getOwnPropertyDescriptors(sub[symbol]), { length: descriptor(0), name: descriptor('[handler]') })
  t.deepEqual(Object.getOwnPropertyDescriptors(sub.make(1)), { length: descriptor(0), name: descriptor('') })
  t.deepEqual(Object.getOwnPropertyDescriptors(sub.load.bind(null)), { length: descriptor(0), name: descriptor('bound load') })
  t.deepEqual(Object.getOwnPropertyDescriptors(sub.bind(null)), { length: descriptor(0), name: descriptor('bound ') })
  const check = sub[received](0)
  t.deepEqual(Reflect.ownKeys(check), ['length', 'name'])
  check.neverRead
  t.deepEqual(Reflect.ownKeys(sub), ['length', 'name'])
  t.deepEqual(Object.getOwnPropertyNames(sub), ['length', 'name'])
  t.true(Object.prototype.hasOwnProperty.call(sub, 'length'))
})

test('E65 reads, `in`, Object.keys, spread, for-in, JSON, printing and equality of a substitute are as before', t => {
  const sub = Substitute.for<any>()
  sub.f(1)
  const printed = printout(sub)
  t.deepEqual(Object.keys(sub), [])
  t.deepEqual({ ...sub }, {})
  t.deepEqual(Object.assign({}, sub), {})
  const forIn: string[] = []
  for (const key in sub) forIn.push(key)
  t.deepEqual(forIn, [])
  t.is(JSON.stringify({ sub }), JSON.stringify({ sub: printed }))
  t.false('length' in sub)
  t.false('name' in sub)
  t.is(printout(sub), printed, 'enumerating recorded nothing')

  // reads of `length` and `name` are member reads, as before: recorded, and configurable
  t.is(typeof sub.length, 'function')
  t.notThrows(() => sub.received(1).length)
  sub.name.returns('svc')
  t.is(sub.name, 'svc')
  t.is(Object.getOwnPropertyDescriptor(sub, 'name')!.value, '')

  // equality compares a substitute by identity, as before
  const other = Substitute.for<any>()
  t.true(isDeepStrictEqual({ a: sub }, { a: sub }))
  t.false(isDeepStrictEqual({ a: sub }, { a: other }))
  t.notThrows(() => deepStrictEqual([sub], [sub]))
  t.throws(() => deepStrictEqual([sub], [other]))

  // a substitute that mimicks an object lists the instance's enumerable keys first
  const mimicking = Substitute.for<any>()
  mimicking[mimick]({ name: 'Ann', a: 1 })
  t.deepEqual(Object.keys(mimicking), ['name', 'a'])
  t.deepEqual(Reflect.ownKeys(mimicking), ['name', 'a', 'length'])
  t.is(Object.getOwnPropertyDescriptor(mimicking, 'name')!.value, 'Ann')
  t.deepEqual({ ...mimicking }, { name: 'Ann', a: 1 })
})

test('E65 freeze, seal, preventExtensions and defineProperty work on substitutes, auto-substitutes and call results, without Proxy invariant errors', t => {
  const restrict: Record<string, (value: unknown) => unknown> = { freeze: Object.freeze, seal: Object.seal, preventExtensions: Object.preventExtensions }
  for (const how of ['freeze', 'seal', 'preventExtensions', 'defineProperty']) {
    const app = Substitute.for<any>()
    for (const value of [app, app.logger, app.make(1)]) {
      if (how === 'defineProperty') Object.defineProperty(value, 'k', { value: 1, enumerable: true })
      else restrict[how](value)
      t.notThrows(() => Object.getOwnPropertyDescriptors(value), how)
      t.is(Object.isExtensible(value), how === 'defineProperty')
      t.is(Object.isFrozen(value), how === 'freeze' || how === 'seal' || how === 'preventExtensions')
      value.x(1)
      t.notThrows(() => value.received(1).x(1), how)
      t.true(printout(value).includes('x(1)'), how)
      if (how === 'defineProperty') {
        // still extensible: the defined property, and a function's `length` and `name`
        t.deepEqual(Reflect.ownKeys(value), ['k', 'length', 'name'])
        t.deepEqual(Object.keys(value), ['k'])
        t.is(value.k, 1)
        t.is(typeof callbackify(value), 'function')
      } else {
        // not extensible: exactly the properties of its target, which has none of its own (so util.callbackify, which
        // reads the descriptor of `length`, cannot adapt it: README documents the arrow function workaround)
        t.deepEqual(Reflect.ownKeys(value), [])
      }
    }
  }
})

// ---- E66 (R11FE-3): a substitute is no sinon spy to sinon-chai --------------------------------------------------------

/** sinon-chai's own predicates (sinon-chai 3.7), which decide whether its assertions can check a value. */
const sinonChai = {
  isSpy: (putativeSpy: any): boolean => typeof putativeSpy === 'function' &&
    typeof putativeSpy.getCall === 'function' &&
    typeof putativeSpy.calledWithExactly === 'function',
  isCall: (putativeCall: any): boolean => Boolean(putativeCall) && sinonChai.isSpy(putativeCall.proxy)
}

test('R11FE-3 sinon-chai does not take a substitute, an auto-substitute or a configured substitute for a spy, so its assertions throw instead of passing', t => {
  const next = Substitute.for<any>()
  const app = Substitute.for<any>()
  const calc = Substitute.for<any>()
  app.getCalc().returns(calc)
  for (const [label, value] of [['root', next], ['auto-substitute', next.member], ['call result', next.load(1)], ['configured', app.getCalc()]] as const) {
    t.false(sinonChai.isSpy(value), label)
    t.false(sinonChai.isCall(value), label)
    // the probe reads `calledWithExactly` as undefined, and does not record it
    t.is(value.calledWithExactly, undefined, label)
    t.false(printout(value).includes('calledWithExactly'), label)
  }
  t.false(printout(next).includes('called'), 'nothing such as `called` was read as a spy property')

  // a substitute standing in for a sinon spy can still be given the member, as with every protocol key
  const spy = Substitute.for<any>()
  spy[configure]().calledWithExactly('x').returns(true)
  t.true(spy.calledWithExactly('x'))
  t.is(typeof spy.calledWithExactly, 'function')
})

test('R11FE-3 jest\'s spy probe (calls.all and calls.count) still answers: a substitute is no jest mock, but `calls` is an ordinary member', t => {
  // jest's isSpy (Jasmine compatibility): what makes jest's toHaveBeenCalled*() accept a value. It cannot be answered
  // with undefined without breaking APIs that have a `calls` member (README 'Test runners': use received() instead).
  const isJestSpy = (received: any) => typeof received.calls?.all === 'function' && typeof received.calls?.count === 'function'
  const client = Substitute.for<any>()
  t.true(isJestSpy(client))
  client.calls.create({ to: '+1' }).resolves({ sid: 'c1' })
  return client.calls.create({ to: '+1' }).then((call: { sid: string }) => {
    t.is(call.sid, 'c1')
    client.calls.received(1).create({ to: '+1' })
  })
})
