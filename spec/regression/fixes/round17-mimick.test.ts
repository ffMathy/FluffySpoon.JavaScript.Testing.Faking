import test, { ExecutionContext } from 'ava'
import { EventEmitter } from 'events'
import { mock } from 'node:test'

import { Substitute, Arg, mimick, configure, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { codeMember } from '../../../src/internals/Paths'

// Round 17, engine (mimicked substitutes and messages): the round-16 findings R16FE-3, R16FE-4, R16-ADV-6, R16-ADV-4 and
// the integrator's O2, decided in the fix spec as E114, E115, E112 and E120.

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

/** What a call gives, or the name of the error it throws (a stack overflow shows as RangeError). */
const outcome = (run: () => unknown): unknown => {
  try {
    return run()
  } catch (error) {
    return `threw ${(error as Error).constructor.name}`
  }
}

// ---- E114 (R16FE-3): wrapping a member of a mimicked substitute ------------------------------------------------------

/** Instrumentation of the code under test (OpenTelemetry/shimmer, retry decorators): wraps a method of what it is given. */
function instrument(client: any, seen: string[]) {
  const original = client.query
  client.query = function (this: unknown, ...args: any[]) {
    seen.push(args[0])
    return original.apply(this, args)
  }
}

test('R16FE-3 (E114) the finding: an instrumentation wrapper around a method of a mimicked substitute runs the original once, and the call is recorded once', t => {
  const real = { query: (sql: string) => 'rows for ' + sql }
  const client = Substitute.for<any>()
  client[mimick](real)
  const seen: string[] = []
  instrument(client, seen)

  t.is(outcome(() => client.query('SELECT 1')), 'rows for SELECT 1')
  t.deepEqual(seen, ['SELECT 1'])
  t.notThrows(() => client.received(1).query('SELECT 1'))
  t.notThrows(() => client.didNotReceive().query('SELECT 2'))
  // the wrapper went to the instance, as an assignment does (D12), and the instance's own function is kept by the original
  t.true(real.query !== undefined && !String(real.query).includes('rows for'))

  // as on the plain object
  const object = { query: (sql: string) => 'rows for ' + sql }
  const objectSeen: string[] = []
  instrument(object, objectSeen)
  t.is(object.query('SELECT 1'), 'rows for SELECT 1')
})

/**
 * jest.spyOn's own steps on an object (jest-mock 30, ModuleMocker.spyOn, for a method without a getter), with a mock
 * function of its own that remembers its calls: the original is read, the mock is assigned, and the mock forwards to the
 * original with `original.apply(this, arguments)`; restoring assigns the original back when the object owns the method,
 * and deletes the mock otherwise.
 */
const jestSpyOn = (object: any, key: string) => {
  const original = object[key]
  const isMethodOwner = Object.prototype.hasOwnProperty.call(object, key)
  const calls: unknown[][] = []
  const spy = function (this: unknown, ...args: unknown[]) {
    calls.push(args)
    return original.apply(this, args)
  }
  object[key] = spy
  const restore = () => {
    if (isMethodOwner) object[key] = original
    else delete object[key]
  }
  return { spy, calls, restore, returned: object[key] }
}

test('R16FE-3 (E114) a jest-style spy on a mimicked substitute: it sees the calls no setup answers, each call is recorded once, and restoring it leaves the member working', t => {
  const stat = (path: string) => ({ size: path.length })
  const real = { stat, save: (x: string) => 'saved ' + x }
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/configured').returns({ size: 99 })

  const { spy, calls, restore } = jestSpyOn(fs, 'stat')
  t.is(real.stat as unknown, spy, 'the spy is on the instance, behind the substitute')
  t.deepEqual(outcome(() => fs.stat('/configured')), { size: 99 }, 'a setup still answers')
  t.deepEqual(outcome(() => fs.stat('/xy')), { size: 3 }, 'the spy runs the original')
  t.deepEqual(calls, [['/xy']], 'the spy sees the call that no setup answered')
  t.notThrows(() => fs.received(1).stat('/configured'))
  t.notThrows(() => fs.received(1).stat('/xy'))
  t.notThrows(() => fs.received(2).stat(Arg.any()))

  restore()
  t.is(real.stat, stat, 'the instance has its own function back')
  t.deepEqual(outcome(() => fs.stat('/abc')), { size: 4 })
  t.deepEqual(calls, [['/xy']])
  t.notThrows(() => fs.received(1).stat('/abc'))
  t.notThrows(() => fs.received(3).stat(Arg.any()))
  t.notThrows(() => fs.didNotReceive().stat('/zz'))
})

test('R16FE-3 (E114) a jest-style spy on a mimicked class instance, whose method is on the prototype: the spy is deleted again on restore', t => {
  class Client {
    public queries = 0
    query(sql: string) {
      this.queries++
      return 'rows for ' + sql
    }
  }
  const real = new Client()
  const client = Substitute.for<Client>()
  client[mimick](real)

  const { calls, restore } = jestSpyOn(client, 'query')
  t.is(outcome(() => client.query('x')), 'rows for x')
  t.deepEqual(calls, [['x']])
  t.is(real.queries, 1, 'the method ran on the instance')
  t.notThrows(() => client.received(1).query('x'))

  restore()
  t.false(Object.prototype.hasOwnProperty.call(real, 'query'), 'the prototype method shows again')
  t.is(outcome(() => client.query('y')), 'rows for y')
  t.deepEqual(calls, [['x']])
  t.notThrows(() => client.received(2).query(Arg.any()))
})

test('R16FE-3 (E114) a handle calls the function it was read with, as `const original = obj.m` does; outside a call of the member, its calls are recorded as usual', t => {
  const sub = Substitute.for<any>()
  sub[mimick]({ m: (x: number) => 'original ' + x })
  const original = sub.m
  t.is(sub.m, original, 'the same handle while the instance keeps its function')
  sub.m = (x: number) => 'replaced ' + x
  t.not(sub.m, original, 'another one once it changes')
  t.is(sub.m, sub.m)

  t.is(original(1), 'original 1')
  t.is(sub.m(2), 'replaced 2')
  t.notThrows(() => sub.received(1).m(1))
  t.notThrows(() => sub.received(1).m(2))
  t.notThrows(() => sub.received(2).m(Arg.any()))

  // a setup answers the stale handle too
  sub[configure]().m(3).returns('configured')
  t.is(original(3), 'configured')
  t.is(sub.m(3), 'configured')
})

test('R16FE-3 (E114) wrappers that forward through call, apply, a bound original, new, or a second wrapper: one record per call', t => {
  const viaCall = Substitute.for<any>()
  viaCall[mimick]({ m: (x: number) => 'original ' + x })
  const first = viaCall.m
  viaCall.m = function (this: unknown, x: number) { return 'outer ' + first.call(this, x) }
  const second = viaCall.m
  viaCall.m = function (x: number) { return 'outermost ' + second(x) }
  t.is(outcome(() => viaCall.m(1)), 'outermost outer original 1')
  t.notThrows(() => viaCall.received(1).m(1))
  t.notThrows(() => viaCall.received(1).m(Arg.all()))

  const viaBind = Substitute.for<any>()
  viaBind[mimick]({ m: (x: number) => 'original ' + x })
  const bound = viaBind.m.bind(viaBind)
  viaBind.m = (x: number) => 'wrapped ' + bound(x)
  t.is(outcome(() => viaBind.m(1)), 'wrapped original 1')
  t.notThrows(() => viaBind.received(1).m(1))

  class Connection { constructor(public url: string) { } }
  const viaNew = Substitute.for<any>()
  viaNew[mimick]({ Connection })
  const OriginalConnection = viaNew.Connection
  viaNew.Connection = function (url: string) { return new OriginalConnection('wrapped ' + url) }
  const connection = outcome(() => new viaNew.Connection('db://x')) as Connection
  t.true(connection instanceof Connection)
  t.is(connection.url, 'wrapped db://x')
  t.notThrows(() => viaNew.received(1).Connection('db://x'))
})

test('R16FE-3 (E114) recursion through `this` in a mimicked method and fresh reads are recorded as before', t => {
  // `this` is the instance (D12): the recursive calls do not reach the substitute
  const onInstance = Substitute.for<any>()
  onInstance[mimick]({ fact(this: any, n: number): number { return n <= 1 ? 1 : n * this.fact(n - 1) } })
  t.is(onInstance.fact(4), 24)
  t.notThrows(() => onInstance.received(1).fact(Arg.any()))

  // with the substitute as `this`, the first recursive read is a fresh read of the substitute
  const onSubstitute = Substitute.for<any>()
  onSubstitute[mimick]({ fact(this: any, n: number): number { return n <= 1 ? 1 : n * this.fact(n - 1) } })
  t.is(onSubstitute.fact.call(onSubstitute, 4), 24)
  t.notThrows(() => onSubstitute.received(1).fact(4))
  t.notThrows(() => onSubstitute.received(1).fact(3))
  t.notThrows(() => onSubstitute.received(2).fact(Arg.any()))

  // a method that calls the substitute it belongs to (a closure): every call is recorded
  const closure: any = Substitute.for<any>()
  closure[mimick]({ fact: (n: number): number => n <= 1 ? 1 : n * closure.fact(n - 1) })
  t.is(closure.fact(4), 24)
  t.notThrows(() => closure.received(4).fact(Arg.any()))
  t.notThrows(() => closure.received(1).fact(1))
})

test('R16FE-3 (E114) one of the substitute\'s own member handles on the instance stands for its function: no double counting', t => {
  const real: any = { m: (x: number) => 'original ' + x }
  const sub = Substitute.for<any>()
  sub[mimick](real)
  const original = sub.m
  sub.m = (x: number) => 'replaced ' + x
  real.m = original // put back on the instance directly, not through the substitute
  t.is(outcome(() => sub.m(1)), 'original 1')
  t.notThrows(() => sub.received(1).m(1))
  t.is(sub.m, original)

  // an alias of another member
  real.alias = sub.m
  t.is(outcome(() => sub.alias(2)), 'original 2')
  t.notThrows(() => sub.received(1).alias(2))
  t.notThrows(() => sub.didNotReceive().m(2))

  // assigned through the substitute, the instance gets the function itself back
  sub.m = (x: number) => 'replaced ' + x
  sub.m = original
  t.is(typeof real.m, 'function')
  t.is(real.m(3), 'original 3')
  t.is(sub.m, original)
})

test('R16FE-3 (E114) with configure() setups, re-mimicking, getters, frozen instances and fluent chains (E76)', t => {
  // setups first, then the wrapper and the original
  const fs = Substitute.for<any>()
  fs[mimick]({ stat: (path: string) => ({ size: path.length }) })
  fs[configure]().stat('/c').returns({ size: 99 })
  const seen: string[] = []
  const original = fs.stat
  fs.stat = function (this: unknown, path: string) { seen.push(path); return original.call(this, path) }
  t.deepEqual([fs.stat('/c'), fs.stat('/abc')], [{ size: 99 }, { size: 4 }])
  t.deepEqual(seen, ['/abc'])
  t.notThrows(() => fs.received(2).stat(Arg.any()))
  fs[configure]().stat('/d').returns({ size: 1 })
  t.deepEqual(fs.stat('/d'), { size: 1 })

  // re-mimicking: a handle read from the earlier instance calls what the instance has when it is called, as before
  const remimicked = Substitute.for<any>()
  remimicked[mimick]({ m: () => 'a' })
  const stored = remimicked.m
  remimicked[mimick]({ m: () => 'b' })
  t.deepEqual([stored(), remimicked.m()], ['b', 'b'])
  t.notThrows(() => remimicked.received(2).m())

  // a getter that gives a new function at every read: a new handle each time, as on the instance; each call recorded once
  let reads = 0
  const getter = Substitute.for<any>()
  getter[mimick]({ get m() { reads++; return (x: number) => x + 1 } })
  t.deepEqual([getter.m(1), getter.m(2)], [2, 3])
  t.is(reads, 2, 'read once per call')
  t.notThrows(() => getter.received(2).m(Arg.any()))

  // a frozen instance refuses the wrapper, as an assignment to a frozen object in strict code does; calls still work
  const frozen = Substitute.for<any>()
  frozen[mimick](Object.freeze({ query: (sql: string) => 'rows for ' + sql }))
  t.throws(() => instrument(frozen, []), { instanceOf: TypeError })
  t.is(frozen.query('x'), 'rows for x')
  t.notThrows(() => frozen.received(1).query('x'))

  // a fluent method that returns the instance still answers the substitute through a wrapper (E76)
  const emitter = Substitute.for<any>()
  emitter[mimick](new EventEmitter())
  const on = emitter.on
  emitter.on = function (this: unknown, ...args: any[]) { return on.apply(this, args) }
  t.is(emitter.on('a', () => 1), emitter)
  t.is(emitter.on('a', () => 1).on('b', () => 2), emitter)
  t.notThrows(() => emitter.received(3).on(Arg.all()))
})

// ---- E115 (R16FE-4): tools that wrap a method by its property descriptor ---------------------------------------------

test('R16FE-4 (E115) the finding: node:test mock.method on a mimicked substitute keeps the setups and records each call once, and restoreAll() gives the instance its function back', t => {
  const stat = (path: string) => ({ size: path.length })
  const real = { stat }
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/configured').returns({ size: 99 })

  const spied = mock.method(fs, 'stat')
  try {
    t.deepEqual(fs.stat('/configured'), { size: 99 }, 'a setup answers')
    t.deepEqual(fs.stat('/xy'), { size: 3 })
    t.is(spied.mock.callCount(), 2)
    t.notThrows(() => fs.received(1).stat('/configured'))
    t.notThrows(() => fs.received(1).stat('/xy'))
  } finally {
    mock.restoreAll()
  }
  t.is(real.stat, stat)
  t.deepEqual(fs.stat('/configured'), { size: 99 })
  t.notThrows(() => fs.received(2).stat('/configured'))
  t.notThrows(() => fs.received(3).stat(Arg.any()))
})

/**
 * vitest's vi.spyOn steps (@vitest/spy 5, for a method): the descriptor of the object or its prototype chain gives the
 * original, the spy is defined in its place with the same attributes, and restoring defines the original descriptor
 * again (or deletes the spy, for a method found on a prototype).
 */
const viSpyOn = (object: any, key: string) => {
  let owner: object | undefined
  let descriptor: PropertyDescriptor | undefined
  for (let current = object; current !== null && descriptor === undefined; current = Object.getPrototypeOf(current)) {
    descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor !== undefined) owner = current
  }
  if (descriptor === undefined && !(key in object)) throw new Error(`The property "${key}" is not defined`)
  const original = descriptor !== undefined ? descriptor.value : object[key]
  const calls: unknown[][] = []
  const spy = function (this: unknown, ...args: unknown[]) {
    calls.push(args)
    return original.apply(this, args)
  }
  const { value: _value, ...attributes } = descriptor ?? { configurable: true, writable: true }
  Object.defineProperty(object, key, { ...attributes, value: spy })
  const restore = () => {
    if (owner !== object) Reflect.deleteProperty(object, key)
    else Object.defineProperty(object, key, { ...attributes, value: original })
  }
  return { original, calls, restore }
}

