import test, { ExecutionContext } from 'ava'
import * as path from 'path'

import * as library from '../../../src'
import { Substitute, Arg, configure, mimick, received, didNotReceive } from '../../../src'
import { isSubstituteProxy } from '../../../src/shared'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 16, engine (checks through a call with matchers, and through a concrete call that a setup with matchers
// answered): the round-15 findings R15FE-5, R15-ADV-1, R15-ADV-3, R15-ADV-8 and R15-ADV-2, decided in the fix spec as
// E99, E105, E107, E104 and E106.

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

/** The listed calls of a failure message (`› ✘ ...` lines), without "called at" lines. */
const listedLines = (message: string): string[] => message.split('\n').filter(line => line.startsWith('› '))

/**
 * The six forms of a check. A check through a concrete call is one expression with that call (D25: the library tells the
 * expression by its operations made one after the other in one function), so the tests write it in one function:
 * `io.to('room-b')[form.key](...form.args(count)).emit(...)`.
 */
type CheckForm = { name: string, key: PropertyKey, args: (count: number) => number[], passes: (count: number, actual: number) => boolean }
const checkForms: CheckForm[] = [
  { name: 'received()', key: 'received', args: () => [], passes: (_count, actual) => actual >= 1 },
  { name: 'received(n)', key: 'received', args: count => [count], passes: (count, actual) => actual === count },
  { name: 'didNotReceive()', key: 'didNotReceive', args: () => [], passes: (_count, actual) => actual === 0 },
  { name: '[received]()', key: received, args: () => [], passes: (_count, actual) => actual >= 1 },
  { name: '[received](n)', key: received, args: count => [count], passes: (count, actual) => actual === count },
  { name: '[didNotReceive]()', key: didNotReceive, args: () => [], passes: (_count, actual) => actual === 0 }
]

/** Whether a check passes (a deferred report of a property-style check does not count here). */
const passes = (check: () => unknown): boolean => {
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

/**
 * Every check form with the counts 0, 1 and 2 through `open(form, count)` (one expression, written by the caller), each
 * expected to pass exactly when the form passes for `actual` calls.
 */
const expectCounts = (t: ExecutionContext, label: string, actual: number, check: (form: CheckForm, count: number) => void): void => {
  for (const form of checkForms) {
    for (const count of [0, 1, 2]) {
      t.is(passes(() => check(form, count)), form.passes(count, actual), `${label}: ${form.name} with ${count}, ${actual} received`)
    }
  }
}

/** Every check form with the counts 0, 1 and 2 through `check`, each expected to be a usage error starting with `start`. */
const expectUsageError = (t: ExecutionContext, label: string, start: string, check: (form: CheckForm, count: number) => void): string => {
  let last = ''
  for (const form of checkForms) {
    for (const count of [0, 1, 2]) {
      last = errorOf(t, () => check(form, count), `${label}: ${form.name} with ${count}`)
      t.true(last.startsWith(start), `${label}: ${form.name} with ${count}: ${last}`)
    }
  }
  return last
}

// ---- E99 (R15FE-5): checks through a concrete call whose answer a setup with matchers shares --------------------------

test('R15FE-5 (E99) the finding: a check through a concrete call counts only what came through that call, while every matching call keeps answering the same substitute', t => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  t.is(io.to('room-a').emit('message', { text: 'hi' }), true) // the code under test: the wrong room

  // nothing came through to('room-b'): counted as none, in every form, at every count
  expectCounts(t, "to('room-b')", 0, (form, count) => io.to('room-b')[form.key](...form.args(count)).emit('message', { text: 'hi' }))
  // what came through to('room-a') is counted as before
  expectCounts(t, "to('room-a')", 1, (form, count) => io.to('room-a')[form.key](...form.args(count)).emit('message', { text: 'hi' }))

  // the failure says "received none", and lists the calls of the shared substitute without counting them
  const message = failureOf(t, () => io.to('room-b').received(1).emit('message', { text: 'hi' }))
  t.true(message.startsWith("Call count mismatch in @Substitute.to('room-b').emit:"), message)
  t.true(message.includes('but received none.'), message)
  const listed = listedLines(message)
  t.is(listed.length, 1, message)
  t.true(listed[0].startsWith('› ✘ ') && listed[0].endsWith(".emit('message', { text: 'hi' })"), message)

  // the checks of the calls themselves and through the call with matchers are unchanged
  t.true(failureOf(t, () => io.received(1).to('room-b')).includes("Expected to receive 1 method call matching to('room-b'), but received none."))
  t.notThrows(() => io.to(Arg.any()).received(1).emit('message', { text: 'hi' }))
  // NSubstitute's sharing stays: every matching call answers the same substitute
  t.is(io.to('room-a'), io.to('room-b'))
})

test('R15FE-5 (E99) the knex shape: a check through db(table) counts only the queries of that table, step by step', async t => {
  const db = Substitute.for<any>()
  db(Arg.any()).where(Arg.all()).first().resolves({ id: 1 })
  t.deepEqual(await db('orders').where('id', 1).first(), { id: 1 }) // the code under test queries the wrong table

  t.true(failureOf(t, () => db('users').received(1).where('id', 1)).includes('but received none.'))
  t.notThrows(() => db('users')[didNotReceive]().where(Arg.all()))
  t.notThrows(() => db('orders').received(1).where('id', 1))
  t.true(failureOf(t, () => db('orders').didNotReceive().where('id', 1)).includes('but received 1.'))
  // a concrete step further down narrows the same way
  t.notThrows(() => db('orders').where('id', 1).received(1).first())
  t.true(failureOf(t, () => db('orders').where('id', 2).received(1).first()).includes('but received none.'))
  t.notThrows(() => db('users').where('id', 1).didNotReceive().first())
  // and so does a concrete call followed by a call with matchers
  t.notThrows(() => db('orders').where(Arg.all())[received](1).first())
  t.true(failureOf(t, () => db('users').where(Arg.all())[received](1).first()).includes('but received none.'))
  t.notThrows(() => db('users').where(Arg.all()).didNotReceive().first())
  // the call itself, and the call with matchers, are checked as before
  t.true(failureOf(t, () => db.received(1)('users')).includes("but received none."))
  t.notThrows(() => db(Arg.any()).where(Arg.all())[received](1).first())
})

test('R15FE-5 (E99) when the shared substitute was returned to matching and other calls, the check is a usage error naming the call, the setup and the other calls', t => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  for (const room of ['room-a', 'room-b', 'room-c', 'room-d', 'room-e', 'room-b']) io.to(room).emit('message', room)

  const message = expectUsageError(t, "to('room-a')", "Cannot check through @Substitute.to('room-a'): ",
    (form, count) => io.to('room-a')[form.key](...form.args(count)).emit('message', 'room-a'))
  t.true(message.includes("@Substitute.to('room-a') has no setup of its own, so it answered the substitute @Substitute.to(Arg.any{any}), " +
    'which the setup @Substitute.to(Arg.any{any}) gives every call that it matches'), message)
  // each other call once, at most three, then how many more
  t.true(message.includes("that substitute was also returned to @Substitute.to('room-b'), @Substitute.to('room-c'), @Substitute.to('room-d') and 1 more."), message)
  t.true(message.includes("Check the call itself instead (sub.received(1).to('room-a'))"), message)
  t.true(message.includes('configure the concrete calls so that each answers a substitute of its own'), message)
  t.true(message.includes('or check through the call with matchers, which counts the calls that came through every call it matches (sub.to(Arg.any{any}).received(n)...)'), message)

  // a call that was never made is still counted as none, and the call with matchers counts every call
  t.notThrows(() => io.to('room-x').didNotReceive().emit(Arg.all()))
  t.notThrows(() => io.to(Arg.any()).received(6).emit(Arg.all()))
})

