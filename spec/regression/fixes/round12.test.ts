import test, { ExecutionContext } from 'ava'
import { format, inspect, promisify } from 'util'

import { Substitute, Arg, received } from '../../../src'
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
  // an object that inherits the hook directly prints as itself
  const inheriting = Object.create(prototype)
  t.not(inspect(inheriting), '')
  t.false(printout(api).includes('getUser('), printout(api))
})