test('R16FE-4 (E115) a descriptor-based spy (vi.spyOn) on a mimicked substitute wraps the member handle: setups answer, each call is recorded once, and restoring brings the instance back', t => {
  const stat = (path: string) => ({ size: path.length })
  const real = { stat, other: 1 }
  const fs = Substitute.for<any>()
  fs[mimick](real)
  fs[configure]().stat('/configured').returns({ size: 99 })

  const { original, calls, restore } = viSpyOn(fs, 'stat')
  t.not(original as unknown, stat, 'the original is the member handle, not the instance\'s function')
  t.deepEqual(fs.stat('/configured'), { size: 99 })
  t.deepEqual(fs.stat('/xy'), { size: 3 })
  t.deepEqual(calls, [['/xy']])
  t.notThrows(() => fs.received(1).stat('/xy'))
  t.notThrows(() => fs.received(2).stat(Arg.any()))
  t.deepEqual(Object.keys(fs), ['stat', 'other'], 'the substitute still enumerates like its instance (E51)')

  restore()
  t.is(real.stat, stat)
  t.deepEqual(fs.stat('/abc'), { size: 4 })
  t.deepEqual(calls, [['/xy']])
  t.notThrows(() => fs.received(3).stat(Arg.any()))
  t.deepEqual(Object.keys(fs), ['stat', 'other'])

  // a method on the prototype of a class instance: found through `in`, deleted from the instance on restore
  class Client { query(sql: string) { return 'rows for ' + sql } }
  const instance = new Client()
  const client = Substitute.for<any>()
  client[mimick](instance)
  const spied = viSpyOn(client, 'query')
  t.is(client.query('x'), 'rows for x')
  t.deepEqual(spied.calls, [['x']])
  spied.restore()
  t.false(Object.prototype.hasOwnProperty.call(instance, 'query'))
  t.is(client.query('y'), 'rows for y')
  t.notThrows(() => client.received(2).query(Arg.any()))
})

