import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg, configure, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { foreignMatcherOf, isArgumentMatcher, matcherKindOf, foreignMatcherLabel } from '../../../src/shared/Arguments'

// Round 14: the calls-and-arguments part of the round-13 findings (R13V-1, R13FE-5), decided in the fix spec as E83 and
// E82.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

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

// ---- E83 (R13V-1): values that cannot be read next to matchers ------------------------------------------------------

/** A revoked proxy: every operation on it but typeof throws a TypeError (an immer draft after produce() ended). */
const revokedProxy = (): object => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

/** Proxies whose getPrototypeOf / getOwnPropertyDescriptor / get traps throw. */
const throwingProxies = (): object[] => [
  new Proxy({}, { getPrototypeOf() { throw new Error('getPrototypeOf') } }),
  new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('getOwnPropertyDescriptor') } }),
  new Proxy({}, { get() { throw new Error('get') }, has() { throw new Error('has') } })
]

test('R13V-1 detecting matchers never throws for a revoked proxy or a proxy with throwing traps: it is not a matcher', t => {
  for (const value of [revokedProxy(), ...throwingProxies()]) {
    t.notThrows(() => foreignMatcherOf(value))
    t.is(foreignMatcherOf(value), undefined)
    t.is(matcherKindOf(value), undefined)
    t.false(isArgumentMatcher(value))
    t.is(foreignMatcherLabel(value), undefined)
  }
})

test('R13V-1 a revoked proxy next to a matcher at the top level: setup, re-configuration and the call it answers', t => {
  const revoked = revokedProxy()
  const repo = Substitute.for<any>()
  repo.save(revoked, Arg.any()).returns(1)
  t.is(repo.save(revoked, 'x'), 1)
  t.notThrows(() => repo.save(revoked, Arg.any()).returns(2))
  t.is(repo.save(revoked, 'x'), 2)
  // through the configure view as well
  t.notThrows(() => repo[configure]().save(revoked, Arg.any()).returns(3))
  t.is(repo.save(revoked, 'y'), 3)
  // the same reference matches; another value does not
  t.not(repo.save(revokedProxy(), 'x'), 3)
})

test('R13V-1 a revoked proxy nested next to a matcher: setups, re-configuration and nested setups answer', t => {
  const revoked = revokedProxy()
  const repo = Substitute.for<any>()
  repo.load({ entity: revoked, id: Arg.any() }).returns('configured')
  t.is(repo.load({ entity: revoked, id: 7 }), 'configured')
  repo.load({ entity: revoked, id: Arg.any() }).returns('again')
  t.is(repo.load({ entity: revoked, id: 7 }), 'again')

  const list = Substitute.for<any>()
  list.m([revoked, Arg.any()]).returns(4)
  t.is(list.m([revoked, 5]), 4)

  // a nested setup through the result of a call with the matcher
  const app = Substitute.for<any>()
  app.repo({ entity: revoked, id: Arg.any() }).name.returns('nested')
  t.is(app.repo({ entity: revoked, id: 1 }).name, 'nested')
})

test('R13V-1 checks with a revoked proxy next to a matcher count the calls made: received(n) passes, didNotReceive() fails', t => {
  const revoked = revokedProxy()
  const repo = Substitute.for<any>()
  repo.save({ entity: revoked, id: 1 })
  repo.save(revoked, 2)
  repo.k([revoked, 2])

  t.notThrows(() => repo.received(1).save({ entity: revoked, id: Arg.any() }))
  t.notThrows(() => repo[received](1).save({ entity: revoked, id: Arg.any() }))
  t.notThrows(() => repo.received(1).save(revoked, Arg.any()))
  t.notThrows(() => repo.received(1).k([revoked, Arg.is((x: number) => x === 2)]))

  const message = failureOf(t, () => repo.didNotReceive().save({ entity: revoked, id: Arg.any() }))
  t.regex(message, /Expected to receive 0 method calls matching save\(\{ entity: <Revoked Proxy>, id: Arg\.any\{any\} \}\), but received 1\./)
  failureOf(t, () => repo[didNotReceive]().save(revoked, Arg.any()))
  t.regex(failureOf(t, () => repo.received(2).save(revoked, Arg.any())), /but received 1/)

  // a call with another object there does not match
  t.notThrows(() => repo.didNotReceive().save({ entity: revokedProxy(), id: Arg.any() }))
  t.notThrows(() => repo.didNotReceive().save({ entity: {}, id: Arg.any() }))
})