test('R15FE-5 (E99) a substitute that a setup with matchers returns, or a mimicked instance, is shared the same way; a concrete setup of the call keeps the check as before', t => {
  const io = Substitute.for<any>()
  const room = Substitute.for<any>()
  io.to(Arg.any()).returns(room)
  io.to('room-a').emit('x') // the code under test
  expectCounts(t, "returns(room): to('room-b')", 0, (form, count) => io.to('room-b')[form.key](...form.args(count)).emit('x'))
  expectCounts(t, "returns(room): to('room-a')", 1, (form, count) => io.to('room-a')[form.key](...form.args(count)).emit('x'))
  t.notThrows(() => room.received(1).emit('x'))

  // a concrete setup of the call: the check counts the calls of what it answers, as before
  io[configure]().to('room-b').returns(room)
  expectCounts(t, "own setup: to('room-b')", 1, (form, count) => io.to('room-b')[form.key](...form.args(count)).emit('x'))

  // a mimicked instance that answers every call with the same substitute
  const bus = Substitute.for<any>()
  const channel = Substitute.for<any>()
  bus[mimick]({ to: () => channel })
  bus.to('room-a').emit('y')
  expectCounts(t, "mimicked: to('room-b')", 0, (form, count) => bus.to('room-b')[form.key](...form.args(count)).emit('y'))
  expectCounts(t, "mimicked: to('room-a')", 1, (form, count) => bus.to('room-a')[form.key](...form.args(count)).emit('y'))
})