test('R16FE-4 (E115) a mimicked method reports its member handle as its value; the descriptors of plain values and accessors are the instance\'s', t => {
  const instance = { port: 80, get host() { return 'localhost' }, run: () => 'ran' }
  const sub = Substitute.for<any>()
  sub[mimick](instance)

  const run = Object.getOwnPropertyDescriptor(sub, 'run')!
  t.is(run.value, sub.run, 'the value a read gives')
  t.not(run.value as unknown, instance.run)
  t.deepEqual({ ...run, value: undefined }, { value: undefined, writable: true, enumerable: true, configurable: true })
  t.deepEqual(Object.getOwnPropertyDescriptor(sub, 'port'), { value: 80, writable: true, enumerable: true, configurable: true })
  const host = Object.getOwnPropertyDescriptor(sub, 'host')!
  t.is(typeof host.get, 'function')
  t.is(host.value, undefined)
  t.deepEqual(Object.keys(sub), ['port', 'host', 'run'])
  t.deepEqual({ ...sub, run: undefined }, { port: 80, host: 'localhost', run: undefined })

  // reading the descriptor records nothing
  const fresh = Substitute.for<any>()
  fresh[mimick]({ run: () => 1 })
  Object.getOwnPropertyDescriptor(fresh, 'run')
  t.notThrows(() => fresh.didNotReceive().run)
})