test('R13V-1 proxies with throwing traps next to a matcher match by identity in setups and checks, and print', t => {
  for (const value of throwingProxies()) {
    const sub = Substitute.for<any>()
    sub.h({ a: value, b: Arg.any() }).returns(5)
    sub.h({ a: value, b: Arg.any() }).returns(6)
    t.is(sub.h({ a: value, b: 1 }), 6)
    sub.k(value, Arg.any()).returns(7)
    t.is(sub.k(value, 1), 7)
    t.notThrows(() => sub.received(1).h({ a: value, b: Arg.any() }))
    failureOf(t, () => sub.didNotReceive().k(value, Arg.any()))
    t.notThrows(() => String(sub))
    t.notThrows(() => inspect(sub))
  }
})

test('R13V-1 the setups and checks with a revoked proxy print, in String(sub), inspect and failure messages', t => {
  const revoked = revokedProxy()
  const sub = Substitute.for<any>()
  sub.h({ a: revoked, b: Arg.any() }).returns(2)
  t.is(sub.h({ a: revoked, b: 1 }), 2)
  const text = plain(String(sub))
  t.true(text.includes('h({ a: <Revoked Proxy>, b: Arg.any{any} }) => returns(2)'), text)
  t.true(text.includes('h({ a: <Revoked Proxy>, b: 1 })'), text)
  t.notThrows(() => inspect(sub))
  t.regex(failureOf(t, () => sub.received(2).h({ a: revoked, b: Arg.any() })), /<Revoked Proxy>/)
})

// ---- E82 (R13FE-5): call and apply answer what the direct call answers ----------------------------------------------

/*
 * The wrappers of the code under test that forward a call with fn.apply(this, args), as retry, once, memoize, debounce
 * and middleware helpers do, and sinon's spies (`(this.func || func).apply(thisValue, args)`).
 */
const withRetry = (fn: Function): any => function (this: unknown, ...args: unknown[]) { return fn.apply(this, args) }
const once = (fn: Function): any => {
  let done = false
  let result: unknown
  return function (this: unknown, ...args: unknown[]) {
    if (!done) {
      done = true
      result = fn.apply(this, args)
    }
    return result
  }
}
const spyLike = (func: Function): any => function (this: unknown) {
  return func.apply(this, Array.prototype.slice.call(arguments))
}
const callWith = (fn: Function): any => (...args: unknown[]) => fn.call(undefined, ...args)

test('R13FE-5 a method invoked through apply by a wrapper answers the same auto-substitute as the direct call: nested setups answer, its calls are checked there', t => {
  const api = Substitute.for<any>()
  api.getUser(1).name.returns('bob')

  const user = withRetry(api.getUser)(1) // code under test
  t.is(user.name, 'bob')
  user.save()
  t.notThrows(() => api.received(1).getUser(1))
  t.notThrows(() => api.getUser(1).received(1).save())
  t.notThrows(() => api.getUser(1).received(1).name)
  t.regex(failureOf(t, () => api.getUser(1).didNotReceive().save()), /Expected to receive 0 method calls matching save\(\), but received 1/)
  t.is(plain(String(user)).split('\n')[0], '@Substitute.getUser(1) {')
  t.is(user, api.getUser(1))

  // call, apply with an `arguments` list and other wrappers alike
  t.is(api.getUser.call(api, 1), user)
  t.is(api.getUser.apply(api, [1]), user)
  t.is(spyLike(api.getUser)(1), user)
  t.is(once(api.getUser)(1), user)
  t.is(callWith(api.getUser)(1), user)
  // other arguments: another auto-substitute, the same as for the direct call
  t.is(withRetry(api.getUser)(2), api.getUser(2))
  t.not(withRetry(api.getUser)(2), user)
  // bind and Reflect.apply did so already
  t.is(api.getUser.bind(api, 1)(), user)
  t.is(Reflect.apply(api.getUser, api, [1]), user)
})

