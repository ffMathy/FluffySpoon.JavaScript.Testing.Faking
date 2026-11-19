import test, { ExecutionContext } from 'ava'
import * as path from 'path'
import { inspect } from 'util'

import * as library from '../../../src'
import { Substitute, Arg, configure, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 15, engine (checks through a call with matchers): the round-14 findings R14-ADV-5, R14-ADV-4, R14-ADV-6 and
// R14-ADV-1, decided in the fix spec as E88, E89, E92 and E90.

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

/** The message of any error that `check` throws (an error of another copy of the library is no SubstituteException here). */
const errorOf = (t: ExecutionContext, check: () => void, label?: string): string => {
  try {
    check()
  } catch (error) {
    return plain(String((error as Error).message))
  }
  t.fail(`the check passed, but it should have failed${label === undefined ? '' : `: ${label}`}`)
  return ''
}

/** The message without its "called at" lines (they name this file, whose path depends on the checkout). */
const withoutSites = (message: string) => message.split('\n').filter(line => !line.trim().startsWith('called at ')).join('\n')

type CheckForm = { name: string, open: (result: any, count: number) => any, passes: (count: number, actual: number) => boolean }
const checkForms: CheckForm[] = [
  { name: 'received()', open: result => result.received(), passes: (_count, actual) => actual >= 1 },
  { name: 'received(n)', open: (result, count) => result.received(count), passes: (count, actual) => actual === count },
  { name: 'didNotReceive()', open: result => result.didNotReceive(), passes: (_count, actual) => actual === 0 },
  { name: '[received]()', open: result => result[received](), passes: (_count, actual) => actual >= 1 },
  { name: '[received](n)', open: (result, count) => result[received](count), passes: (count, actual) => actual === count },
  { name: '[didNotReceive]()', open: result => result[didNotReceive](), passes: (_count, actual) => actual === 0 }
]

// ---- E88 (R14-ADV-5): calls answered with a value that is not a substitute ----------------------------------------

test('R14-ADV-5 (E88) the finding: a check through a call with matchers whose matching call resolved a substitute is a usage error, never a silent pass', async t => {
  const api = Substitute.for<any>()
  const user = Substitute.for<any>()
  api.load(Arg.any()).resolves(user)
  const loaded = await api.load(1) // the code under test
  loaded.save()
  t.notThrows(() => user.received(1).save())

  for (const form of checkForms) {
    for (const count of [0, 1, 2]) {
      const message = failureOf(t, () => form.open(api.load(Arg.any()), count).save(), `${form.name} n=${count}`)
      t.true(message.startsWith('Cannot check through @Substitute.load(Arg.any{any}): the received call @Substitute.load(1), which it matches, ' +
        'is configured with resolves(@Substitute), so it answered a promise, which is not a substitute.'), message)
      t.true(message.includes('Check that value directly instead (for example user.received(1).save(), for a substitute user that it holds or resolves to), or check a concrete call.'), message)
    }
  }

  // a plain object configured with returns()
  const config = Substitute.for<any>()
  config.get(Arg.any()).returns({ save(): void { /* a real object */ } })
  config.get('x').save()
  t.true(failureOf(t, () => config.get(Arg.any())[didNotReceive]().save())
    .includes("the received call @Substitute.get('x'), which it matches, is configured with returns({ save: [Function: save] }), and that value is not a substitute."))
})

test('R14-ADV-5 (E88) every kind of answer that is not a substitute is reported, as what answered the matching call', t => {
  const kinds: Array<{ name: string, setup: (api: any) => void, says: string }> = [
    { name: 'returns(undefined)', setup: api => api.load(Arg.any()).returns(undefined), says: 'is configured with returns(undefined), and that value is not a substitute' },
    { name: 'a literal setup', setup: api => api.load(1).returns(5), says: 'is configured with returns(5), and that value is not a substitute' },
    { name: 'rejects()', setup: api => api.load(Arg.any()).rejects(new Error('no')), says: 'is configured with rejects([Error: no]), so it answered a rejected promise, which is not a substitute' },
    { name: 'throws()', setup: api => api.load(Arg.any()).throws(new Error('boom')), says: 'is configured with throws([Error: boom]), so it threw instead of answering a substitute' },
    { name: 'mimicks()', setup: api => api.load(Arg.any()).mimicks(() => ({ id: 1 })), says: 'is configured with mimicks([Function (anonymous)]), whose result is not a substitute' },
    { name: 'a mimicked instance', setup: api => api[mimick]({ load: () => ({ id: 1 }) }), says: 'is answered by the mimicked instance with a value that is not a substitute' },
    { name: 'a mimicked method that throws', setup: api => api[mimick]({ load: () => { throw new Error('x') } }), says: 'threw an error instead of answering a substitute' }
  ]
  for (const kind of kinds) {
    const api = Substitute.for<any>()
    kind.setup(api)
    try {
      const answer = api.load(1) // the code under test
      if (answer instanceof Promise) answer.catch((): void => undefined)
    } catch {
      // (a throwing answer)
    }
    for (const form of checkForms) {
      const message = failureOf(t, () => form.open(api.load(Arg.any()), 1).save(), `${kind.name} ${form.name}`)
      t.true(message.includes(`the received call @Substitute.load(1), which it matches, ${kind.says}.`), `${kind.name} ${form.name}: ${message}`)
    }
    // further down the call with matchers, a usage error too (see E90 below for its text)
    t.throws(() => api.load(Arg.any()).items[received](1).clear(), { instanceOf: SubstituteException }, kind.name)
  }

  // the call made through a wrapper's fn.apply(this, args) (E82) is noted the same way
  const api = Substitute.for<any>()
  api.load(1).returns({ id: 1 })
  const load = api.load
  load.apply(undefined, [1])
  t.true(failureOf(t, () => api.load(Arg.any())[didNotReceive]().save()).includes('is configured with returns({ id: 1 }), and that value is not a substitute'))
})

test('R14-ADV-5 (E88) only the matching calls decide: substitutes keep being counted, and no matching call counts none', t => {
  // answered only with substitutes: counted, as before
  const api = Substitute.for<any>()
  const user = Substitute.for<any>()
  api.load(Arg.any()).returns(user)
  api.load(1).save()
  api.load(2) // the auto-substitute of a nested setup would be counted too; this one answers user
  t.notThrows(() => api.load(Arg.any())[received](1).save())
  t.throws(() => api.load(Arg.any())[didNotReceive]().save(), { instanceOf: SubstituteException, message: /Expected to receive 0 method calls matching save\(\), but received 1\./ })

  // a matching call answered with a plain value next to one answered with a substitute: a usage error
  const mixed = Substitute.for<any>()
  const first = Substitute.for<any>()
  mixed.load(1).returns(first)
  mixed.load(2).returns(7)
  mixed.load(1).save()
  mixed.load(2)
  t.true(failureOf(t, () => mixed.load(Arg.any())[received](1).save()).includes('the received call @Substitute.load(2), which it matches, is configured with returns(7)'))
  // ... unless the matchers leave that call out
  t.notThrows(() => mixed.load(Arg.is((id: number) => id === 1))[received](1).save())
  t.notThrows(() => mixed.load(Arg.is((id: number) => id === 1)).didNotReceive().close())

  // no matching call: nothing to count, whatever the setups answer
  const idle = Substitute.for<any>()
  idle.load(Arg.any()).resolves(1)
  t.notThrows(() => idle.load(Arg.any())[didNotReceive]().save())
  t.true(failureOf(t, () => idle.load(Arg.any()).received(1).save()).includes('but received none.'))

  // unconfigured calls answer their auto-substitutes, and `new` with a configured primitive gives one as well (E23)
  const bus = Substitute.for<any>()
  bus.on('a', 1)()
  t.notThrows(() => bus.on(Arg.any(), Arg.any())[received](1)())
  const ns = Substitute.for<any>()
  ns.Client(Arg.any()).returns(5)
  const client = new ns.Client('u')
  client.connect()
  t.notThrows(() => ns.Client(Arg.any())[received](1).connect())

  // a call noted before clearReceivedCalls() is gone with it
  const cleared = Substitute.for<any>()
  cleared.load(Arg.any()).returns(3)
  cleared.load(1)
  cleared[library.clearReceivedCalls]()
  t.notThrows(() => cleared.load(Arg.any())[didNotReceive]().save())
})

test('R14-ADV-5 (E88) noting what calls answered changes nothing else: setups, sequences, literal checks and later answers', t => {
  const api = Substitute.for<any>()
  api.load(Arg.any()).returns(1, 2, 3)
  t.deepEqual([api.load('a'), api.load('b'), api.load('c'), api.load('d')], [1, 2, 3, 3])
  t.notThrows(() => api.received(4).load(Arg.any()))
  t.notThrows(() => api.received(1).load('b'))
  t.throws(() => api.load(Arg.any())[received](4).save(), { instanceOf: SubstituteException, message: /is configured with returns\(1, 2, 3\), and the value it answered is not a substitute\./ })
  t.is(api.load('e'), 3)

  // a sequence of a substitute and a plain value: the call that got the substitute is counted, the other one is not
  const bus = Substitute.for<any>()
  const first = Substitute.for<any>()
  bus.on(Arg.any(), Arg.any()).returns(first, 5)
  bus.on('x', 1)()
  void bus.on('y', 2)
  t.notThrows(() => bus.on('x', Arg.any())[received](1)())
  t.true(failureOf(t, () => bus.on(Arg.any(), Arg.any())[received](1)()).includes("the received call @Substitute.on('y', 2), which it matches, is configured with returns(@Substitute, 5)"))

  // a long run of calls answered by the same setup is noted once (runs), and calls of other members in between are fine
  const logger = Substitute.for<any>()
  logger.log(Arg.any()).returns(undefined)
  const store = Substitute.for<any>()
  for (let index = 0; index < 1000; index++) {
    logger.log(index)
    if (index % 100 === 0) logger.flush()
  }
  t.notThrows(() => logger.received(1000).log(Arg.any()))
  t.true(failureOf(t, () => logger.log(Arg.is((index: number) => index === 999))[didNotReceive]().x()).includes('the received call @Substitute.log(999)'))
  logger.log(Arg.is((index: number) => index === 5000)).returns(store)
  logger.log(5000).save()
  t.notThrows(() => logger.log(Arg.is((index: number) => index === 5000))[received](1).save())
})

// ---- E89 (R14-ADV-4): substitutes of another copy of the library ----------------------------------------------------

/** Loads a second, independent copy of the library, as happens with duplicate installs (see duplicate-copies.test.ts). */
const loadSecondCopy = (): typeof library => {
  const entry = require.resolve('../../../src')
  const root = path.dirname(entry) + path.sep
  const saved = new Map<string, NodeModule>()
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) {
      saved.set(key, require.cache[key]!)
      delete require.cache[key]
    }
  }
  try {
    return require(entry)
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key]
    for (const [key, module] of saved) require.cache[key] = module
  }
}

