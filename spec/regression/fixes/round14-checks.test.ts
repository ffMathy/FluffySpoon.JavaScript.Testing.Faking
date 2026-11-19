import test, { ExecutionContext } from 'ava'
import { inspect } from 'util'

import { Substitute, Arg, configure, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 14, engine (checks): the round-13 findings R13FE-3 and R13-ADV-2, decided in the fix spec as E81 and E85.

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

/** The messages of the reports thrown by `tick()`, one tick per report. */
const reportsOf = (clock: ReturnType<typeof interceptDeferredReports>, count: number): string[] => {
  const messages: string[] = []
  for (let index = 0; index < count; index++) {
    try {
      clock.tick()
    } catch (error) {
      if (!(error instanceof SubstituteException)) throw error
      messages.push(plain(error.message))
    }
  }
  return messages
}

// ---- E81 (R13FE-3): checks through a call with matchers ------------------------------------------------------------

test('R13FE-3 (E81) the finding: checks through a call with matchers check what the matching calls answered, and re-route nothing', t => {
  const bus = Substitute.for<any>()
  const off = bus.on('saved', (): void => undefined) // the code under test subscribes with an inline handler
  off() // ... and unsubscribes

  t.notThrows(() => bus.on('saved', Arg.any()).received(1)())
  t.true(failureOf(t, () => bus.on('deleted', Arg.any()).received(7)())
    .includes("Expected to receive 7 method calls matching @Substitute.on('deleted', Arg.any{any})(), but received none."))
  t.true(failureOf(t, () => bus.on('saved', Arg.any()).didNotReceive()())
    .includes("Expected to receive 0 method calls matching @Substitute.on('saved', Arg.any{any})(), but received 1."))
  t.notThrows(() => bus.on('saved', Arg.any())[received](1)())
  t.throws(() => bus.on('saved', Arg.any())[didNotReceive]()(), { instanceOf: SubstituteException })

  const app = Substitute.for<any>()
  app.repo('users').save(1) // the code under test
  const users = app.repo('users')
  const message = failureOf(t, () => app.repo(Arg.any()).didNotReceive().save(1))
  t.is(withoutSites(message), [
    'Call count mismatch in @Substitute.repo(Arg.any{any}).save:',
    'Expected to receive 0 method calls matching save(1), but received 1.',
    'All property or method calls to @Substitute.repo(Arg.any{any}).save received so far:',
    "› ✔ @Substitute.repo('users').save(1)",
    ''
  ].join('\n'))
  t.notThrows(() => app.repo('users').received(1).save(1), 'a correct literal check after it')
  t.is(app.repo('users'), users, 'the same auto-substitute as before the check')

  // an earlier setup on what the code under test got keeps answering
  const repo = Substitute.for<any>()
  const found = repo.find(1)
  found.name.returns('ann')
  t.notThrows(() => repo.find(Arg.any())[didNotReceive]().delete())
  t.is(repo.find(1), found)
  t.is(repo.find(1).name, 'ann')
})

type CheckForm = { name: string, open: (result: any, count: number | undefined) => any }
const checkForms: CheckForm[] = [
  { name: 'received()', open: result => result.received() },
  { name: 'received(n)', open: (result, count) => result.received(count) },
  { name: 'didNotReceive()', open: result => result.didNotReceive() },
  { name: '[received]()', open: result => result[received]() },
  { name: '[received](n)', open: (result, count) => result[received](count) },
  { name: '[didNotReceive]()', open: result => result[didNotReceive]() }
]

/** Whether a check form with this count passes for `actual` matching calls. */
const passes = (form: CheckForm, count: number, actual: number) =>
  form.name.includes('didNotReceive') ? actual === 0 : form.name.endsWith('(n)') ? actual === count : actual >= 1

/*
 * Where the call with matchers is: on the substitute itself, on one of its auto-substitutes, and on the result of a call
 * (depth 1 and 2), with the code under test's calls made through the same path.
 */
type Position = { name: string, through: (sub: any) => any }
const positions: Position[] = [
  { name: 'depth 1', through: sub => sub },
  { name: 'depth 2 (a member)', through: sub => sub.db },
  { name: 'depth 2 (a call)', through: sub => sub.tenant('acme') }
]

test('R13FE-3 (E81) every check form through a call with matchers, at depth 1 and 2, with and without matching calls, counts the calls of what they answered', t => {
  for (const position of positions) {
    for (const form of checkForms) {
      for (const count of [0, 1, 2]) {
        if (count === 0 && !form.name.endsWith('(n)')) continue
        const label = `${position.name} ${form.name} n=${count}`
        const sub = Substitute.for<any>()
        const tables = [position.through(sub).table('users'), position.through(sub).table('orders')]
        tables[0].insert({ id: 1 })
        tables[1].insert({ id: 2 })
        tables[1].remove(2)

        // with matching calls: insert() was called once on each of two tables, remove() once on one
        const insertCheck = () => form.open(position.through(sub).table(Arg.any()), count).insert(Arg.any())
        if (passes(form, count, 2)) t.notThrows(insertCheck, label)
        else t.throws(insertCheck, { instanceOf: SubstituteException }, label)
        const removeCheck = () => form.open(position.through(sub).table(Arg.is((name: string) => name === 'orders')), count).remove(2)
        if (passes(form, count, 1)) t.notThrows(removeCheck, label)
        else t.throws(removeCheck, { instanceOf: SubstituteException }, label)
        // without matching calls
        const noneCheck = () => form.open(position.through(sub).table(Arg.is((name: string) => name === 'logs')), count).insert(Arg.any())
        if (passes(form, count, 0)) t.notThrows(noneCheck, label)
        else t.true(failureOf(t, noneCheck).includes('but received none.'), label)

        // nothing was re-routed: the same auto-substitutes, and literal checks see the calls
        t.is(position.through(sub).table('users'), tables[0], label)
        t.is(position.through(sub).table('orders'), tables[1], label)
        t.notThrows(() => position.through(sub).table('orders').received(1).remove(2), label)
        t.notThrows(() => tables[0][received](1).insert({ id: 1 }), label)
        t.false('table' in position.through(sub), label)
      }
    }
  }
})

test('R13FE-3 (E81) a check view one member further down a call with matchers counts the calls of that member of each answer', t => {
  const repo = Substitute.for<any>()
  repo.find(1).items.clear() // the code under test
  repo.find(2).items.add('x')
  const first = repo.find(1)
  first.name.returns('ann')

  t.notThrows(() => repo.find(Arg.any()).items[received](1).clear())
  t.notThrows(() => repo.find(Arg.any()).items[received](1).add('x'))
  t.true(failureOf(t, () => repo.find(Arg.any()).items[didNotReceive]().clear())
    .includes("› ✔ @Substitute.find(1).items.clear()"))
  t.true(failureOf(t, () => repo.find(Arg.is((id: number) => id > 1)).items[received](1).clear())
    .includes('Expected to receive 1 property read or method call matching clear, but received none.'))
  // through the configure view, too
  t.notThrows(() => repo[configure]().find(Arg.any()).items[received](1).clear())
  t.notThrows(() => repo[configure]().find(Arg.any())[received](2).items)

  t.is(repo.find(1), first)
  t.is(repo.find(1).name, 'ann')
  t.notThrows(() => repo.find(1).items.received(1).clear())
  t.false('find' in Substitute.for<any>())
})

test('R13FE-3 (E81) checks count configured values that are substitutes, and the auto-substitute of a nested setup through a matcher call', t => {
  const api = Substitute.for<any>()
  const usersClient = Substitute.for<any>()
  const ordersClient = Substitute.for<any>()
  api.client('users').returns(usersClient)
  api.client('orders').returns(ordersClient)
  api.client('users').get(1) // the code under test
  api.client('orders').get(2)
  api.client('orders').get(3)

  t.notThrows(() => api.client(Arg.any())[received](3).get(Arg.any()))
  t.notThrows(() => api.client(Arg.any()).received(2).get(Arg.is((id: number) => id > 1)))
  const message = failureOf(t, () => api.client(Arg.any()).received(1).get(Arg.any()))
  t.true(message.includes('Expected to receive 1 method call matching get(Arg.any{any}), but received 3.'), message)
  t.true(message.includes('All property or method calls to @Substitute.client(Arg.any{any}).get received so far:'), message)
  t.is(message.split('\n').filter(line => line.startsWith('› ✔ @Substitute.get(')).length, 3, message)

  // a nested setup through a call with matchers answers the calls it matches with its auto-substitute: those count
  const repo = Substitute.for<any>()
  repo.find(Arg.any()).name.returns('x')
  const found = repo.find(5) // the code under test
  found.save()
  t.is(found.name, 'x')
  t.notThrows(() => repo.find(Arg.any())[received](1).save())
  t.notThrows(() => repo.find(Arg.any()).received(1).save())
  t.throws(() => repo.find(Arg.any()).didNotReceive().save(), { instanceOf: SubstituteException })
  t.is(repo.find(6).name, 'x', 'the nested setup keeps answering')

  // a fluent mimicked instance answers with the substitute itself (E76): its own calls count
  const emitter = Substitute.for<any>()
  emitter[mimick]({ on() { return this } })
  emitter.on('a', (): void => undefined).on('b', (): void => undefined)
  t.notThrows(() => emitter.on('a', Arg.any())[received](1).on('b', Arg.any()))
})

test('R13FE-3 (E81) the failure message names each substitute that a matching call answered by its own path', t => {
  const bus = Substitute.for<any>()
  bus.on('saved', 'h1')()
  bus.on('deleted', 'h2')()
  bus.on('deleted', 'h2')()
  bus.on('other', 'h3')

  const message = withoutSites(failureOf(t, () => bus.on(Arg.any(), Arg.any())[received](2)()))
  t.is(message, [
    'Call count mismatch in @Substitute.on(Arg.any{any}, Arg.any{any}):',
    'Expected to receive 2 method calls matching @Substitute.on(Arg.any{any}, Arg.any{any})(), but received 3.',
    'All property or method calls to @Substitute.on(Arg.any{any}, Arg.any{any}) received so far:',
    "› ✔ @Substitute.on('saved', 'h1')()",
    "› ✔ @Substitute.on('deleted', 'h2')()",
    "› ✔ @Substitute.on('deleted', 'h2')()",
    ''
  ].join('\n'))

  // a property check, and an assignment check
  const store = Substitute.for<any>()
  store.open('a').state = 'ready'
  void store.open('b').state
  t.notThrows(() => { store.open(Arg.any())[received](1).state = 'ready' })
  const assignment = withoutSites(failureOf(t, () => { store.open(Arg.any()).received(2).state = Arg.any() }))
  t.true(assignment.includes("Expected to receive 2 property assignments matching state = Arg.any{any}, but received 1."), assignment)
  t.true(assignment.includes("› ✔ @Substitute.open('a').state = 'ready'"), assignment)
  const read = withoutSites(failureOf(t, () => store.open(Arg.any())[received](2).state))
  t.true(read.includes("› ✘ @Substitute.open('b').state"), read)
})

test('R13FE-3 (E81) the string forms are checks there, as on any other substitute: no count passes that does not hold', t => {
  const bus = Substitute.for<any>()
  bus.on('saved', (): void => undefined)()
  for (let count = 0; count <= 3; count++) {
    const check = () => bus.on('saved', Arg.any()).received(count)()
    if (count === 1) t.notThrows(check)
    else t.throws(check, { instanceOf: SubstituteException }, `received(${count})`)
  }
  t.notThrows(() => bus.on('saved', Arg.any()).received()())
  t.throws(() => bus.on('saved', Arg.any()).didNotReceive()(), { instanceOf: SubstituteException })
  t.notThrows(() => bus.on('closed', Arg.any()).didNotReceive()())
  // a matcher as the count is a usage error, as on any other substitute (D10)
  t.throws(() => bus.on('saved', Arg.any()).received(Arg.any()).off(), { instanceOf: SubstituteException, message: /non-negative integer/ })

  // followed by a substitution method, or used without being invoked, it is a nested setup of a member of that name (D11)
  const inbox = Substitute.for<any>()
  inbox.folder(Arg.any()).received(1).returns(['mail'])
  t.deepEqual(inbox.folder('x').received(1), ['mail'])
  inbox.folder(Arg.any()).received.count.returns(3)
  t.is(inbox.folder('y').received.count, 3)
  // in the configure view, a call of a member called received is a setup, also when another member follows (D5)
  const outbox = Substitute.for<any>()
  outbox[configure]().folder(Arg.any()).received(2).returns('two')
  t.is(outbox.folder('z').received(2), 'two')
  t.notThrows(() => outbox[configure]().folder(Arg.any()).received(3).flagged)
  t.is(outbox.folder('z'), outbox.folder('y'), 'a nested setup registered for folder(Arg.any()) answers both')
})

test('R13FE-3 (E81) a check through a call with matchers that nothing follows is reported as checking nothing', t => {
  const clock = interceptDeferredReports()
  try {
    const bus = Substitute.for<any>()
    bus.on('saved', (): void => undefined)()

    void bus.on('saved', Arg.any())[received](1)
    let messages = reportsOf(clock, 1)
    t.true(messages[0].startsWith("@Substitute.on('saved', Arg.any{any})[received](1) checked nothing"), messages[0])
    t.true(messages[0].includes("sub.on('saved', Arg.any{any})[received](1)(Arg.all())"), messages[0])

    bus.on('saved', Arg.any()).didNotReceive()
    messages = reportsOf(clock, 1)
    t.true(messages[0].startsWith("@Substitute.on('saved', Arg.any{any}).didNotReceive() checked nothing"), messages[0])

    // complete forms, setups and usage errors report nothing more
    t.notThrows(() => bus.on('saved', Arg.any())[received](1)(Arg.all()))
    t.notThrows(() => bus.on('saved', Arg.any()).received(1)())
    bus.on('saved', Arg.any()).received(2).returns('member called received')
    t.throws(() => bus.on('saved', Arg.any()).received(-1).off(), { instanceOf: SubstituteException })
    t.throws(() => Object.freeze(bus.on('saved', Arg.any()).received(1)), { instanceOf: SubstituteException })
    t.notThrows(() => clock.tick())
  } finally {
    clock.uninstall()
  }
})

test('R13FE-3 (E81) the D9/D36 deferred reports and E77\'s wording hold for checks through a call with matchers', t => {
  const clock = interceptDeferredReports()
  try {
    const bus = Substitute.for<any>()
    const subscription = bus.on('saved', (): void => undefined)
    subscription.off()

    // D9: a property-style check of a member that was called, with a finite count, is deferred; invoking it cancels it
    t.notThrows(() => bus.on(Arg.any(), Arg.any())[received](1).off())
    t.notThrows(() => clock.tick())
    void bus.on(Arg.any(), Arg.any())[received](2).off
    const messages = reportsOf(clock, 1)
    t.true(messages[0].includes('Expected to receive 2 property reads matching off, but received none.'), messages[0])
    t.true(messages[0].includes('off was never read as a property; it was called 1 time as a method.'), messages[0])

    // E77: a member that was only read (it may be a method) fails kind-neutrally, with the read-without-call hint
    const store = Substitute.for<any>()
    void store.open('a').close
    const message = failureOf(t, () => store.open(Arg.any())[received](2).close())
    t.true(message.includes('Expected to receive 2 property reads or method calls matching close, but received 1 property read and no method calls.'), message)
    t.true(message.includes("@Substitute.open(Arg.any{any}).close was read 1 time without being called; reading a method does not count as calling it."), message)
    t.notThrows(() => clock.tick())
  } finally {
    clock.uninstall()
  }
})

test('R13FE-3 (E81) nested setups through a call with matchers keep working, and a read through one without a setup changes nothing', t => {
  const repo = Substitute.for<any>()
  const first = repo.find(1)
  void repo.find(Arg.any()).name // a read, no setup
  void repo.find(Arg.any()).items.first
  t.is(repo.find(1), first)
  t.false('find' in repo)

  repo.find(Arg.any()).name.returns('x')
  t.is(repo.find(2).name, 'x')
  t.true('find' in repo)
  repo.find(Arg.any())[mimick]({ id: 7 })
  t.is(repo.find(3).id, 7)
  t.true(inspect(repo.find(Arg.is((id: number) => id > 0))).endsWith(' (configure)'))
})

// ---- E85 (R13-ADV-2): property checks of members whose reads answer values ------------------------------------------

test('R13-ADV-2 (E85) a property configured with a value that cannot be called keeps the property wording, its reads match, and there is no hint', t => {
  const connect = (config: any) => `${config.host}:${config.port} (retry on ${config.port})` // the code under test
  const config = Substitute.for<any>()
  config.host.returns('db')
  config.port.returns(5432)
  connect(config)

  const expected = (count: number, reads: string) => [
    'Call count mismatch in @Substitute.port:',
    `Expected to receive ${count} property ${count === 1 ? 'read' : 'reads'} matching port, but received ${reads}.`,
    'All property or method calls to @Substitute.port received so far:',
    '› ✔ @Substitute.port',
    '› ✔ @Substitute.port',
    ''
  ].join('\n')
  t.is(withoutSites(failureOf(t, () => config.received(1).port)), expected(1, '2'))
  t.is(withoutSites(failureOf(t, () => config.received(3).port)), expected(3, '2'))
  t.is(withoutSites(failureOf(t, () => config.didNotReceive().port)), expected(0, '2'))
  t.is(withoutSites(failureOf(t, () => config.received(1).port())), expected(1, '2'))
  t.notThrows(() => config.received(2).port)

  // a mimicked plain object, and values that cannot be called either: promises, a value that throws, no value
  const settings = Substitute.for<any>()
  settings[mimick]({ timeout: 30 })
  void settings.timeout
  void settings.timeout
  void settings.missing
  t.true(failureOf(t, () => settings.received(1).timeout).includes('Expected to receive 1 property read matching timeout, but received 2.'))
  t.true(failureOf(t, () => settings.received(2).missing).includes('Expected to receive 2 property reads matching missing, but received 1.'))
  const values = Substitute.for<any>()
  values.data.resolves(1)
  values.failure.throws(new Error('no'))
  values.nothing.returns()
  void values.data
  void values.data
  t.throws(() => values.failure)
  void values.nothing
  t.true(failureOf(t, () => values.received(1).data).includes('Expected to receive 1 property read matching data, but received 2.'))
  t.true(failureOf(t, () => values.received(2).failure).includes('Expected to receive 2 property reads matching failure, but received 1.'))
  const nothing = failureOf(t, () => values.received(2).nothing)
  t.true(nothing.includes('Expected to receive 2 property reads matching nothing, but received 1.'), nothing)
  t.false(nothing.includes('reading a method'), nothing)
})

test('R13-ADV-2 (E85) members whose reads answer a function, a substitute or an auto-substitute keep E77\'s wording and hint', t => {
  const kindNeutral = (message: string, member: string) =>
    message.includes(`Expected to receive 1 property read or method call matching ${member}, but received 2 property reads and no method calls.`) &&
    message.includes(`@Substitute.${member} was read 2 times without being called; reading a method does not count as calling it.`)
  const readTwice = (sub: any, member: string) => { void sub[member]; void sub[member] }

  const callback = Substitute.for<any>()
  callback.onDone.returns((): void => undefined)
  readTwice(callback, 'onDone')
  t.true(kindNeutral(failureOf(t, () => callback.received(1).onDone), 'onDone'))

  const parent = Substitute.for<any>()
  parent.child.returns(Substitute.for<any>())
  readTwice(parent, 'child')
  t.true(kindNeutral(failureOf(t, () => parent.received(1).child), 'child'))

  const unconfigured = Substitute.for<any>()
  readTwice(unconfigured, 'handler')
  t.true(kindNeutral(failureOf(t, () => unconfigured.received(1).handler), 'handler'))

  const mimicked = Substitute.for<any>()
  mimicked[mimick]({ save() { return 1 }, get timeout() { return 30 } })
  readTwice(mimicked, 'save')
  readTwice(mimicked, 'timeout') // a getter: the check does not run it, so it may be a method
  t.true(kindNeutral(failureOf(t, () => mimicked.received(1).save), 'save'))
  t.true(kindNeutral(failureOf(t, () => mimicked.received(1).timeout), 'timeout'))

  const computed = Substitute.for<any>()
  computed.total.mimicks(() => 3)
  readTwice(computed, 'total')
  t.true(kindNeutral(failureOf(t, () => computed.received(1).total), 'total'))

  const both = Substitute.for<any>()
  both.size(Arg.any()).returns(4)
  both.size.returns(3)
  readTwice(both, 'size')
  t.true(kindNeutral(failureOf(t, () => both.received(1).size), 'size'))
})

test('R13-ADV-2 (E85) through a call with matchers, the substitutes behind it decide together', t => {
  const pool = Substitute.for<any>()
  pool.get('a').port.returns(1)
  pool.get('b').port.returns(2)
  void pool.get('a').port
  void pool.get('b').port
  const values = failureOf(t, () => pool.get(Arg.any())[received](1).port)
  t.true(values.includes('Expected to receive 1 property read matching port, but received 2.'), values)
  t.false(values.includes('reading a method'), values)

  pool.get('c').port.returns(() => 3)
  void pool.get('c').port
  const mixed = failureOf(t, () => pool.get(Arg.any())[received](1).port)
  t.true(mixed.includes('but received 3 property reads and no method calls.'), mixed)
})