test('R13FE-5 function substitutes: fn.apply(undefined, [1]), fn.call(undefined, 1) and spy-like wrappers answer fn(1)\'s auto-substitute', t => {
  const fn = Substitute.for<any>()
  fn(1).name.returns('ann')
  t.is(fn.apply(undefined, [1]).name, 'ann')
  t.is(fn.call(undefined, 1).name, 'ann')
  t.is(fn.apply(null, [1]), fn(1))
  t.is(fn.call({ some: 'this' }, 1), fn(1))
  t.is(spyLike(fn)(1).name, 'ann')
  t.is(Function.prototype.apply.call(fn, null, [1]), fn(1))
  t.is(fn.apply(null), fn())
  t.is(fn.call(), fn())
  t.is(fn.bind(null, 1)().name, 'ann')
  t.is((Reflect.apply(fn, null, [1]) as any).name, 'ann')

  const result = once(fn)(2)
  result.close()
  t.notThrows(() => fn(2).received(1).close())

  // a call result is function-like as well (`sub.f()(1)`)
  const factory = Substitute.for<any>()
  factory.create()(3).id.returns(33)
  t.is(factory.create().apply(null, [3]).id, 33)
  t.is(factory.create().call(null, 3), factory.create()(3))
})

test('R13FE-5 through a receiver that inherits from a substitute, call and apply answer the direct call\'s auto-substitute too', t => {
  const sdk = Substitute.for<any>()
  sdk.svc.load(3).id.returns(33)
  const service = Object.create(sdk.svc)
  t.is(service.load.call(service, 3).id, 33)
  t.is(withRetry(service.load).call(service, 3), sdk.svc.load(3))

  // E80 unchanged: a class that extends a substitute member has Function.prototype's call, apply and bind
  class Plugin extends sdk.Base { }
  t.is(Plugin.call, Function.prototype.call)
  t.is(Plugin.apply, Function.prototype.apply)
  t.is(Plugin.bind, Function.prototype.bind)
  const plugin = new Plugin()
  t.is(plugin.getUser.apply(plugin, [1]), plugin.getUser(1))
})

test('R13FE-5 configured values are answered through call and apply as before', t => {
  const api = Substitute.for<any>()
  const userSub = Substitute.for<any>()
  userSub.name.returns('carol')
  api.getUser(1).returns(userSub)
  api.getOrder(2).returns({ id: 2 })
  api.find(Arg.any()).returns('found')
  t.is(withRetry(api.getUser)(1), userSub)
  t.is(api.getUser.call(api, 1).name, 'carol')
  t.deepEqual(api.getOrder.apply(api, [2]), { id: 2 })
  t.is(api.find.call(api, 9), 'found')
  t.notThrows(() => api.received(2).getUser(1))
  t.notThrows(() => api.received(1).find(9))

  // mimicks() still receives the thisArg
  const fn = Substitute.for<any>()
  fn.run(Arg.all()).mimicks(function (this: { tag: string } | undefined, a: number) { return [this?.tag, a] })
  t.deepEqual(fn.run.call({ tag: 'T' }, 1), ['T', 1])
  t.deepEqual(fn.run.apply({ tag: 'U' }, [2]), ['U', 2])
})