test('R16FE-4 (E115) Object.defineProperty and delete on a mimicked substitute go to the instance; one that refuses leaves them to the substitute, as before', t => {
  const real: any = { a: 1 }
  const sub = Substitute.for<any>()
  sub[mimick](real)
  Object.defineProperty(sub, 'b', { value: 2, writable: true, enumerable: true, configurable: true })
  t.is(real.b, 2)
  t.is(sub.b, 2)
  t.deepEqual(Object.keys(sub), ['a', 'b'])
  t.true(delete sub.b)
  t.false('b' in real)
  t.deepEqual(Object.keys(sub), ['a'])

  // without `configurable`, a new key is not configurable, as on any object (round 18, E130: R17-ADV-8): defined on the
  // substitute itself, as below
  Object.defineProperty(sub, 'c', { value: 3, enumerable: true })
  t.false('c' in real)
  t.is(sub.c, 3)
  // a non-configurable property cannot be reported for the instance: it is defined on the substitute itself (E25)
  Object.defineProperty(sub, 'd', { value: 4, configurable: false })
  t.false('d' in real)
  t.is(sub.d, 4)

  // a frozen instance refuses the definition: defined on the substitute itself, as before
  const frozen = Substitute.for<any>()
  frozen[mimick](Object.freeze({ query: () => 'rows' }))
  t.notThrows(() => Object.defineProperty(frozen, 'query', { value: () => 'defined', configurable: true }))
  t.is(frozen.query(), 'defined')
  t.true(delete frozen.unknown)
})