test('R15FE-5 (E99) calls made through call, apply and bind are hand-outs like any other, and a member step below the concrete call narrows too', t => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  io.to.apply(io, ['room-a']).emit('x') // the code under test, through wrappers
  io.to.bind(io, 'room-c')().emit('y')
  t.notThrows(() => io.to('room-b').didNotReceive().emit(Arg.all()))
  t.true(errorOf(t, () => io.to('room-a').received(1).emit('x')).startsWith("Cannot check through @Substitute.to('room-a'): "))

  const api = Substitute.for<any>()
  api.client(Arg.any()).items.list().returns([])
  api.client('a').items.clear() // the code under test
  expectCounts(t, "client('b').items", 0, (form, count) => api.client('b').items[form.key](...form.args(count)).clear())
  expectCounts(t, "client('a').items", 1, (form, count) => api.client('a').items[form.key](...form.args(count)).clear())
})

test('R15FE-5 (E99) deferred reports, dangling views and reused views work as for any check', t => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  io.to('room-a').emit('x')
  io.to('room-a').emit('x')

  // D9: a property-style check of a member that was only invoked, with a finite count, is reported later, unless invoked
  const clock = interceptDeferredReports()
  try {
    void io.to('room-a')[received](1).emit
    const reports = clock.run().map(error => plain((error as Error).message))
    t.is(reports.length, 1)
    t.true(reports[0].includes("Call count mismatch in @Substitute.to('room-a').emit:"), reports[0])
    io.to('room-a')[received](2).emit('x') // invoked: nothing reported
    t.deepEqual(clock.run(), [])
    // E48: a view that nothing follows is reported, named after the concrete call
    void io.to('room-b')[didNotReceive]()
    const dangling = clock.run().map(error => plain((error as Error).message))
    t.is(dangling.length, 1)
    t.true(dangling[0].startsWith("@Substitute.to('room-b')[didNotReceive]() checked nothing"), dangling[0])
  } finally {
    clock.uninstall()
  }

  // a view used again counts as a fresh one
  const view = io.to('room-b')[received](1)
  t.true(failureOf(t, () => view.emit('x')).includes('but received none.'))
  t.true(failureOf(t, () => view.emit('x')).includes('but received none.'))
  const none = io.to('room-b')[didNotReceive]()
  t.notThrows(() => none.emit('x'))
  t.notThrows(() => none.other())
})

