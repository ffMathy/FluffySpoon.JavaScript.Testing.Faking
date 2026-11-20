import test from 'ava'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { inspect } from 'util'

import { Substitute, Arg, configure, mimick } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 13: the engine-core part of the round-12 findings (R12FE-1, R12FE-3, R12FE-2, R12-ADV-3), decided in the fix
// spec as E75-E77 and E80.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')
const printout = (substitute: unknown) => plain(inspect(substitute))

/** The message of the SubstituteException that `check` throws (failing the test if it throws none or another error). */
const failureOf = (t: { fail: (message: string) => void }, check: () => void): string => {
  try {
    check()
  } catch (error) {
    if (error instanceof SubstituteException) return plain(error.message)
    throw error
  }
  t.fail('the check passed, but it should have failed')
  return ''
}

// ---- E75 (R12FE-1): the matchers of test runners -----------------------------------------------------------------

/*
 * The shapes of jest's and vitest's asymmetric matchers (expect 30, @vitest/expect 5: class AsymmetricMatcher with an own
 * `$$typeof`, `sample` and `inverse`, and asymmetricMatch, toString and sometimes toAsymmetricMatcher on the prototype)
 * and of sinon's matchers (@sinonjs/samsam: Object.create(matcherPrototype) with an own `test` and `message`, and
 * `and`, `or` and toString on the prototype). The compatibility checks use the real ones (test-runners/jest-matchers,
 * test-runners/vitest-matchers).
 */
class AsymmetricMatcher<T> {
  $$typeof = Symbol.for('jest.asymmetricMatcher')
  constructor(public sample: T, public inverse = false) { }
}

class Any extends AsymmetricMatcher<Function> {
  asymmetricMatch(other: unknown): boolean {
    if (this.sample === String) return typeof other === 'string' || other instanceof String
    if (this.sample === Number) return typeof other === 'number' || other instanceof Number
    return other instanceof this.sample
  }
  toString(): string { return 'Any' }
  toAsymmetricMatcher(): string { return `Any<${this.sample.name}>` }
}

class Anything extends AsymmetricMatcher<void> {
  asymmetricMatch(other: unknown): boolean { return other !== null && other !== undefined }
  toString(): string { return 'Anything' }
  toAsymmetricMatcher(): string { return 'Anything' }
}

class StringContaining extends AsymmetricMatcher<string> {
  asymmetricMatch(other: unknown): boolean {
    const result = typeof other === 'string' && other.includes(this.sample)
    return this.inverse ? !result : result
  }
  toString(): string { return `String${this.inverse ? 'Not' : ''}Containing` }
}

class ObjectContaining extends AsymmetricMatcher<Record<string, unknown>> {
  asymmetricMatch(other: any): boolean {
    return typeof other === 'object' && other !== null && Object.keys(this.sample).every(key => {
      const expected = this.sample[key]
      return expected instanceof AsymmetricMatcher ? (expected as any).asymmetricMatch(other[key]) : other[key] === expected
    })
  }
  toString(): string { return 'ObjectContaining' }
}

const expect = {
  any: (sample: Function) => new Any(sample),
  anything: () => new Anything(undefined),
  stringContaining: (sample: string) => new StringContaining(sample),
  objectContaining: (sample: Record<string, unknown>) => new ObjectContaining(sample),
  not: { stringContaining: (sample: string) => new StringContaining(sample, true) }
}

type SinonMatcher = {
  test: (value: unknown) => boolean
  message: string
  or(other: SinonMatcher): SinonMatcher
  and(other: SinonMatcher): SinonMatcher
}
const sinonMatcherPrototype = {
  toString(this: SinonMatcher): string { return this.message },
  or(this: SinonMatcher, other: SinonMatcher): SinonMatcher { return sinonMatch(value => this.test(value) || other.test(value), `${this.message}.or(${other.message})`) },
  and(this: SinonMatcher, other: SinonMatcher): SinonMatcher { return sinonMatch(value => this.test(value) && other.test(value), `${this.message}.and(${other.message})`) }
}
const sinonMatch = (test: (value: unknown) => boolean, message: string): SinonMatcher => {
  const matcher = Object.create(sinonMatcherPrototype)
  matcher.test = test
  matcher.message = message
  return matcher
}
const sinon = {
  match: {
    has: (key: string) => sinonMatch(value => value !== null && value !== undefined && key in Object(value), `has("${key}")`),
    string: sinonMatch(value => typeof value === 'string', 'typeOf("string")'),
    number: sinonMatch(value => typeof value === 'number', 'typeOf("number")')
  }
}

