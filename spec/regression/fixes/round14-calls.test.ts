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