test('R15FE-5 (E99) later setups, literal checks and identity are unchanged', t => {
  const io = Substitute.for<any>()
  const room = io.to(Arg.any())
  room.emit(Arg.all()).returns(true)
  t.is(io.to('a'), io.to('b'))
  t.is(io.to('a').emit('x'), true)
  // a setup through a concrete call configures the shared substitute, as before
  io.to('b').size.returns(3)
  t.is(io.to('c').size, 3)
  io.to('a').emit('y')
  t.notThrows(() => io.received(3).to('a'))
  t.notThrows(() => io.received(1).to('c'))
  t.notThrows(() => io.to(Arg.any()).received(2).emit(Arg.all()))
  t.is(io.to('d'), io.to('a'))
})

// ---- E105 (R15-ADV-1): a check is delegated to another copy's substitute only where it is opened on it -------------

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

test('R15-ADV-1 (E105) the finding: steps after another copy\'s substitute are a usage error, never a walk through that copy\'s configure view', t => {
  const other = loadSecondCopy()
  const factory = Substitute.for<any>()
  const job = other.Substitute.for<any>()
  const worker = other.Substitute.for<any>()
  factory.create(Arg.any()).returns(job)
  job.task(other.Arg.any()).returns(worker)
  factory.create('a').task('x').run() // the code under test; task('q') is never called

  const message = expectUsageError(t, "task('q')", "Cannot check through @Substitute.create(Arg.any{any}).task('q'): ",
    (form, count) => factory.create(Arg.any()).task('q')[form.key](...form.args(count)).run())
  t.true(message.includes('answered a substitute of another copy of @fluffy-spoon/substitute (another install of the package), ' +
    "and the check goes on below it (.task('q'))"), message)
  // the same holds further down
  t.true(errorOf(t, () => factory.create(Arg.any()).task(Arg.any()).items[received](1).clear()).startsWith('Cannot check through @Substitute.create(Arg.any{any})'))

  // checked through that copy directly, the calls are counted
  t.notThrows(() => worker.received(1).run())
  t.true(errorOf(t, () => job.received(1).task('q')).includes("Expected to receive 1 method call matching task('q'), but received none."))
  // where the check is opened on that copy's substitute, it is delegated, as before (E89)
  t.notThrows(() => factory.create(Arg.any())[received](1).task('x'))
  t.true(errorOf(t, () => factory.create(Arg.any()).didNotReceive().task('x')).includes('Expected to receive 0 method calls'))
})

test('R15-ADV-1 (E105) with one copy the same checks count the recorded calls, and nothing is forwarded', t => {
  const factory = Substitute.for<any>()
  const job = Substitute.for<any>()
  const worker = Substitute.for<any>()
  factory.create(Arg.any()).returns(job)
  job.task(Arg.any()).returns(worker)
  factory.create('a').task('x').run()
  expectCounts(t, "one copy: task('q')", 0, (form, count) => factory.create(Arg.any()).task('q')[form.key](...form.args(count)).run())
  expectCounts(t, "one copy: task('x')", 1, (form, count) => factory.create(Arg.any()).task('x')[form.key](...form.args(count)).run())
})

// ---- E107 (R15-ADV-3): a check view used again counts as a fresh one ---------------------------------------------------

test('R15-ADV-3 (E107) the finding: a check view used again counts exactly as a fresh view, in either order', t => {
  const setUp = () => {
    const bus = Substitute.for<any>()
    const s = Substitute.for<any>()
    bus[configure]().on('a').returns(s)    // on('a') answers s
    bus[configure]().on('b').returns(s.m)  // on('b') answers the handle s.m
    bus.on('a').m(1)                       // the code under test: s.m(1)
    bus.on('b')(1)                         // s.m(1) again, through the handle
    return bus
  }
  {
    const bus = setUp()
    const view = bus.on(Arg.any())[received](2)
    t.notThrows(() => view.m(1))
    t.notThrows(() => view(1))
    t.notThrows(() => view.m(1))
  }
  {
    const bus = setUp()
    const view = bus.on(Arg.any())[received](2)
    t.notThrows(() => view(1))
    t.notThrows(() => view.m(1))
  }
  {
    const bus = setUp()
    t.notThrows(() => bus.on(Arg.any())[received](2)(1))
    t.notThrows(() => bus.on(Arg.any())[received](2).m(1))
    const strings = bus.on(Arg.any()).received(2)
    t.notThrows(() => strings.m(1))
    t.notThrows(() => strings(1))
  }
})