interface Mailer {
  send(to: string, template: 'welcome' | 'dunning', vars?: Record<string, string | number>): Promise<{ messageId: string }>
}

test('R12FE-1 didNotReceive() with a jest or vitest asymmetric matcher fails when a matching call was made', t => {
  const mailer = Substitute.for<Mailer>()
  void mailer.send('ann@example.com', 'welcome', { customer: 'cus_1' })

  const message = failureOf(t, () => mailer.didNotReceive().send(expect.any(String) as any, 'welcome', expect.anything() as any))
  t.true(message.includes("Expected to receive 0 method calls matching send(Any<String>, 'welcome', Anything), but received 1."), message)
  t.notThrows(() => mailer.didNotReceive().send(expect.any(String) as any, 'dunning', expect.anything() as any))
  t.notThrows(() => mailer.didNotReceive().send(expect.not.stringContaining('@') as any, 'welcome', Arg.any()))
  t.throws(() => mailer.didNotReceive().send(expect.stringContaining('@') as any, 'welcome', Arg.any()), { instanceOf: SubstituteException })
})

test('R12FE-1 received() with asymmetric matchers matches as the runner does, at the top level and nested in objects and arrays', t => {
  const mailer = Substitute.for<Mailer>()
  void mailer.send('ann@example.com', 'welcome', { customer: 'cus_1' })

  t.notThrows(() => mailer.received(1).send(expect.stringContaining('@') as any, 'welcome', expect.objectContaining({ customer: 'cus_1' }) as any))
  t.notThrows(() => mailer.received(1).send(expect.any(String) as any, 'welcome', { customer: expect.stringContaining('cus_') as any }))
  t.throws(() => mailer.received(1).send(expect.any(String) as any, 'welcome', { customer: expect.stringContaining('xx_') as any }), { instanceOf: SubstituteException })
  t.throws(() => mailer.received(1).send(expect.any(Number) as any, 'welcome', Arg.any()), { instanceOf: SubstituteException })

  const store = Substitute.for<any>()
  store.save([1, 'a', { id: 7 }])
  t.notThrows(() => store.received(1).save([expect.any(Number), expect.any(String), expect.objectContaining({ id: 7 })]))
  t.notThrows(() => store[configure]().save)
  t.throws(() => store.received(1).save([expect.any(String), Arg.all()]), { instanceOf: SubstituteException })
  // with the symbol form and on a function substitute too
  const listener = Substitute.for<(event: string, payload: object) => void>()
  listener('saved', { id: 1 })
  t.notThrows(() => listener.received(1)(expect.stringContaining('save') as any, expect.anything() as any))
  t.throws(() => listener.didNotReceive()(expect.anything() as any, expect.anything() as any), { instanceOf: SubstituteException })
})

test('R12FE-1 setups with asymmetric matchers answer the calls they match (returns, resolves, throws)', async t => {
  const mailer = Substitute.for<Mailer>()
  mailer.send(expect.any(String) as any, 'dunning').resolves({ messageId: 'm1' })
  t.deepEqual(await mailer.send('bob@example.com', 'dunning'), { messageId: 'm1' })
  // not indexed as a literal argument: another string matches, another template does not
  t.deepEqual(await mailer.send('eve@example.com', 'dunning'), { messageId: 'm1' })
  t.is(typeof mailer.send('bob@example.com', 'welcome'), 'function')

  const calc = Substitute.for<any>()
  calc.add(expect.any(Number), 2).returns(42)
  calc[configure]().add(expect.anything(), 3).throws(new Error('three'))
  t.is(calc.add(40, 2), 42)
  t.throws(() => calc.add(0, 3), { message: 'three' })
  t.is(typeof calc.add(1, 1), 'function')

  const repo = Substitute.for<any>()
  repo.find({ where: { email: expect.stringContaining('@') } }).returns('user')
  t.is(repo.find({ where: { email: 'ann@example.com' } }), 'user')
  t.not(repo.find({ where: { email: 'nobody' } }), 'user')
})