// ---- E112 (R16-ADV-4, R16-ADV-6): the remedies of the fluent-chain hint are code that works when it is run -------------

/** The fluent-chain hint of a failure message: its line that says where the member was called. */
const fluentHintOf = (message: string): string => message.split('\n').find(line => line.includes('further down')) ?? ''

/** The parts of a list of setups as the hint writes it (`a, b and c`), split where no parenthesis, bracket or string is open. */
const splitList = (text: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (quote !== undefined) {
      if (character === '\\') index++
      else if (character === quote) quote = undefined
    } else if (character === "'" || character === '"') quote = character
    else if ('([{'.includes(character)) depth++
    else if (')]}'.includes(character)) depth--
    else if (depth === 0 && (text.startsWith(', ', index) || text.startsWith(' and ', index))) {
      parts.push(text.slice(start, index))
      index += text.startsWith(', ', index) ? 1 : 4
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

type Remedy = { kind: 'check', expression: string } | { kind: 'setups', setups: string[], likewise: number } | { kind: 'worded', text: string }

/** What the hint says to do: a check to run (without its arguments), setups to make, or a remedy worded without code. */
const remedyOf = (hint: string): Remedy => {
  const check = /check that substitute: (sub.*)\(\.\.\.\)$/.exec(hint)
  if (check !== null) return { kind: 'check', expression: check[1] }
  const setups = /return the substitute \((sub.*)\) or mimick an instance/.exec(hint)
  if (setups === null) return { kind: 'worded', text: hint }
  const parts = splitList(setups[1])
  const likewise = /^likewise for the (\d+) other methods? on the way$/.exec(parts[parts.length - 1])
  return likewise === null ? { kind: 'setups', setups: parts, likewise: 0 } : { kind: 'setups', setups: parts.slice(0, -1), likewise: Number(likewise[1]) }
}

const run = (code: string, sub: unknown) => new Function('sub', 'Arg', 'Symbol', code)(sub, Arg, Symbol)

/**
 * Makes the check fail, follows the remedy of its hint, and gives the hint: runs the check it names (with the arguments of
 * the check), or makes the setups it names on a new substitute (`others`: the setups for the methods that "likewise" stands
 * for) and runs the code and the check again. Either must pass.
 */
const followRemedy = (
  t: ExecutionContext, code: (sub: any) => void, check: (sub: any) => void, args: string,
  options: { arrange?: (sub: any) => void, others?: string[] } = {}
): string => {
  const sub = Substitute.for<any>()
  options.arrange?.(sub)
  code(sub)
  const hint = fluentHintOf(failureOf(t, () => check(sub)))
  const remedy = remedyOf(hint)
  if (remedy.kind === 'check') {
    t.notThrows(() => run(`${remedy.expression}${args}`, sub), `${hint}\nfollowed: ${remedy.expression}${args}`)
  } else if (remedy.kind === 'setups') {
    const fresh = Substitute.for<any>()
    options.arrange?.(fresh)
    t.is(remedy.likewise, options.others?.length ?? 0, hint)
    for (const setup of [...remedy.setups, ...options.others ?? []]) t.notThrows(() => run(setup, fresh), `${hint}\nsetup: ${setup}`)
    code(fresh)
    t.notThrows(() => check(fresh), `${hint}\nfollowed: ${remedy.setups.join(' ; ')}`)
  } else t.fail(`no remedy to follow: ${hint}`)
  return hint
}

test('R16-ADV-4 (E112) the check that a remedy names is code for identifier, numeric, non-identifier and registered symbol keys, and passes when it is run', t => {
  const run = (sub: any) => sub.received(1).run()
  t.true(followRemedy(t, s => s.users.where({ id: 1 }).limit(1).run(), run, '()').includes("sub.users.where({ id: 1 }).limit(1).received(1).run(...)"))
  t.true(followRemedy(t, s => s[0].x(1).run(), run, '()').includes('sub[0].x(1).received(1).run(...)'))
  t.true(followRemedy(t, s => s['my-key'].x(1).run(), run, '()').includes("sub['my-key'].x(1).received(1).run(...)"))
  t.true(followRemedy(t, s => s.p[Symbol.for('k')](1).run(), run, '()').includes("sub.p[Symbol.for('k')](1).received(1).run(...)"))
  t.true(followRemedy(t, s => s.p["it's"].x("it's").run(), run, '()').includes(`sub.p["it's"].x("it's").received(1).run(...)`))
  // the checked member itself written as code
  t.true(followRemedy(t, s => s.p.x(1)['my-member'](2), sub => sub.received(1)['my-member'](2), '(2)').includes("sub.p.x(1).received(1)['my-member'](...)"))
  t.true(followRemedy(t, s => s.p.x(1)[Symbol.for('m')](2), sub => sub.received(1)[Symbol.for('m')](2), '(2)').includes("sub.p.x(1).received(1)[Symbol.for('m')](...)"))
})

test('R16-ADV-4 (E112) the fluent remedy is code for numeric, non-identifier and registered symbol keys of the methods and of the substitute they return', t => {
  const run = (sub: any) => sub.received(1).run()
  t.true(followRemedy(t, s => s[0](1).run(), run, '()').includes('(sub[0](Arg.all()).returns(sub))'))
  t.true(followRemedy(t, s => s['my-key'](1).run(), run, '()').includes("(sub['my-key'](Arg.all()).returns(sub))"))
  t.true(followRemedy(t, s => s[Symbol.for('k')](1).run(), run, '()').includes("(sub[Symbol.for('k')](Arg.all()).returns(sub))"))
  const nested = followRemedy(t, s => s['a-b'][1].child('x').info('m'), sub => sub['a-b'][1].received(1).info('m'), "('m')")
  t.true(nested.includes("(sub['a-b'][1].child(Arg.all()).returns(sub['a-b'][1]))"), nested)
})

test('R16-ADV-4 (E112) paths of 1 to 12 steps are written in full, and the remedies work at every length', t => {
  const names = 'abcdefghijkl'.split('')
  for (let steps = 1; steps <= 12; steps++) {
    // a property read first: the check remedy, with every step
    const viaRead = (s: any) => names.slice(0, steps).reduce((value, name, index) => value[name](index), s.p).run()
    const checkHint = followRemedy(t, viaRead, sub => sub.received(1).run(), '()')
    // (the place named before it is a path as messages print it, shortened when it is long)
    const remedy = checkHint.slice(checkHint.indexOf('check that substitute: '))
    t.is(remedy, `check that substitute: sub.p${names.slice(0, steps).map((name, index) => `.${name}(${index})`).join('')}.received(1).run(...)`)
    // only calls, of one method: one setup
    const sameMethod = (s: any) => names.slice(0, steps).reduce((value, _name, index) => value.next(index), s).run()
    followRemedy(t, sameMethod, sub => sub.received(1).run(), '()')
    // only calls, of different methods: three setups named, the others likewise
    const others = names.slice(3, steps).map(name => `sub.${name}(Arg.all()).returns(sub)`)
    const distinct = (s: any) => names.slice(0, steps).reduce((value, name, index) => value[name](index), s).run()
    followRemedy(t, distinct, sub => sub.received(1).run(), '()', { others })
  }
})

test('R16-ADV-4 (E112) a path that cannot be written as code is not given: a symbol that is not registered, a path of more than 1,000 characters', t => {
  const local = Symbol('local')
  const symbolCheck = failureOf(t, () => {
    const sub = Substitute.for<any>()
    sub.p[local](1).run()
    sub.received(1).run()
  })
  t.true(fluentHintOf(symbolCheck).endsWith('To check calls there, check that substitute itself, with received(1) on it; its path cannot be written as code ' +
    '(a symbol that is not registered with Symbol.for(), or more than 1000 characters).'), symbolCheck)
  t.false(/check that substitute: sub/.test(symbolCheck))

  const symbolSetup = failureOf(t, () => {
    const sub = Substitute.for<any>()
    sub[local](1).run()
    sub.received(1).run()
  })
  t.true(fluentHintOf(symbolSetup).endsWith('For a fluent API, make the method return the substitute it is called on (a setup with Arg.all() whose value is ' +
    'that substitute) or mimick an instance whose methods return this.'), symbolSetup)

  const long = 'x'.repeat(90)
  const longCheck = failureOf(t, () => {
    const sub = Substitute.for<any>()
    sub.p.a(long).b(long).c(long).d(long).e(long).f(long).g(long).h(long).i(long).j(long).k(long).run()
    sub.received(1).run()
  })
  t.true(fluentHintOf(longCheck).includes('its path cannot be written as code'), longCheck)

  // well-known symbols are written by their name
  t.is(codeMember(Symbol.iterator), '[Symbol.iterator]')
  t.is(codeMember(Symbol.asyncIterator), '[Symbol.asyncIterator]')
  t.is(codeMember(local), undefined)
})

test('R16-ADV-6 (E112) the finding: the fluent remedy for a substitute shared by a setup with matchers names the call it was returned to, and following it makes the check pass', t => {
  const arrange = (io: any) => io.to(Arg.any()).emit(Arg.all()).returns(true)
  const code = (io: any) => io.to('room-a').compress(true).emit('m')
  const hint = followRemedy(t, code, io => io.to('room-a').received(1).emit('m'), "('m')", { arrange })
  t.true(hint.includes("(sub.to('room-a').compress(Arg.all()).returns(sub.to('room-a')))"), hint)
  t.false(hint.includes('Arg.any{any}).compress'), hint)
})

test('R16-ADV-6 (E112) shared substitutes: returned to several calls, the fluent remedy names one of them; the check remedy names the call or the call with matchers', t => {
  const arrange = (io: any) => io.to(Arg.any()).emit(Arg.all()).returns(true)
  const twoRooms = (io: any) => {
    io.to('room-a').compress(true).emit('m')
    io.to('room-b').compress(true).emit('n')
  }
  const several = followRemedy(t, twoRooms, io => io.to(Arg.any()).received(1).emit('m'), "('m')", { arrange })
  t.true(several.includes("(sub.to('room-a').compress(Arg.all()).returns(sub.to('room-a')))"), several)

  // a member read below the shared substitute: the check of that substitute, through the call it was returned to
  const viaRead = followRemedy(t, io => io.to('room-a').volatile.emit('m'), io => io.to('room-a').received(1).emit('m'), "('m')", { arrange })
  t.true(viaRead.includes("check that substitute: sub.to('room-a').volatile.received(1).emit(...)"), viaRead)

  // a call with matchers on the way, returned to one call: written as that call
  const nestedArrange = (s: any) => s.code(Arg.any()).header(Arg.all()).returns(true)
  const nested = followRemedy(t, s => s.code(404).send(1), s => s.received(1).send(1), '(1)', { arrange: nestedArrange })
  t.true(nested.includes('check that substitute: sub.code(404).received(1).send(...)'), nested)

  // returned to several calls: the call with matchers, whose matchers are written by hand (round 18, E132: R17-ADV-5,
  // matchers do not print as code, so the remedy names the substitute as messages print it, without code)
  const sub = Substitute.for<any>()
  nestedArrange(sub)
  sub.code(404).send(1)
  sub.code(500).ok()
  const message = failureOf(t, () => sub.received(1).send(1))
  t.true(fluentHintOf(message).includes('check that substitute, @Substitute.code(Arg.any{any}), reached with the same arguments, with received(1) on it'), message)
  t.notThrows(() => sub.code(Arg.any()).received(1).send(1))

  // unshared, as before
  const plainHint = followRemedy(t, s => s.getLogger('x').child('y').info('m'), s => s.getLogger('x').received(1).info('m'), "('m')")
  t.true(plainHint.includes("(sub.getLogger('x').child(Arg.all()).returns(sub.getLogger('x')))"), plainHint)
})

// ---- E120 (the integrator's O2): usage errors name records on a shared substitute as the listings do --------------------

test('O2 (E120) the usage errors of checks through a call with matchers name a record on a shared substitute with the call it was returned to', t => {
  const firstLine = (message: string) => message.split('\n')[0]

  // E106: a read of a member step answered by a value that is not a substitute
  const app = Substitute.for<any>()
  app.session(Arg.any()).user.returns(5)
  app.session('s1').user
  const read = firstLine(failureOf(t, () => app.session(Arg.any()).user[received](1).name))
  t.true(read.startsWith('Cannot check through @Substitute.session(Arg.any{any}).user: the read of @Substitute.session(\'s1\').user, which it goes ' +
    'through, is configured with returns(5), and that value is not a substitute.'), read)

  // E88: a received call answered by a value that is not a substitute
  const api = Substitute.for<any>()
  api.client(Arg.any()).get(Arg.any()).resolves({ ok: 1 })
  api.client('a').get('/x')
  const call = firstLine(failureOf(t, () => api.client(Arg.any()).get(Arg.any())[received](1).then))
  t.true(call.startsWith('Cannot check through @Substitute.client(Arg.any{any}).get(Arg.any{any}): the received call ' +
    "@Substitute.client('a').get('/x'), which it matches, is configured with resolves({ ok: 1 })"), call)
  const concrete = firstLine(failureOf(t, () => api.client('a').get(Arg.any())[received](1).then))
  t.true(concrete.includes("the received call @Substitute.client('a').get('/x'), which it matches,"), concrete)

  // returned to several calls: the label with the matchers, as the listings show it
  api.client('b').get('/y')
  const several = firstLine(failureOf(t, () => api.client(Arg.any()).get(Arg.any())[received](1).then))
  t.true(several.includes("the received call @Substitute.client(Arg.any{any}).get('/x'), which it matches,"), several)
})
