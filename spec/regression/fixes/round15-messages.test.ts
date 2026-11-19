import test, { ExecutionContext } from 'ava'

import { Substitute, Arg, mimick, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 15, engine (messages): the round-14 findings R14-ADV-3 and R14FE-5, decided in the fix spec as E98 and E97.

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

// ---- E98 (R14-ADV-3): a call-form check of a member whose reads answered values that cannot be called ---------------

const METHOD_HINT = 'reading a method does not count as calling it'

test('R14-ADV-3 (E98) the finding: a call-form check of a property configured with a value gives no method hint, and says what its reads answered', t => {
  const config = Substitute.for<any>()
  config.port.returns(5432)
  void config.port // the code under test reads the port

  // the count equals the reads: the property part passes, and the call is what fails (method wording, ✘ marks)
  t.is(withoutSites(failureOf(t, () => config.received(1).port())), [
    'Call count mismatch in @Substitute.port:',
    'Expected to receive 1 method call matching port(), but received none.',
    'All property or method calls to @Substitute.port received so far:',
    '› ✘ @Substitute.port',
    '@Substitute.port was read 1 time, and its reads answered a value that cannot be called, so they are property reads, not method calls. ' +
    'To check them, leave out the call: sub.received(1).port',
    ''
  ].join('\n'))
  const any = failureOf(t, () => config.received().port())
  t.true(any.includes('Expected to receive 1 or more method calls matching port(), but received none.'), any)
  t.true(any.includes('To check them, leave out the call: sub.received().port'), any)
  t.false(any.includes(METHOD_HINT), any)
  // and the checks that leave out the call pass
  t.notThrows(() => config.received(1).port)
  t.notThrows(() => config.received().port)

  void config.port
  const twice = failureOf(t, () => config[received](2).port())
  t.true(twice.includes('Expected to receive 2 method calls matching port(), but received none.'), twice)
  t.true(twice.includes('@Substitute.port was read 2 times, and its reads answered a value that cannot be called'), twice)
  t.is(twice.split('\n').filter(line => line.startsWith('› ✘ @Substitute.port')).length, 2, twice)
  t.false(twice.includes(METHOD_HINT), twice)

  // a count other than the reads: E85's property wording, ✔ marks and no hint, as before
  t.is(withoutSites(failureOf(t, () => config.received(1).port())), [
    'Call count mismatch in @Substitute.port:',
    'Expected to receive 1 property read matching port, but received 2.',
    'All property or method calls to @Substitute.port received so far:',
    '› ✔ @Substitute.port',
    '› ✔ @Substitute.port',
    ''
  ].join('\n'))
})

test('R14-ADV-3 (E98) every kind of value that cannot be called, decided as E85 decides it', t => {
  const values = Substitute.for<any>()
  values.nothing.returns(null)
  values.unset.returns()
  values.data.resolves(1)
  values.failure.throws(new Error('no'))
  const settings = Substitute.for<any>()
  settings[mimick]({ timeout: 30 })
  for (const [sub, member] of [[values, 'nothing'], [values, 'unset'], [values, 'data'], [values, 'failure'], [settings, 'timeout'], [settings, 'missing']] as const) {
    try { void sub[member] } catch { /* (throws()) */ }
    const message = failureOf(t, () => sub.received(1)[member]('x'))
    t.true(message.includes(`Expected to receive 1 method call matching ${member}('x'), but received none.`), message)
    t.true(message.includes(`› ✘ @Substitute.${member}`), message)
    t.true(message.includes(`@Substitute.${member} was read 1 time, and its reads answered a value that cannot be called, so they are property reads, not method calls. ` +
      `To check them, leave out the call: sub.received(1).${member}`), message)
    t.false(message.includes(METHOD_HINT), message)
  }
})

test('R14-ADV-3 (E98) members that may be methods keep the method hint', t => {
  class WithGetter { get port() { return 5432 } }
  const kinds: Record<string, (sub: any) => void> = {
    unconfigured: () => undefined,
    function: sub => sub.port.returns(() => 1),
    substitute: sub => sub.port.returns(Substitute.for<any>()),
    mimicks: sub => sub.port.mimicks(() => 5432),
    alsoMethod: sub => { sub.port(1).returns(2); sub.port.returns(5432) },
    mimickedMethod: sub => sub[mimick]({ port() { return 1 } }),
    mimickedGetter: sub => sub[mimick](new WithGetter())
  }
  for (const [kind, setup] of Object.entries(kinds)) {
    const sub = Substitute.for<any>()
    setup(sub)
    void sub.port
    const message = failureOf(t, () => sub.received(1).port(Arg.all()))
    t.true(message.includes(`@Substitute.port was read 1 time without being called; ${METHOD_HINT}.`), `${kind}: ${message}`)
    t.false(message.includes('cannot be called'), `${kind}: ${message}`)
  }
})