test('R14-ADV-4 (E89) the finding: a substitute of another copy that a matching call answered is checked, through that copy', t => {
  const other = loadSecondCopy()
  t.not(other.Substitute, Substitute)
  const factory = Substitute.for<any>()
  const job = other.Substitute.for<any>() // e.g. created by a helper package that bundles its own copy
  factory.create(Arg.any()).returns(job)
  factory.create('a').run() // the code under test

  t.notThrows(() => job.received(1).run())
  t.notThrows(() => factory.create(Arg.any())[received](1).run())
  t.notThrows(() => factory.create(Arg.any())[received]().run())
  t.notThrows(() => factory.create(Arg.any()).received(1).run())
  t.true(errorOf(t, () => factory.create(Arg.any())[didNotReceive]().run()).includes('Expected to receive 0 method calls matching run(), but received 1.'))
  t.true(errorOf(t, () => factory.create(Arg.any()).didNotReceive().run()).includes('Expected to receive 0 method calls matching run(), but received 1.'))
  t.true(errorOf(t, () => factory.create(Arg.any())[received](2).run()).includes('Expected to receive 2 method calls matching run(), but received 1.'))
  t.notThrows(() => factory.create(Arg.any())[didNotReceive]().stop())

  // further down, through that copy's configure view
  const db = Substitute.for<any>()
  const pool = other.Substitute.for<any>()
  db.pool(Arg.any()).returns(pool)
  db.pool('main').client(1).query('select 1') // the code under test
  t.notThrows(() => db.pool(Arg.any()).client(1)[received](1).query(Arg.any()))
  t.notThrows(() => db.pool(Arg.any()).client(Arg.any())[received](1).query('select 1'))
  t.true(errorOf(t, () => db.pool(Arg.any()).client(1)[didNotReceive]().query(Arg.any())).includes('Expected to receive 0 method calls'))

  // with no matching call, nothing is counted
  const idle = Substitute.for<any>()
  idle.create(Arg.any()).returns(other.Substitute.for<any>())
  t.notThrows(() => idle.create(Arg.any())[didNotReceive]().run())
})

