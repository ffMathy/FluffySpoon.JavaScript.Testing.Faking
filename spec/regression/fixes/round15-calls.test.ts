import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg, configure, received, didNotReceive, mimick } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'
import { matcherKindOf } from '../../../src/shared/Arguments'

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

// ---- E93 (R14V-1): values whose keys cannot be listed, next to a matcher --------------------------------------------

/** Proxies whose ownKeys / getOwnPropertyDescriptor traps throw: Object.keys and util.isDeepStrictEqual throw for them. */
const unlistables = (): Array<[string, object]> => [
  ['ownKeys', new Proxy({ a: 1 }, { ownKeys() { throw new Error('ownKeys') } })],
  ['getOwnPropertyDescriptor', new Proxy({ a: 1 }, { getOwnPropertyDescriptor() { throw new Error('getOwnPropertyDescriptor') } })]
]

test('R14V-1 a value whose keys cannot be listed, nested next to a matcher, matches by identity: nested setups answer', t => {
  for (const [name, value] of unlistables()) {
    const repo = Substitute.for<any>()
    repo.load({ entity: value, id: Arg.any() }).returns('n')
    t.is(repo.load({ entity: value, id: 7 }), 'n', name)
    // the other key order, arrays, and re-configuration
    repo.find({ id: Arg.any(), entity: value }).returns('f')
    t.is(repo.find({ id: 1, entity: value }), 'f', name)
    repo.list([value, Arg.any()]).returns('l')
    t.is(repo.list([value, 2]), 'l', name)
    repo.load({ entity: value, id: Arg.any() }).returns('again')
    t.is(repo.load({ entity: value, id: 8 }), 'again', name)
    // another value (equal or not) does not match
    t.not(repo.load({ entity: { a: 1 }, id: 7 }), 'again', name)
    t.not(repo.load({ entity: unlistables()[0][1], id: 7 }), 'again', name)
    // a nested setup through a call with the matcher
    const app = Substitute.for<any>()
    app.repo({ entity: value, id: Arg.any() }).name.returns('nested')
    t.is(app.repo({ entity: value, id: 1 }).name, 'nested', name)
  }
})

test('R14V-1 checks with such a value next to a matcher count the calls made: didNotReceive() fails, received(1) passes', t => {
  for (const [name, value] of unlistables()) {
    const repo = Substitute.for<any>()
    repo.save({ entity: value, id: 1 }) // code under test
    t.notThrows(() => repo.received(1).save({ entity: value, id: Arg.any() }), name)
    t.notThrows(() => repo.received(1).save({ entity: value, id: 1 }), name)
    t.notThrows(() => repo[received](1).save({ id: Arg.any(), entity: value }), name)
    const message = failureOf(t, () => repo.didNotReceive().save({ entity: value, id: Arg.any() }))
    t.true(message.includes('Expected to receive 0 method calls matching save('), message)
    failureOf(t, () => repo[didNotReceive]().save({ id: Arg.any(), entity: value }))
    t.notThrows(() => repo.didNotReceive().save({ entity: { a: 1 }, id: Arg.any() }), name)
    t.throws(() => repo.received(2).save({ entity: value, id: Arg.any() }), { instanceOf: SubstituteException })
    // the setups and checks above recorded nothing
    t.notThrows(() => repo.received(1).save(Arg.all()), name)
  }
})

test('R14V-1 a container whose keys can no longer be listed at the call is compared by identity, never different by default', t => {
  // a filter that held a matcher when the setup was made, and cannot be read when the call is made
  const { proxy: filter, revoke } = Proxy.revocable<object>({ id: Arg.any() }, {})
  const repo = Substitute.for<any>()
  repo.load({ filter }).returns('n')
  revoke()
  t.is(repo.load({ filter }), 'n')
  t.not(repo.load({ filter: { id: 7 } }), 'n')
  t.notThrows(() => repo.received(1).load({ filter }))
})

// ---- E95 (R14FE-1): a matcher's look at a substitute argument leaves no trace -----------------------------------------

/** jest's and vitest's asymmetric matchers, as E75 recognises them (the shape, without the runner). */
const asymmetric = (test: (value: any) => boolean): object => ({ $$typeof: Symbol.for('jest.asymmetricMatcher'), asymmetricMatch: test })
/** sinon's matchers, as E75 recognises them (the shape, without sinon): an object that is not plain, with test and message. */
class SinonLikeMatcher {
  constructor(public test: (value: any) => boolean, public message = 'match(fn)') { }
  and(): void { }
  or(): void { }
}