test('R12FE-1 a call with a test runner\'s matcher is a setup or a check (D3): it is not recorded and runs no substitution', t => {
  const audit = Substitute.for<any>()
  audit.log(Arg.all()).throws(new Error('a real call'))
  t.notThrows(() => audit.log(expect.any(String)))
  t.notThrows(() => audit.log({ level: expect.anything() }))
  t.notThrows(() => audit.log(sinon.match.string))
  t.notThrows(() => audit.didNotReceive().log(Arg.all()))
  t.false(printout(audit).includes('received:'), printout(audit))
})

test('R12FE-1 sinon matchers match through test() in checks and setups, and print with their message', t => {
  const log = Substitute.for<any>()
  log.warn({ err: new Error('x') }, 'bad json from client')

  const message = failureOf(t, () => log.didNotReceive().warn(sinon.match.has('err'), 'bad json from client'))
  t.true(message.includes(`Expected to receive 0 method calls matching warn(has("err"), 'bad json from client'), but received 1.`), message)
  t.notThrows(() => log.received(1).warn(sinon.match.has('err'), sinon.match.string))
  t.notThrows(() => log.received(1).warn(sinon.match.has('err').and(sinon.match.has('err')), sinon.match.string.or(sinon.match.number)))
  t.throws(() => log.received(1).warn(sinon.match.has('error'), sinon.match.string), { instanceOf: SubstituteException })

  const calc = Substitute.for<any>()
  calc.square(sinon.match.number).returns(9)
  t.is(calc.square(3), 9)
  t.is(typeof calc.square('3'), 'function')
  t.true(printout(calc).includes('square(typeOf("number")) => returns(9)'), printout(calc))
})

test('R12FE-1 the matchers print with their own text in messages and printouts, never as objects with $$typeof', t => {
  const mailer = Substitute.for<any>()
  mailer.send('ann@example.com', 'welcome', { customer: 'cus_1' })
  mailer.send(expect.objectContaining({ customer: expect.any(String) }), expect.not.stringContaining('x')).returns('configured')

  const message = failureOf(t, () => mailer.received(2).send(expect.stringContaining('@'), 'welcome', { customer: expect.anything() }))
  t.true(message.includes(`matching send(StringContaining '@', 'welcome', { customer: Anything })`), message)
  t.false(message.includes('$$typeof'), message)
  const printed = printout(mailer)
  t.true(printed.includes(`send(ObjectContaining { customer: Any<String> }, StringNotContaining 'x') => returns('configured')`), printed)
  t.false(printed.includes('$$typeof'), printed)
  // nested deeper than a message shows plain values
  const deep = failureOf(t, () => mailer.received(1).send(Arg.any(), Arg.any(), { a: { b: { c: { d: expect.any(Number) } } } }))
  t.true(deep.includes('d: Any<Number>'), deep)
})

test('R12FE-1 a received value that happens to be such a matcher is a value like any other', t => {
  const matcher = expect.stringContaining('@')
  const form = Substitute.for<any>()
  // an assignment is never a setup: the value is recorded
  form.email = matcher
  t.notThrows(() => form.received(1).email = Arg.is(value => value === matcher))
  t.throws(() => form.received(1).email = 'ann@example.com', { instanceOf: SubstituteException })
  // a matcher inside a Map is a value too (matchers are looked for in plain objects and arrays only, D27)
  const cache = Substitute.for<any>()
  cache.put(new Map([['email', matcher]]))
  t.notThrows(() => cache.received(1).put(new Map([['email', expect.stringContaining('@')]])))
  t.throws(() => cache.received(1).put(new Map([['email', 'ann@example.com']])), { instanceOf: SubstituteException })
})