test('R14-ADV-4 (E89) a substitute of another copy among several substitutes to count is a usage error naming the call with matchers', t => {
  const other = loadSecondCopy()
  const factory = Substitute.for<any>()
  const job = other.Substitute.for<any>()
  factory.create('a').returns(job)
  factory.create('a').run() // answered by the other copy's substitute
  factory.create('b').run() // answered by this copy's auto-substitute
  for (const form of checkForms) {
    const message = failureOf(t, () => form.open(factory.create(Arg.any()), 1).run(), form.name)
    t.true(message.startsWith('Cannot check through @Substitute.create(Arg.any{any}): the received calls that it matches answered several substitutes, ' +
      'and at least one of them belongs to another copy of @fluffy-spoon/substitute (another install of the package)'), message)
    t.true(message.includes('Check each of those substitutes directly instead'), message)
  }
  // a check that leaves the other one out counts as usual
  t.notThrows(() => factory.create(Arg.is((name: string) => name === 'b'))[received](1).run())
  t.notThrows(() => factory.create(Arg.is((name: string) => name === 'a'))[received](1).run())
})

// ---- E92 (R14-ADV-6): the path labels of a deferred report ----------------------------------------------------------

test('R14-ADV-6 (E92) a deferred report of a check through a call with matchers keeps each call\'s own path when the view is used again', t => {
  const clock = interceptDeferredReports()
  try {
    const repo = Substitute.for<any>()
    repo.find(1).close() // the code under test
    repo.find(2).close()
    const view = repo.find(Arg.any())[received](3)
    void view.close // a property-style check of a member that was only invoked: deferred (D9)
    t.true(failureOf(t, () => view.other).includes('but received none.')) // the same view, used again before the report
    const reports = clock.run().map(error => plain((error as Error).message))
    t.is(reports.length, 1)
    t.true(reports[0].includes('Expected to receive 3 property reads matching close, but received none.'), reports[0])
    t.deepEqual(withoutSites(reports[0]).split('\n').filter(line => line.startsWith('› ')), [
      '› ✘ @Substitute.find(1).close()',
      '› ✘ @Substitute.find(2).close()'
    ])
  } finally {
    clock.uninstall()
  }
})

