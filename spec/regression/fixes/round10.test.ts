import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg, clearReceivedCalls, configure, didNotReceive, mimick, received, returns, throws, resolves, rejects, mimicks } from '../../../src'
import { isSubstituteProxy } from '../../../src/shared'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

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
    t.is(String(value), '[object Object]', name)
    t.is(`${value}`, '[object Object]', name)
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