test('R15-ADV-3 (E107) each use lists its records with their own paths, also in a report thrown later', t => {
  const clock = interceptDeferredReports()
  try {
    const bus = Substitute.for<any>()
    const s = Substitute.for<any>()
    bus[configure]().on('a').returns(s)
    bus[configure]().on('b').returns(s.m)
    bus.on('a').m(1)
    bus.on('b')(1)
    const view = bus.on(Arg.any())[received](3)
    void view.m // deferred (D9): m was only invoked
    const direct = failureOf(t, () => view(1))
    t.deepEqual(listedLines(direct).map(line => line.replace(/\s+called at.*$/, '')), ['› ✔ @Substitute.m(1)', '› ✔ @Substitute.m(1)'])
    const reports = clock.run().map(error => plain((error as Error).message))
    t.is(reports.length, 1)
    t.deepEqual(listedLines(reports[0]), ['› ✘ @Substitute.m(1)', '› ✘ @Substitute.m(1)'])
  } finally {
    clock.uninstall()
  }
})

// ---- E104 (R15-ADV-8): a function bound from a substitute of this copy is no substitute of another copy ----------------

test('R15-ADV-8 (E104) the finding: a configured answer made by .bind() on a substitute is a bound function, which a check through a call with matchers reports', t => {
  const api = Substitute.for<any>()
  const worker = Substitute.for<any>()
  const bound = worker.process.bind(worker)
  t.true(isSubstituteProxy(bound))
  api.handler(Arg.any()).returns(bound)
  api.handler('a')(1) // the code under test calls the bound function: worker.process(1)
  t.notThrows(() => worker[received](1).process(1))

  const message = expectUsageError(t, 'bound member', "Cannot check through @Substitute.handler(Arg.any{any}): the received call @Substitute.handler('a'), which it matches, ",
    (form, count) => api.handler(Arg.any())[form.key](...form.args(count))(1))
  t.true(message.includes('is configured with returns(@Substitute.process.bind(@Substitute)), a bound function, which is not a substitute: ' +
    'check the calls of the member it is bound from instead (for example sub.received(1).process(...))'), message)

  // a function substitute bound with arguments
  const app = Substitute.for<any>()
  const fn = Substitute.for<any>()
  app.handler(Arg.any()).returns(fn.bind(null, 'pre'))
  app.handler('a')(1)
  t.notThrows(() => fn[received](1)('pre', 1))
  const second = expectUsageError(t, 'bound function', "Cannot check through @Substitute.handler(Arg.any{any}): ",
    (form, count) => app.handler(Arg.any())[form.key](...form.args(count))(1))
  t.true(second.includes("is configured with returns(@Substitute.bind(null, 'pre')), a bound function, which is not a substitute: " +
    'check the calls of the member it is bound from instead (for example sub.received(1)(...))'), second)
})

test('R15-ADV-8 (E104) another copy\'s substitutes are still counted, and a bound function as the answer of a member read too', t => {
  const other = loadSecondCopy()
  const api = Substitute.for<any>()
  const job = other.Substitute.for<any>()
  api.handler(Arg.any()).returns(job)
  api.handler('a').run()
  t.notThrows(() => api.handler(Arg.any())[received](1).run())

  const app = Substitute.for<any>()
  const worker = Substitute.for<any>()
  app.session('s').handler.returns(worker.process.bind(worker))
  app.session('s').handler(1)
  t.true(errorOf(t, () => app.session(Arg.any()).handler[didNotReceive]()(1)).includes('a bound function, which is not a substitute'))
})

// ---- E106 (R15-ADV-2): a member step counts what its reads answered -----------------------------------------------------