test('R14-ADV-6 (E92) the same holds for the string forms and further down a call with matchers', t => {
  const clock = interceptDeferredReports()
  try {
    const app = Substitute.for<any>()
    app.repo('users').items.clear() // the code under test
    const view = app.repo(Arg.any()).items.received(2)
    void view.clear
    t.true(failureOf(t, () => view.size).includes('but received none.'))
    const reports = clock.run().map(error => plain((error as Error).message))
    const clear = reports.find(report => report.includes('matching clear'))
    t.truthy(clear, reports.join('\n---\n'))
    t.true(clear!.includes("› ✘ @Substitute.repo('users').items.clear()"), clear)
  } finally {
    clock.uninstall()
  }
})

// ---- E90 (R14-ADV-1): checks two or more steps below a call with matchers -------------------------------------------

/** Whether a check passes (a deferred report of a property-style check does not count here). */
const passesWithoutThrowing = (check: () => unknown): boolean => {
  const clock = interceptDeferredReports()
  try {
    check()
    return true
  } catch (error) {
    if (error instanceof SubstituteException) return false
    throw error
  } finally {
    clock.run()
    clock.uninstall()
  }
}

const printed = (value: unknown): string => plain(inspect(value))

test('R14-ADV-1 (E90) the finding: below a call with matchers whose setup returns a substitute, a check counts what the matching calls answered, not that substitute alone', t => {
  const api = Substitute.for<any>()
  const client = Substitute.for<any>()
  api.client(Arg.any()).returns(client)
  client.items.clear() // the code under test uses client from elsewhere; api.client() is never called

  t.true(failureOf(t, () => api.client(Arg.any())[received](1).items).includes('but received none.'))
  for (const form of checkForms) {
    for (const count of [0, 1]) {
      const check = () => form.open(api.client(Arg.any()).items, count).clear()
      if (form.passes(count, 0)) t.notThrows(check, `${form.name} n=${count}`)
      else t.true(failureOf(t, check, `${form.name} n=${count}`).includes('Call count mismatch in @Substitute.client(Arg.any{any}).items.clear:'), form.name)
    }
  }

  // once a received api.client(...) call returned client, its calls count
  api.client('users').items.clear()
  for (const form of checkForms) {
    for (const count of [0, 1, 2]) {
      const check = () => form.open(api.client(Arg.any()).items, count).clear()
      if (form.passes(count, 2)) t.notThrows(check, `${form.name} n=${count}`)
      else t.throws(check, { instanceOf: SubstituteException }, `${form.name} n=${count}`)
    }
  }
  // depth 1 and depth 2 agree: a matching call answered client, whose items were read twice (and cleared twice)
  for (const form of checkForms) {
    for (const count of [0, 1, 2, 3]) {
      t.is(passesWithoutThrowing(() => form.open(api.client(Arg.any()), count).items), form.passes(count, 2), `depth 1 ${form.name} n=${count}`)
    }
  }
  const message = failureOf(t, () => api.client(Arg.any()).items[received](3).clear())
  t.true(message.includes('All property or method calls to @Substitute.client(Arg.any{any}).items.clear received so far:'), message)
  t.is(withoutSites(message).split('\n').filter(line => line.startsWith('› ')).length, 2, message)

  // the setup keeps answering, and the check configured nothing on client
  t.is(api.client('orders'), client)
  t.false('items' in client)
  t.notThrows(() => client.received(2).items)
})

