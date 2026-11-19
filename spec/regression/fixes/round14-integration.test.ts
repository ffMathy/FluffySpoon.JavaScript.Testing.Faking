import test, { ExecutionContext } from 'ava'

import { Substitute, Arg, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 14, integration of fix/r14-engine-calls (E82: call and apply answer what x(...args) answers) with
// fix/r14-engine-checks (E81: a check through a call with matchers counts the calls of the substitutes that the matching
// received calls answered).

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of the SubstituteException that `check` throws (failing the test if it throws none or another error). */
const failureOf = (t: ExecutionContext, check: () => void): string => {
  try {
    check()
  } catch (error) {
    if (error instanceof SubstituteException) return plain(error.message)
    throw error
  }
  t.fail('the check passed, but it should have failed')
  return ''
}

/** The message without its "called at" lines (they name this file, whose path depends on the checkout). */
const withoutSites = (message: string) => message.split('\n').filter(line => !line.trim().startsWith('called at ')).join('\n')

/** A wrapper that forwards with fn.apply(this, args), as retry, once, memoize and spies do. */
const withRetry = <F extends (...args: any[]) => any>(fn: F) => function (this: unknown, ...args: any[]) { return fn.apply(this, args) }

test('E81 + E82 a check through a call with matchers counts a configured substitute that a call made through call or apply answered', t => {
  for (const how of ['direct', 'apply', 'call'] as const) {
    const api = Substitute.for<any>()
    const user = Substitute.for<any>()
    api.getUser(1).returns(user)

    const got = how === 'direct' ? api.getUser(1) : how === 'apply' ? withRetry(api.getUser)(1) : api.getUser.call(null, 1)
    t.is(got, user, how)
    got.save()

    t.notThrows(() => api.getUser(Arg.any())[received](1).save(), how)
    t.notThrows(() => api.getUser(Arg.any()).received(1).save(), how)
    t.notThrows(() => user.received(1).save(), how)
    const message = withoutSites(failureOf(t, () => api.getUser(Arg.any()).didNotReceive().save()))
    t.true(message.startsWith('Call count mismatch in @Substitute.getUser(Arg.any{any}).save:\nExpected to receive 0 method calls matching save(), but received 1.\n'), `${how}: ${message}`)
    t.true(message.includes('› ✔ @Substitute.save()'), `${how}: ${message}`)
  }
})

test('E81 + E82 function substitutes: a check through a call with matchers counts what fn.apply and fn.call answered, configured or not', t => {
  const configured = Substitute.for<any>()
  const runner = Substitute.for<any>()
  configured(1).returns(runner)
  configured.apply(undefined, [1]).start()
  t.notThrows(() => configured(Arg.any())[received](1).start())
  t.notThrows(() => runner.received(1).start())

  const unconfigured = Substitute.for<any>()
  unconfigured.call(undefined, 2).start()
  t.is(unconfigured.call(null, 2), unconfigured(2))
  t.notThrows(() => unconfigured(Arg.any())[received](1).start())
  t.regex(failureOf(t, () => unconfigured(Arg.any()).didNotReceive().start()), /Expected to receive 0 method calls matching start\(\), but received 1\./)
})

test('E81 + E82 a check through a call with matchers on the member call or apply counts what the invocation answered under that reading too', t => {
  // unconfigured: the invocation answers the direct call's auto-substitute (E82)
  const client = Substitute.for<any>()
  client.rpc.call('getUser', 1).save()
  t.notThrows(() => client.rpc.call('getUser', Arg.any())[received](1).save())
  t.notThrows(() => client.rpc.call('getUser', Arg.any()).received(1).save())
  t.notThrows(() => client.rpc(Arg.any())[received](1).save())
  t.regex(failureOf(t, () => client.rpc.call('getUser', Arg.any()).didNotReceive().save()), /Expected to receive 0 method calls matching save\(\), but received 1\./)
  t.regex(failureOf(t, () => client.rpc.call('deleteUser', Arg.any())[received](1).save()), /but received none\./)

  const api = Substitute.for<any>()
  withRetry(api.getUser)(1).save()
  t.notThrows(() => api.getUser.apply(Arg.any(), Arg.any())[received](1).save())

  // a setup written through the member reading answers (D26): both readings count what it answered
  const configured = Substitute.for<any>()
  const user = Substitute.for<any>()
  configured.rpc.call('getUser', Arg.any()).returns(user)
  t.is(configured.rpc.call('getUser', 1), user)
  user.save()
  t.notThrows(() => configured.rpc.call('getUser', Arg.any())[received](1).save())
  t.notThrows(() => configured.rpc(Arg.any())[received](1).save())
  t.regex(failureOf(t, () => configured.rpc.call(Arg.any(), Arg.any()).didNotReceive().save()), /Expected to receive 0 method calls matching save\(\), but received 1\./)

  // and a setup of the direct call: the member reading counts what it answered as well
  const direct = Substitute.for<any>()
  const other = Substitute.for<any>()
  direct.getUser(1).returns(other)
  withRetry(direct.getUser)(1).save()
  t.notThrows(() => direct.getUser.apply(Arg.any(), Arg.any())[received](1).save())
})