test('R12FE-1 a matcher whose asymmetricMatch throws does not match, and the check says that it threw', t => {
  class Throwing extends AsymmetricMatcher<void> {
    asymmetricMatch(): boolean { throw new TypeError('cannot match') }
    toString(): string { return 'Throwing' }
    toAsymmetricMatcher(): string { return 'Throwing' }
  }
  const service = Substitute.for<any>()
  service.run(1).returns('configured')
  service.run(new Throwing(undefined)).returns('never')
  t.is(service.run(1), 'configured')
  t.is(typeof service.run(2), 'function')
  const message = failureOf(t, () => service.received(1).run(new Throwing(undefined)))
  t.true(message.includes('threw while matching this call: TypeError: cannot match'), message)
})

test('R12FE-1 equal matchers configure the same setup again; an Arg matcher and a runner matcher are different setups', t => {
  const calc = Substitute.for<any>()
  calc.f(expect.any(String)).returns(1)
  calc.f(expect.any(String)).returns(2)
  t.is(calc.f('x'), 2)
  t.is(printout(calc).match(/=> returns/g)!.length, 1, printout(calc))
  calc.f(Arg.any('string')).returns(3)
  t.is(calc.f('y'), 3)
  t.is(printout(calc).match(/=> returns/g)!.length, 2, printout(calc))
})

test('R12FE-1 substitutes, and objects that inherit from one, are never taken for a runner\'s matcher and record nothing', t => {
  const dependency = Substitute.for<any>()
  const inheriting = Object.create(dependency)
  const registry = Substitute.for<any>()
  registry.register(dependency)
  registry.register(inheriting)
  t.notThrows(() => registry.received(1).register(dependency))
  t.notThrows(() => registry.received(1).register(inheriting))
  t.is(printout(dependency), '@Substitute {\n}')
})

test('R12FE-1 a plain object argument is looked at for a runner\'s matcher with own-property checks only, no reads through its prototype', t => {
  const traps: string[] = []
  const observed = <T extends object>(target: T): T => new Proxy(target, {
    get: (object, key, receiver) => { traps.push(`get ${String(key)}`); return Reflect.get(object, key, receiver) },
    has: (object, key) => { traps.push(`has ${String(key)}`); return Reflect.has(object, key) },
    getOwnPropertyDescriptor: (object, key) => { traps.push(`own ${String(key)}`); return Reflect.getOwnPropertyDescriptor(object, key) }
  })
  const runnerKeys = /\$\$typeof|asymmetricMatch|\btest\b|message|\band\b|\bor\b/
  // the kinds of look at the runners' keys (how often each is made is not the point)
  const looks = () => [...new Set(traps.filter(trap => runnerKeys.test(trap)))]
  const sub = Substitute.for<any>()
  sub.f(observed({ id: 1 }))
  t.deepEqual(looks(), ['own $$typeof'])
  // an object that is not a plain one (where sinon's matchers are) gets an own-property check of `test` as well
  traps.length = 0
  class Entity { id = 1 }
  sub.f(observed(new Entity()))
  t.deepEqual(looks(), ['own $$typeof', 'own test'])
})

// ---- E76 (R12FE-3): fluent chains of a mimicked instance ---------------------------------------------------------

test('R12FE-3 a mimicked stream\'s fluent chain (setEncoding().on().on().once()) stays on the substitute, and every call is recorded', t => {
  const wire = (socket: any) => { socket.setEncoding('utf8').on('data', () => { }).on('end', () => { }).once('close', () => { }) }
  const real = new PassThrough()
  const socket = Substitute.for<any>()
  socket[mimick](real)
  wire(socket)

  t.notThrows(() => socket.received(1).setEncoding('utf8'))
  t.notThrows(() => socket.received(1).on('data', Arg.any()))
  t.notThrows(() => socket.received(1).on('end', Arg.any()))
  t.notThrows(() => socket.received(1).once('close', Arg.any()))
  t.throws(() => socket.didNotReceive().on('end', Arg.any()), { instanceOf: SubstituteException })
  // the instance still did the work, with itself as `this`
  t.is(real.listenerCount('data'), 1)
  t.is(real.listenerCount('end'), 1)
  t.is(real.listenerCount('close'), 1)
  t.true(printout(socket).includes("once('close', [Function (anonymous)])"), printout(socket))
})