test('R14-ADV-1 (E90) a matcher setup, a literal one through the configure view, and calls made before the setup are counted step by step', t => {
  // A: a matcher setup and a literal one (the most specific answers); the code under test calls with 'users'
  const app = Substitute.for<any>()
  const defaultRepo = Substitute.for<any>()
  const usersRepo = Substitute.for<any>()
  app.repo(Arg.any()).returns(defaultRepo)
  app[configure]().repo('users').returns(usersRepo)
  app.repo('users').items.clear() // the code under test
  t.notThrows(() => app.repo(Arg.any())[received](1).items)
  t.true(failureOf(t, () => app.repo(Arg.any()).items[didNotReceive]().clear()).includes('› ✔ @Substitute.items.clear()'))
  t.throws(() => app.repo(Arg.any()).items.didNotReceive().clear(), { instanceOf: SubstituteException })
  t.notThrows(() => app.repo(Arg.any()).items[received](1).clear())
  t.notThrows(() => app.repo(Arg.any()).items.received(1).clear())

  // B: a call made before the setup answered its auto-substitute, which is counted
  const later = Substitute.for<any>()
  const app2 = Substitute.for<any>()
  app2.repo('users').items.clear() // the code under test
  app2.repo(Arg.any()).returns(later)
  t.true(failureOf(t, () => app2.repo(Arg.any()).items[didNotReceive]().clear()).includes("› ✔ @Substitute.repo('users').items.clear()"))
  t.notThrows(() => app2.repo(Arg.any()).items[received](1).clear())

  // C: a nested property setup through the call with matchers, with calls before and after it
  const app3 = Substitute.for<any>()
  const db = Substitute.for<any>()
  app3.repo('users').db.query('a') // the auto-substitute, before the nested setup
  app3.repo(Arg.any()).db.returns(db)
  app3.repo('orders').db.query('b') // db
  t.notThrows(() => app3.repo(Arg.any()).db[received](2).query(Arg.any()))
  t.notThrows(() => app3.repo(Arg.any()).db.received(2).query(Arg.any()))
  t.true(failureOf(t, () => app3.repo(Arg.any()).db[received](1).query(Arg.any())).includes('but received 2.'))
  t.notThrows(() => app3.repo(Arg.is((name: string) => name === 'orders')).db[received](1).query('b'))
  t.notThrows(() => db.received(1).query('b'))
})