test('R14FE-1 a check whose predicate reads a substitute argument does not record the read or use up a sequence value', t => {
  const user = Substitute.for<any>()
  user.name.returns('ann', 'bob')
  const bus = Substitute.for<any>()
  bus.publish(user) // code under test
  t.notThrows(() => bus.received(1).publish(Arg.is(u => u.name === 'ann')))
  t.notThrows(() => bus.received(1).publish(Arg.is(u => u.name === 'ann')), 'the predicate sees the same value again')
  t.notThrows(() => user.didNotReceive().name)
  t.is(user.name, 'ann', 'the code under test\'s first read gets the first value')
  t.notThrows(() => user.received(1).name)
  t.is(user.name, 'bob')

  // methods, chains and call/apply/bind inside the predicate
  const order = Substitute.for<any>()
  order.total().returns(5, 7)
  order.items.count.returns(2)
  const sink = Substitute.for<any>()
  sink.write(order)
  t.notThrows(() => sink.received(1).write(Arg.is(o => o.total() === 5 && o.items.count === 2)))
  t.notThrows(() => sink.received(1).write(Arg.is(o => o.total.call(o) === 5 && o.total.apply(null, []) === 5 && o.total.bind(o)() === 5)))
  t.notThrows(() => sink.received(1).write(Arg.is(o => o.meta().tag.length !== 0 && new o.Item(1) !== undefined)))
  t.notThrows(() => order.didNotReceive().total())
  t.notThrows(() => order.didNotReceive().items)
  t.notThrows(() => order.didNotReceive().meta(Arg.all()))
  t.notThrows(() => order.didNotReceive().Item(Arg.all()))
  t.is(order.total(), 5)
  t.notThrows(() => order.received(1).total())
  t.is(plain(String(order)), [
    '@Substitute {',
    '  received:',
    '    total()',
    '  configured:',
    '    total() => returns(5, 7)',
    '    items.count => returns(2)',
    '}'
  ].join('\n'))
})

test('R14FE-1 a setup whose predicate reads the argument of a real call records nothing and uses up nothing', t => {
  const repo = Substitute.for<any>()
  repo.save(Arg.is(u => u.name === 'ann')).returns('saved')
  const user = Substitute.for<any>()
  user.name.returns('ann', 'bob')
  t.is(repo.save(user), 'saved') // code under test
  t.is(repo.save(user), 'saved')
  t.notThrows(() => user.didNotReceive().name)
  t.is(user.name, 'ann')
  t.notThrows(() => repo.received(2).save(user))

  // a nested predicate (in a plain object) and a test runner's and sinon's matchers alike
  const logger = Substitute.for<any>()
  const client = Substitute.for<any>()
  client.id.returns('c1', 'c2')
  logger.info({ client }) // code under test
  t.notThrows(() => logger.received(1).info({ client: Arg.is((c: any) => c.id === 'c1') }))
  t.notThrows(() => logger.received(1).info({ client: asymmetric(c => c.id === 'c1') }))
  t.notThrows(() => logger.received(1).info(new SinonLikeMatcher(entry => entry.client.id === 'c1')))
  logger.warn(asymmetric(c => c.id === 'c1')).returns('warned')
  t.is(logger.warn(client), 'warned')
  t.notThrows(() => client.didNotReceive().id)
  t.is(client.id, 'c1')
})

test('R14FE-1 a throws() setup still throws inside the predicate (a non-match), and the read is neither recorded nor listed', t => {
  const order = Substitute.for<any>()
  order.total.throws(new Error('not loaded'))
  const sink = Substitute.for<any>()
  sink.write(order)
  t.notThrows(() => sink.didNotReceive().write(Arg.is(o => o.total > 0)))
  const message = failureOf(t, () => sink.received(1).write(Arg.is(o => o.total > 0)))
  t.true(message.includes('an Arg.is predicate threw while matching this call: Error: not loaded'), message)
  t.notThrows(() => order.didNotReceive().total)
  t.throws(() => order.total, { message: 'not loaded' }) // code under test
  const listing = failureOf(t, () => order.received(2).total)
  t.is((listing.match(/called at/g) ?? []).length, 1, listing)
  t.false(listing.includes(`${__filename.replace(/.*[\\/]/, '').replace(/\.js$/, '')}:`) && listing.includes('o.total > 0'), listing)
})

