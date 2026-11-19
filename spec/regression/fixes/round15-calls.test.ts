import test from 'ava'

import { Substitute, Arg, configure, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 15: the calls-and-arguments part of the round-14 findings (R14-ADV-2, R14V-1, R14FE-1, R14FE-4), decided in the
// fix spec as E91, E93, E95 and E96.

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

// ---- E91 (R14-ADV-2): a member named call/apply that is an API of its own ------------------------------------------

/** Wrappers as the code under test uses them (a retry helper, a spy, a memoizer). */
const withRetry = (fn: Function): any => function (this: unknown, ...args: unknown[]): unknown {
  return fn.apply(this, args)
}
const callWith = (fn: Function): any => (...args: unknown[]) => fn.call(undefined, ...args)

test('R14-ADV-2 rpc.call(method, ...params) with a string first argument answers per method: nested setups do not leak to other methods', t => {
  const rpc = Substitute.for<any>()
  rpc.call('getUser', 1).name.returns('bob')
  rpc.call('getOrder', 1).total.returns(5)
  t.is(rpc.call('getUser', 1).name, 'bob')
  t.is(rpc.call('getOrder', 1).total, 5)
  t.not(rpc.call('getOrder', 1).name, 'bob')
  t.not(rpc.call('getUser', 1).total, 5)
  t.is(plain(String(rpc.call('getOrder', 1).name)), '@Substitute.call(\'getOrder\', 1).name')
  t.not(rpc.call('getUser', 1), rpc.call('deleteUser', 1))
  t.is(rpc.call('getUser', 1), rpc.call('getUser', 1), 'the same arguments answer the same auto-substitute (D2)')

  // a member called call on a member (app.rpc.call), and with other primitive first arguments
  const app = Substitute.for<any>()
  app.rpc.call('getUser', 1).name.returns('ann')
  t.is(app.rpc.call('getUser', 1).name, 'ann')
  t.not(app.rpc.call('getOrder', 1).name, 'ann')
  for (const first of [7, true, BigInt(10), Symbol.for('method')]) t.not(app.rpc.call(first, 1), app.rpc.call('getUser', 1))
  t.not(app.rpc.call(7, 1), app.rpc.call(8, 1))
})

test('R14-ADV-2 redis.call(command, ...args): a nested check through one command does not count another command\'s calls', t => {
  const redis = Substitute.for<any>()
  const reply = redis.call('get', 'k') // code under test
  reply.toString()
  t.notThrows(() => redis.call('del', 'k').didNotReceive().toString())
  t.notThrows(() => redis.call('get', 'k').received(1).toString())
  t.notThrows(() => redis.call('get', 'k')[received](1).toString())
  const message = failureOf(t, () => redis.call('get', 'k').didNotReceive().toString())
  t.true(message.includes('@Substitute.call(\'get\', \'k\').toString'), message)
  t.false(message.includes('@Substitute(\'k\')'), message)

  // apply() follows the same rule
  const client = Substitute.for<any>()
  client.apply('incr', ['n']).value.returns(1)
  t.is(client.apply('incr', ['n']).value, 1)
  t.not(client.apply('decr', ['n']).value, 1)
  t.not(client.apply('incr', ['n']), client.apply('decr', ['n']))
})

test('R14-ADV-2 recording is unchanged (D26): such an invocation is counted under both readings', t => {
  const redis = Substitute.for<any>()
  redis.call('get', 'k')
  t.notThrows(() => redis.received(1).call('get', 'k'))
  t.notThrows(() => redis.received(1)('k'))
  t.notThrows(() => redis[received](1)('k'))
  failureOf(t, () => redis.didNotReceive().call('get', 'k'))
  failureOf(t, () => redis[didNotReceive]()('k'))

  // checks through a call with matchers under either reading count the calls made on what the invocation answered
  const shop = Substitute.for<any>()
  shop.rpc.call('getUser', 1).save()
  t.notThrows(() => shop.rpc.call('getUser', Arg.any())[received](1).save())
  t.notThrows(() => shop.rpc(Arg.any())[received](1).save())
  failureOf(t, () => shop.rpc(Arg.any())[didNotReceive]().save())
  failureOf(t, () => shop.rpc.call(Arg.any(), Arg.any())[didNotReceive]().save())
})

test('R14-ADV-2 configured answers are as before: setups of the member reading, and of the direct reading', t => {
  const rpc = Substitute.for<any>()
  const user = Substitute.for<any>()
  rpc.call('getUser', 1).returns(user)
  t.is(rpc.call('getUser', 1), user)
  t.not(rpc.call('deleteUser', 1), user)
  rpc.call('ping', Arg.all()).returns('pong')
  t.is(rpc.call('ping', 1, 2), 'pong')
  rpc[configure]().call('a', 7).returns('C7')
  t.is(rpc.call('a', 7), 'C7')

  // a configured answer of the direct reading (D26 b) still answers
  const redis = Substitute.for<any>()
  redis('k').returns(5)
  t.is(redis.call('get', 'k'), 5)
  redis(Arg.any()).returns('any')
  t.is(redis.call('set', 'x'), 'any')
  // and a mimicked function receives the invocation
  const fn = Substitute.for<any>()
  fn(Arg.all()).mimicks(function (this: unknown, a: unknown): unknown[] { return [this, a] })
  t.deepEqual(fn.call('self', 1), ['self', 1])
})

test('R14-ADV-2 wrappers keep E82: undefined, null, objects and functions as the first argument answer the direct call\'s auto-substitute', t => {
  const api = Substitute.for<any>()
  api.getUser(1).name.returns('bob')
  const user = api.getUser(1)
  t.is(withRetry(api.getUser)(1), user)
  t.is(withRetry(api.getUser).call(api, 1), user)
  t.is(callWith(api.getUser)(1), user)
  t.is(api.getUser.call(undefined, 1), user)
  t.is(api.getUser.call(null, 1), user)
  t.is(api.getUser.call({ some: 'this' }, 1), user)
  t.is(api.getUser.call(Object, 1), user)
  t.is(api.getUser.apply(api, [1]), user)
  t.is(api.getUser.apply(undefined, [1]).name, 'bob')

  const fn = Substitute.for<any>()
  fn(1).name.returns('ann')
  t.is(fn.call(undefined, 1).name, 'ann')
  t.is(fn.apply(null, [1]).name, 'ann')
  t.is(withRetry(fn)(1).name, 'ann')
  // bind is unchanged
  t.is(fn.bind('primitive', 1)().name, 'ann')
})