test('R14-ADV-1 (E90) three steps down, through forwarded calls and members, in the configure view too', t => {
  const app = Substitute.for<any>()
  const tenant = Substitute.for<any>()
  const users = Substitute.for<any>()
  app.tenant(Arg.any()).returns(tenant) // a call forwarded to a substitute ...
  tenant.table('users').returns(users) // ... whose call is configured to return another one
  app.tenant('acme').table('users').insert(1) // the code under test
  app.tenant('beta').table('logs').insert(2)
  users.insert(3) // from elsewhere: counted too, since a received table('users') call returned users

  t.notThrows(() => app.tenant(Arg.any()).table(Arg.any())[received](3).insert(Arg.any()))
  t.notThrows(() => app.tenant(Arg.any()).table('users')[received](2).insert(Arg.any()))
  t.notThrows(() => app.tenant(Arg.any()).table('users').received(1).insert(1))
  t.true(failureOf(t, () => app.tenant(Arg.any()).table('users')[didNotReceive]().insert(1)).includes('› ✔ @Substitute.insert(1)'))
  t.notThrows(() => app.tenant(Arg.any()).table('logs')[received](1).insert(2))
  t.notThrows(() => app[configure]().tenant(Arg.any()).table('users')[received](1).insert(1))
  t.notThrows(() => app[configure]().tenant(Arg.any()).table(Arg.any())[received](3).insert(Arg.any()))
  // a tenant that no received call returned has nothing to count
  const idle = Substitute.for<any>()
  idle.tenant(Arg.any()).returns(tenant)
  t.notThrows(() => idle.tenant(Arg.any()).table('users')[didNotReceive]().insert(Arg.any()))

  // a member forwarded below a call with matchers (D31), three steps down
  const store = Substitute.for<any>()
  const cache = Substitute.for<any>()
  store.open(Arg.any()).cache.returns(cache)
  store.open('a').cache.entries.clear() // the code under test
  cache.entries.clear() // from elsewhere
  t.notThrows(() => store.open(Arg.any()).cache.entries[received](2).clear())
  t.true(failureOf(t, () => store.open(Arg.any()).cache.entries.received(3).clear()).includes('but received 2.'))
  t.notThrows(() => store.open(Arg.is((name: string) => name === 'b')).cache.entries[didNotReceive]().clear())
})

test('R14-ADV-1 (E90) nested setups through a forwarded call still go to the configured substitute, and checks configure nothing', t => {
  const api = Substitute.for<any>()
  const client = Substitute.for<any>()
  api.client(Arg.any()).returns(client)
  api.client(Arg.any()).items.add('x').returns(true) // D31: forwarded to client
  api.client(Arg.any()).name.returns('main')
  t.true(client.items.add('x'))
  t.is(client.name, 'main')
  t.is(api.client(1).name, 'main')
  // the string forms followed by a setup method, or in the configure view, configure a member called received (D11, D5)
  api.client(Arg.any()).inbox.received(1).returns(['mail'])
  t.deepEqual(client.inbox.received(1), ['mail'])
  api[configure]().client(Arg.any()).outbox.received(2).returns('two')
  t.is(client.outbox.received(2), 'two')

  // checks through it configure nothing
  const fresh = Substitute.for<any>()
  const freshClient = Substitute.for<any>()
  fresh.client(Arg.any()).returns(freshClient)
  t.notThrows(() => fresh.client(Arg.any()).items[didNotReceive]().clear())
  t.notThrows(() => fresh.client(Arg.any()).items.didNotReceive().clear())
  t.notThrows(() => fresh.client(Arg.any()).a.b(1).c[didNotReceive]().d())
  t.false('items' in freshClient)
  t.false('a' in freshClient)
  t.is(printed(freshClient), '@Substitute {\n}')

  // a forwarded setup whose value is not a substitute: nested setups are D31's usage error, checks E88's
  const loader = Substitute.for<any>()
  const user = Substitute.for<any>()
  loader.load(Arg.any()).resolves(user)
  t.throws(() => loader.load(Arg.any()).user.returns(1), { instanceOf: SubstituteException, message: /Cannot configure @Substitute\.load\(Arg\.any\{any\}\)\.user: load\(Arg\.any\{any\}\) is configured with resolves\(\)/ })
  t.notThrows(() => loader.load(Arg.any()).user[didNotReceive]().save(), 'no matching call: nothing to count')
  void loader.load(1) // the code under test
  t.true(failureOf(t, () => loader.load(Arg.any()).user[didNotReceive]().save())
    .includes('Cannot check through @Substitute.load(Arg.any{any}): the received call @Substitute.load(1), which it matches, is configured with resolves(@Substitute)'))
})