test('R14FE-1 what the predicate does leaves nothing behind: assignments, a mimicked instance, promises of a sequence', async t => {
  const instance = { count: 1, get: (key: string) => key }
  const mimicked = Substitute.for<any>()
  mimicked[mimick](instance)
  const queue = Substitute.for<any>()
  queue.push(mimicked)
  t.notThrows(() => queue.received(1).push(Arg.is(m => m.count === 1 && m.get('a') === 'a')))
  t.notThrows(() => queue.received(1).push(Arg.is(m => { m.count = 9; return true })))
  t.is(instance.count, 1)
  t.notThrows(() => mimicked.didNotReceive().count)
  t.notThrows(() => mimicked.didNotReceive().get(Arg.all()))
  t.notThrows(() => mimicked.didNotReceive().count = Arg.any())

  const service = Substitute.for<any>()
  service.load().resolves('one', 'two')
  service.fail().rejects(new Error('failed'))
  const jobs = Substitute.for<any>()
  jobs.add(service)
  t.notThrows(() => jobs.received(1).add(Arg.is(s => s.load() instanceof Promise && s.fail() instanceof Promise)))
  t.is(await service.load(), 'one')
  await t.throwsAsync(service.fail(), { message: 'failed' })
  t.notThrows(() => service.received(1).load())

  // a member configured both as a property and as a method (D32)
  const sizes = Substitute.for<any>()
  sizes.size(Arg.any()).returns(10, 11)
  sizes.size.returns(3, 4)
  const measure = Substitute.for<any>()
  measure.of(sizes)
  t.notThrows(() => measure.received(1).of(Arg.is(s => s.size.toFixed(1) === '3.0' && s.size(1) === 10 && s.size.call(null, 1) === 10)))
  t.notThrows(() => sizes.didNotReceive().size)
  t.notThrows(() => sizes.didNotReceive().size(Arg.all()))
  t.is(sizes.size(1), 10)
  t.is(sizes.size.toFixed(1), '3.0')
})

test('R14FE-1 the property-style half of a check (D9) is still deferred, and later checks are unaffected', t => {
  const clock = interceptDeferredReports()
  try {
    const user = Substitute.for<any>()
    user.name.returns('ann')
    const bus = Substitute.for<any>()
    bus.publish(user)
    void bus.received(2).publish
    const errors = clock.run()
    t.is(errors.length, 1)
    t.true(plain(String((errors[0] as Error).message)).includes('Expected to receive 2 property reads matching publish, but received none.'))
    t.notThrows(() => bus.received(1).publish(Arg.is(u => u.name === 'ann')))
    t.is(clock.run().length, 0)
    t.notThrows(() => user.didNotReceive().name)
  } finally {
    clock.uninstall()
  }
})

// ---- E96 (R14FE-4): Arg matchers inside the matchers of test runners ------------------------------------------------

/*
 * The equality of jest's and vitest's expect, reduced to what decides here (the compatibility checks run the real
 * ones): a value with an `asymmetricMatch` method is a matcher, and asked; otherwise objects compare key by key.
 */
const isAsymmetric = (value: any): boolean => !!value && typeof value.asymmetricMatch === 'function'
const runnerEquals = (a: any, b: any): boolean => {
  if (isAsymmetric(a) && !isAsymmetric(b)) return !!a.asymmetricMatch(b)
  if (isAsymmetric(b) && !isAsymmetric(a)) return !!b.asymmetricMatch(a)
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return Object.is(a, b)
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => runnerEquals(a[key], b[key]))
}
/** jest's expect.objectContaining(sample), as E75 recognises it and as jest matches it. */
const objectContaining = (sample: Record<string, unknown>): object => ({
  $$typeof: Symbol.for('jest.asymmetricMatcher'),
  sample,
  asymmetricMatch: (other: any) => other !== null && typeof other === 'object' &&
    Object.keys(sample).every(key => key in other && runnerEquals(sample[key], other[key])),
  toAsymmetricMatcher: () => 'ObjectContaining'
})