test('R12FE-3 a fluent method or getter of a mimicked instance answers the substitute, runs on the instance, and setups on the substitute apply to the chain', t => {
  class QueryBuilder {
    readonly parts: string[] = []
    where(condition: string) { this.parts.push(`where ${condition}`); return this }
    limit(count: number) { this.parts.push(`limit ${count}`); return this }
    get and() { return this }
    build() { return this.parts.join(' ') }
    async ready() { return this }
  }
  const real = new QueryBuilder()
  const query = Substitute.for<any>()
  query[mimick](real)
  query[configure]().build().returns('configured')

  const chained = query.where('a = 1').and.limit(10)
  t.is(chained, query)
  t.is(query.where('b = 2'), query)
  t.deepEqual(real.parts, ['where a = 1', 'limit 10', 'where b = 2'])
  t.is(chained.build(), 'configured')
  t.notThrows(() => query.received(2).where(Arg.any()))
  t.notThrows(() => query.received(1).limit(10))
  t.notThrows(() => query.received(1).and)
  // a promise of the instance is a value like any other: it resolves to the instance
  return query.ready().then((ready: unknown) => t.is(ready, real))
})

test('R12FE-3 a mimicked EventEmitter\'s on() and emit() go through the substitute; a method called with another `this` is not mapped', t => {
  const real = new EventEmitter()
  const events = Substitute.for<any>()
  events[mimick](real)
  const seen: unknown[] = []
  t.is(events.on('saved', (id: unknown) => seen.push(id)).on('deleted', () => seen.push('deleted')), events)
  t.true(events.emit('saved', 7))
  t.deepEqual(seen, [7])
  t.notThrows(() => events.received(1).on('deleted', Arg.any()))
  t.notThrows(() => events.received(1).emit('saved', 7))
  // call() with another receiver runs the method on that receiver: what it returns is not the instance
  const other = new EventEmitter()
  t.is(events.on.call(other, 'x', () => { }), other)
})

test('R12FE-3 a nested setup through a mimicked member that answers the instance itself configures the substitute', t => {
  class Fluent {
    get self() { return this }
    name() { return 'real' }
  }
  const fluent = Substitute.for<any>()
  fluent[mimick](new Fluent())
  fluent[configure]().self.name().returns('configured')
  t.is(fluent.name(), 'configured')
  t.is(fluent.self.name(), 'configured')
})

// ---- E77 (R12FE-2): a member that was read but never called --------------------------------------------------------

test('R12FE-2 a method check on a member read more often than the count, never called, fails kind-neutrally with the read-without-call hint', t => {
  // the code under test reads the callback twice (a feature check, then it stores it), but never calls it
  const finish = (options: any) => { if (typeof options.onDone === 'function') { const done = options.onDone; void done } }
  const options = Substitute.for<any>()
  finish(options)

  const message = failureOf(t, () => options.received(1).onDone('ok'))
  t.true(message.includes('Expected to receive 1 property read or method call matching onDone, but received 2 property reads and no method calls.'), message)
  t.false(message.includes('› ✔'), message)
  t.true(message.includes('@Substitute.onDone was read 2 times without being called; reading a method does not count as calling it.'), message)
})

test('R12FE-2 the same for a property configured with a real function that the code under test calls itself', t => {
  const options = Substitute.for<any>()
  options.onProgress.returns((): void => undefined)
  const report = (o: any) => { if (typeof o.onProgress === 'function') { o.onProgress(50); o.onProgress(100) } }
  report(options)

  const message = failureOf(t, () => options.received(2).onProgress(Arg.any()))
  t.true(message.includes('Expected to receive 2 property reads or method calls matching onProgress, but received 3 property reads and no method calls.'), message)
  t.true(message.includes('@Substitute.onProgress was read 3 times without being called'), message)
})