test('R13FE-5 setups written through call or apply keep configuring the member reading (D26)', t => {
  const api = Substitute.for<any>()
  api.getUser.apply(null, [1]).returns('via apply')
  t.is(api.getUser.apply(null, [1]), 'via apply')
  t.not(api.getUser(1), 'via apply')
  t.not(api.getUser.apply(api, [1]), 'via apply', 'another thisArg is another member call')
  api.getUser.call('x', 2).returns('via call')
  t.is(api.getUser.call('x', 2), 'via call')
  t.not(api.getUser.call('y', 2), 'via call')
  t.not(api.getUser(2), 'via call')

  const sub = Substitute.for<any>()
  sub.m.call(null, 1).throws(new Error('boom'))
  t.throws(() => sub.m.call(null, 1), { message: 'boom' })
  t.notThrows(() => sub.m(1))
  sub.m.apply(null, [2]).mimicks((thisArg: unknown, list: unknown[]) => `${thisArg} ${list.join()}`)
  t.is(sub.m.apply(null, [2]), 'null 2')

  // members named call/apply of the code under test's own (an RPC client)
  const app = Substitute.for<any>()
  app.rpc.call('getUser', 1).returns('U')
  t.is(app.rpc.call('getUser', 1), 'U')
  t.not(app.rpc.call('deleteUser', 1), 'U')
  t.notThrows(() => app.rpc.received(1).call('getUser', 1))
  t.notThrows(() => app.rpc.received(1).call('deleteUser', 1))
  app.rpc.apply(Arg.any(), [5]).returns('A5')
  t.is(app.rpc.apply('q', [5]), 'A5')
  app[configure]().rpc.call('a', 7).returns('C7')
  t.is(app.rpc.call('a', 7), 'C7')
  t.not(app.rpc(7), 'C7')

  // with stack traces off (adjacency decides, E2)
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    const quiet = Substitute.for<any>()
    quiet.getUser.apply(null, [1]).returns('st0')
    t.is(quiet.getUser.apply(null, [1]), 'st0')
    t.not(quiet.getUser(1), 'st0')
    quiet.getUser(2).name.returns('n2')
    t.is(quiet.getUser.apply(null, [2]).name, 'n2')
  } finally {
    Error.stackTraceLimit = limit
  }
})

test('R13FE-5 a nested setup or a check through the result of call or apply is one on the direct call\'s auto-substitute, and records nothing', t => {
  const api = Substitute.for<any>()
  api.getUser.apply(null, [1]).name.returns('nested')
  api.getUser.call(null, 2).profile.load().returns('loaded')
  t.notThrows(() => api.didNotReceive().getUser(Arg.all()), 'the setup chains recorded nothing')
  t.notThrows(() => api.getUser.didNotReceive().apply(Arg.all()))
  t.notThrows(() => api.getUser.didNotReceive().call(Arg.all()))
  t.is(api.getUser(1).name, 'nested')
  t.is(withRetry(api.getUser)(1).name, 'nested')
  t.is(api.getUser(2).profile.load(), 'loaded')

  const user = withRetry(api.getUser)(3) // code under test
  user.save('x')
  t.notThrows(() => api.getUser.apply(null, [3]).received(1).save('x'))
  t.notThrows(() => api.getUser(3).received(1).save('x'))
})

test('R13FE-5 recording is unchanged (D26): one invocation, counted under both readings and listed once', t => {
  const api = Substitute.for<any>()
  withRetry(api.getUser).call(api, 1)
  api.getUser.call(api, 2)
  t.notThrows(() => api.received(1).getUser(1))
  t.notThrows(() => api.received(1).getUser(2))
  t.notThrows(() => api.received(2).getUser(Arg.any()))
  t.notThrows(() => api.getUser.received(1).apply(api, [1]))
  t.notThrows(() => api.getUser.received(1).call(api, 2))
  t.notThrows(() => api[received](1).getUser(1))
  t.notThrows(() => api.getUser[received](1).apply(Arg.any(), [1]))
  const message = failureOf(t, () => api.received(3).getUser(Arg.any()))
  t.true(message.includes('but received 2.'), message)
  t.is((message.match(/@Substitute\.getUser\(1\)/g) ?? []).length, 1, message)

  // the D26 repros
  const listener = Substitute.for<any>()
  listener('saved').returns('ack')
  t.is(once(listener)('saved'), 'ack')
  failureOf(t, () => listener[didNotReceive]()(Arg.all()))
  const shop = Substitute.for<any>()
  shop.rpc.call('getUser', 1)
  t.notThrows(() => shop.rpc.received().call('getUser', 1))
})

test('R13FE-5 a member called received or didNotReceive keeps the member reading\'s auto-substitute through call and apply (its direct call would be a check, D11)', t => {
  const queue = Substitute.for<any>()
  const result = queue.received.call(null, 1)
  t.is(plain(String(result)), '@Substitute.received.call(null, 1)')
  t.notThrows(() => result.ack())
  t.notThrows(() => queue.received.call(null, 1).received(1).ack())
})