test('R14FE-4 an Arg matcher inside the sample of a test runner\'s matcher matches as the Arg matcher, in checks and setups', t => {
  const producer = Substitute.for<any>()
  producer.send({ topic: 'orders', messages: [{ key: 'o1' }] })
  t.notThrows(() => producer.received(1).send(objectContaining({ topic: Arg.any('string') })))
  t.notThrows(() => producer.received(1).send(objectContaining({ topic: Arg.is((topic: string) => topic.startsWith('ord')), messages: Arg.any('array') })))
  t.notThrows(() => producer.didNotReceive().send(objectContaining({ topic: Arg.any('number') })))
  t.notThrows(() => producer.didNotReceive().send(objectContaining({ topic: Arg.is.not((topic: string) => topic === 'orders') })))
  const message = failureOf(t, () => producer.didNotReceive().send(objectContaining({ topic: Arg.any('string') })))
  t.true(message.includes('Expected to receive 0 method calls matching send(ObjectContaining'), message)

  const repo = Substitute.for<any>()
  repo.save(objectContaining({ id: Arg.any(), tags: Arg.all() })).returns('saved')
  t.is(repo.save({ id: 7, tags: ['a'], name: 'x' }), 'saved')
  t.not(repo.save({ name: 'x' }), 'saved')
  t.notThrows(() => repo.received(2).save(Arg.all()))
})

test('R14FE-4 a runner\'s equality asks Arg matchers through asymmetricMatch: Arg.any / Arg.is decide, Arg.all() matches anything, an Arg matcher matches nothing', t => {
  t.true(runnerEquals({ id: 7 }, { id: Arg.any() }))
  t.true(runnerEquals({ id: 'x' }, { id: Arg.any('string') }))
  t.false(runnerEquals({ id: 7 }, { id: Arg.any('string') }))
  t.true(runnerEquals({ id: 7 }, { id: Arg.is((id: number) => id > 5) }))
  t.false(runnerEquals({ id: 7 }, { id: Arg.is.not((id: number) => id > 5) }))
  t.true(runnerEquals({ id: [1, 2] }, { id: Arg.all() }))
  t.false(runnerEquals({ id: 7 }, { id: Arg.is(() => { throw new Error('boom') }) }), 'a predicate that throws does not match')
  const matcher = Arg.any() as any
  t.false(matcher.asymmetricMatch(Arg.any()), 'D3: an Arg matcher is never a value that a matcher matches')
  t.true((Arg.all() as any).asymmetricMatch(undefined))

  // what it looks at on a substitute leaves no trace (E95)
  const user = Substitute.for<any>()
  user.name.returns('ann', 'bob')
  t.true(runnerEquals({ user }, { user: Arg.is((u: any) => u.name === 'ann') }))
  t.notThrows(() => user.didNotReceive().name)
  t.is(user.name, 'ann')
})

test('R14FE-4 Arg matchers print as before and are still recognised as Arg matchers first', t => {
  const matchers = [Arg.any(), Arg.any('string'), Arg.is((x: number) => x > 1), Arg.is.not((x: number) => x > 1), Arg.all()] as any[]
  for (const matcher of matchers) {
    t.false(Object.prototype.hasOwnProperty.call(matcher, 'asymmetricMatch'))
    t.false(Object.keys(matcher).includes('asymmetricMatch'))
    t.false('$$typeof' in matcher)
    t.is(typeof matcher.asymmetricMatch, 'function')
    t.is(matcherKindOf(matcher), matcher === matchers[4] ? 'all' : 'single')
  }
  t.is(inspect(matchers, { breakLength: Infinity }), "[ Arg.any{any}, Arg.any{string}, Arg.is{(x) => x > 1}, Not Arg.is{(x) => x > 1}, Arg.all{} ]")
  t.is(String(matchers[0]), 'Arg.any{any}')
  t.is(JSON.stringify(matchers[0]), '{"_description":"Arg.any{any}","_type":"SingleArgument"}')
  const repo = Substitute.for<any>()
  repo.find({ id: Arg.any() }, objectContaining({ tag: Arg.any('string') })).returns(1)
  t.is(plain(String(repo)), [
    '@Substitute {',
    '  configured:',
    "    find({ id: Arg.any{any} }, ObjectContaining) => returns(1)",
    '}'
  ].join('\n'))
})