test('R12FE-2 didNotReceive() on a member that was only read fails kind-neutrally, marks the reads and points at clearReceivedCalls', t => {
  const handle = (ws: any, ok: boolean) => { const reply = ws.send.bind(ws); if (!ok) reply('error') }
  const ws = Substitute.for<any>()
  handle(ws, true)

  const message = failureOf(t, () => ws.didNotReceive().send(Arg.all()))
  t.true(message.includes('Expected to receive 0 property reads or method calls matching send, but received 1 property read and no method calls.'), message)
  t.true(message.includes('› ✔ @Substitute.send'), message)
  t.true(message.includes('Call sub[clearReceivedCalls]() after the arrange step to reset the reads.'), message)
  t.true(failureOf(t, () => ws.received(0).send()).includes('but received 1 property read and no method calls.'))
})

test('R12FE-2 unchanged: a member that was also called keeps its wording, and exactly n reads leave the decision to the method check', t => {
  const component = Substitute.for<any>()
  void component.onChange
  component.onChange()
  void component.onChange
  // the property-style half is deferred (the member was invoked, too): the method check right after decides
  t.notThrows(() => component.received(1).onChange())

  const options = Substitute.for<any>()
  void options.onDone
  const message = failureOf(t, () => options.received(1).onDone('ok'))
  t.true(message.includes("Expected to receive 1 method call matching onDone('ok'), but received none."), message)
  t.true(message.includes('@Substitute.onDone was read 1 time without being called'), message)
})

// ---- E80 (R12-ADV-3): call, apply and bind of a function that inherits from a substitute ------------------------

test('R12-ADV-3 call, apply and bind of a class that extends a substitute member are Function.prototype\'s, so a bound class constructs itself', t => {
  const ns = Substitute.for<any>()
  class Repo extends ns.Base {
    public readonly url: string
    constructor(url: string) {
      super(url)
      this.url = url
    }
    find() { return 'real' }
  }
  t.is(Repo.bind, Function.prototype.bind)
  t.is(Repo.call, Function.prototype.call)
  t.is(Repo.apply, Function.prototype.apply)

  // a factory or a DI container that binds constructor arguments
  const Bound = Repo.bind(null, 'db://b')
  const repo = new Bound()
  t.true(repo instanceof Repo)
  t.is(repo.url, 'db://b')
  t.is(repo.find(), 'real')
  // as in JavaScript, a class constructor cannot be called
  t.throws(() => Repo.call(null, 'db://c'), { instanceOf: TypeError })
  t.throws(() => Repo.apply(null, ['db://c']), { instanceOf: TypeError })

  // the base constructor ran through the substitute (super), and nothing was read for bind
  t.notThrows(() => ns.received(1).Base('db://b'))
  t.false(printout(ns).includes('bind'), printout(ns))
})

test('R12-ADV-3 the substitute\'s own call, apply and bind are unchanged, and a setup of its bind still answers through a subclass', t => {
  const ns = Substitute.for<any>()
  // on the substitute member itself: the library's helpers (D26), recorded
  const bound = ns.Base.bind(null, 1)
  t.not(bound, undefined)
  t.notThrows(() => ns.Base.received(1).bind(null, 1))

  const sdk = Substitute.for<any>()
  sdk.Plugin[configure]().bind(Arg.all()).returns('configured bind')
  class Plugin extends sdk.Plugin { }
  t.is((Plugin as any).bind(null, 'x'), 'configured bind')
  // a plain function whose prototype is a substitute
  const handler = Object.setPrototypeOf(function handler(this: unknown, value: number) { return value * 2 }, Substitute.for<any>())
  t.is(handler.call(null, 21), 42)
  t.is(handler.apply(null, [4]), 8)
  t.is(handler.bind(null, 5)(), 10)
})