test('R15-ADV-2 (E106) the finding: a member step whose reads answered a value that is not a substitute is a usage error in every form', async t => {
  const kinds: Array<{ name: string, setup: (api: any, user: any) => void, says: string }> = [
    { name: 'resolves(sub)', setup: (api, user) => api.session('s1').user.resolves(user), says: 'is configured with resolves(@Substitute), so it answered a promise, which is not a substitute' },
    { name: 'returns(plain)', setup: api => api.session('s1').user.returns({ save(): void { /* real */ } }), says: 'is configured with returns({ save: [Function: save] }), and that value is not a substitute' },
    { name: 'returns(promise)', setup: (api, user) => api.session('s1').user.returns(Promise.resolve(user)), says: 'is configured with returns(Promise {' },
    { name: 'mimicked plain value', setup: api => api.session('s1')[mimick]({ get user() { return { save(): void { /* real */ } } } }), says: 'is answered by the mimicked instance with a value that is not a substitute' }
  ]
  for (const kind of kinds) {
    const api = Substitute.for<any>()
    const user = Substitute.for<any>()
    kind.setup(api, user)
    const u = await api.session('s1').user // the code under test
    if (u !== undefined && typeof u.save === 'function') u.save()
    const message = expectUsageError(t, kind.name, "Cannot check through @Substitute.session(Arg.any{any}).user: the read of @Substitute.session('s1').user, which it goes through, ",
      (form, count) => api.session(Arg.any()).user[form.key](...form.args(count)).save())
    t.true(message.includes(kind.says), `${kind.name}: ${message}`)
  }

  // throws(): the read threw
  const api = Substitute.for<any>()
  api.session('s1').user.throws(new Error('no user'))
  t.throws(() => api.session('s1').user)
  t.true(errorOf(t, () => api.session(Arg.any()).user[didNotReceive]().save()).includes('is configured with throws([Error: no user]), so it threw instead of answering a substitute'))

  // a substitute answer counts, as before
  const app = Substitute.for<any>()
  const account = Substitute.for<any>()
  app.session('s1').user.returns(account)
  app.session('s1').user.save()
  expectCounts(t, 'returns(sub)', 1, (form, count) => app.session(Arg.any()).user[form.key](...form.args(count)).save())
})

test('R15-ADV-2 (E106) what the reads answered counts: reconfiguring the member after use changes nothing, and of a sequence only what was handed out counts', t => {
  const code = (api: any) => api.client('a').items.clear()
  {
    const api = Substitute.for<any>()
    const x1 = Substitute.for<any>()
    const x2 = Substitute.for<any>()
    api.client('a').items.returns(x1)
    code(api)                                        // x1.clear()
    api.client('a')[configure]().items.returns(x2)   // reconfigured afterwards, never read again
    expectCounts(t, 'reconfigured after use', 1, (form, count) => api.client(Arg.any()).items[form.key](...form.args(count)).clear())
    code(api)                                        // x2.clear()
    expectCounts(t, 'read again', 2, (form, count) => api.client(Arg.any()).items[form.key](...form.args(count)).clear())
  }
  {
    const api = Substitute.for<any>()
    const y1 = Substitute.for<any>()
    const y2 = Substitute.for<any>()
    api.client('a').items.returns(y1, y2)
    code(api)  // y1
    y2.clear() // elsewhere: y2 was never handed out by the member
    expectCounts(t, 'sequence', 1, (form, count) => api.client(Arg.any()).items[form.key](...form.args(count)).clear())
  }
  {
    // three steps down: each member step counts what its reads answered
    const api = Substitute.for<any>()
    api.session('s1').user.profile.returns({ update(): void { /* real */ } })
    api.session('s1').user.profile.update(1)
    t.true(errorOf(t, () => api.session(Arg.any()).user.profile[didNotReceive]().update(1))
      .startsWith("Cannot check through @Substitute.session(Arg.any{any}).user.profile: the read of @Substitute.session('s1').user.profile, which it goes through,"))
    const app = Substitute.for<any>()
    const profile = Substitute.for<any>()
    app.session('s1').user.profile.returns(profile)
    app.session('s1').user.profile.update(1)
    expectCounts(t, 'three steps', 1, (form, count) => app.session(Arg.any()).user.profile[form.key](...form.args(count)).update(1))
  }
})
