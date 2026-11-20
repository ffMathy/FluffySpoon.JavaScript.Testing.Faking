import test, { ExecutionContext } from 'ava'
import * as path from 'path'
import { spawnSync } from 'child_process'

import * as library from '../../../src'
import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { INTERNAL } from '../../../src/internals/Constants'
import { SubstituteState } from '../../../src/internals/SubstituteState'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 17, engine (checks through a call with matchers, and through a concrete call that a setup with matchers
// answered): the round-16 findings R16V-2 with the docs agent's E99 retention, R16-ADV-5, R16-ADV-7, R16V-3 (=
// R16-ADV-3) and R16V-4, decided in the fix spec as E110, E111, E113 and E119.

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

/**
 * The six forms of a check. A check through a concrete call is one expression with that call (D25), so the tests write it
 * in one function: `io.to('room-b')[form.key](...form.args(count)).emit(...)`.
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

/** Every check form with the counts 0, 1 and 2 through `check`, each expected to pass exactly when the form passes for `actual` calls. */
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

/** The state of a root substitute (library internals, for what the public API does not show). */
const stateOf = (substitute: unknown): SubstituteState => (substitute as any)[INTERNAL] as SubstituteState

/** Runs a script with the library in a child process with --expose-gc, and returns what it prints as JSON. */
const measure = (script: string): any => {
  const entry = path.resolve(__dirname, '../../../src/index.js')
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', `
    const { Substitute, Arg } = require(${JSON.stringify(entry)})
    const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed }
    ${script}
  `], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

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

// ---- E110 (R16V-2, the docs agent's E99 retention): E99's notes cost nothing per check, per call or in memory ---------

test('R16V-2 (E110) the finding: checks through a concrete call on a shared substitute leave nothing behind, so each costs the same as the first', t => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  for (let index = 0; index < 100; index++) io.to('a').emit('m', index) // the code under test
  const answers = () => stateOf(io).configuredAnswers('to')!.size
  t.is(answers(), 100)
  for (let check = 0; check < 1000; check++) io.to('a').received(100).emit('m', Arg.any())
  // the leading call of each check is gone from what later checks go through (it grew by one per check)
  t.is(answers(), 100)
  t.is(stateOf(io).recordsFor('to').length, 100)
  // and the checks still count what came through the call
  t.notThrows(() => io.to('a')[received](100).emit('m', Arg.any()))
  t.true(failureOf(t, () => io.to('b').received(1).emit('m', Arg.any())).includes('but received none.'))
  t.notThrows(() => io.received(100).to('a'))
  t.notThrows(() => io.to(Arg.any()).received(100).emit(Arg.all()))
})

test('R16V-2 (E110) a check keeps less memory than at cd1bf29 (2.7 KB), and the same holds with a deeper route and a reused view', t => {
  const { shared, deep } = measure(`
    const perCheck = (run) => {
      const before = heap()
      for (let index = 0; index < 2000; index++) run()
      return Math.round((heap() - before) / 2000)
    }
    const io = Substitute.for()
    io.to(Arg.any()).emit(Arg.all()).returns(true)
    for (let index = 0; index < 100; index++) io.to('a').emit('m', index)
    const shared = perCheck(() => io.to('a').received(100).emit('m', Arg.any()))
    const db = Substitute.for()
    db(Arg.any()).where(Arg.all()).first().resolves({ id: 1 })
    for (let index = 0; index < 50; index++) db('users').where('id', 1).first()
    const deep = perCheck(() => db('users').where('id', 1).received(50).first())
    console.log(JSON.stringify({ shared, deep }))
  `)
  t.log(`bytes retained per check: ${shared} (a shared substitute), ${deep} (two steps)`)
  // 8be3a70: 7,047 bytes per check, cd1bf29: 2,684 (it counted wrongly)
  t.true(shared < 2700, `${shared} bytes per check`)
  t.true(deep < 2700, `${deep} bytes per check`)
})

test('the docs agent\'s E99 retention (E110): dropping the substitutes frees them, also after many rounds; a shared answer costs no more per call than any other', t => {
  const { dropped, rounds, shared, unshared } = measure(`
    const base = heap()
    const round = () => {
      const factory = Substitute.for()
      const product = Substitute.for()
      factory.create(Arg.any()).returns(product)
      for (let index = 0; index < 50000; index++) factory.create(index)
    }
    round()
    const dropped = (heap() - base) / 1048576
    for (let index = 0; index < 10; index++) round()
    const rounds = (heap() - base) / 1048576
    const perCall = kind => {
      const before = heap()
      const factory = Substitute.for()
      const product = Substitute.for()
      factory.create(Arg.any()).returns(kind === 'shared' ? product : 1)
      for (let index = 0; index < 50000; index++) factory.create(index)
      const bytes = (heap() - before) / 50000
      if (factory.create(1) === null) console.log('keeps the substitutes alive until here')
      return Math.round(bytes)
    }
    console.log(JSON.stringify({ dropped, rounds, unshared: perCall('plain'), shared: perCall('shared') }))
  `)
  t.log(`retained after dropping: ${dropped.toFixed(2)} MB, after 11 rounds: ${rounds.toFixed(2)} MB; bytes per call: ${shared} shared, ${unshared} not`)
  // 8be3a70: 16.8 MB until some other call got a configured answer, and 8.7 MB after 10 rounds; cd1bf29: 0.26 and 0.36 MB
  t.true(dropped < 2, `${dropped} MB`)
  t.true(rounds < 2, `${rounds} MB`)
  // 8be3a70: 42 bytes more per call answered by a shared substitute
  t.true(shared - unshared < 20, `${shared} against ${unshared} bytes per call`)
})

test('R16V-2 (E110) a dropped check expression keeps the runs of answers of the code\'s calls, interleaved with checks', t => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  for (let index = 0; index < 5; index++) {
    io.to('a').emit('m', index) // the code under test
    io.to('a').received(index + 1).emit('m', Arg.any())
    io.to('b')[didNotReceive]().emit(Arg.all())
  }
  t.is(stateOf(io).recordsFor('to').length, 5)
  t.is(stateOf(io).configuredAnswers('to')!.size, 5)
  t.notThrows(() => io.received(5).to('a'))
  t.notThrows(() => io.didNotReceive().to('b'))
  t.notThrows(() => io.to('a').received(5).emit('m', Arg.any()))
  t.notThrows(() => io.to(Arg.any()).received(5).emit('m', Arg.any()))
  // the labels of the shared substitute's calls still name the concrete call
  t.true(String(io).includes("to('a').emit('m', 4)"), String(io))
})

// ---- E111 (R16-ADV-5): a concrete call made through call/apply in the check expression -----------------------------------

test('R16-ADV-5 (E111) the finding: a check through rpc.call(\'getUser\', 2) counts nothing that came through call(\'getUser\', 1)', t => {
  const rpc = Substitute.for<any>()
  const user = Substitute.for<any>()
  rpc.call('getUser', Arg.any()).returns(user) // a setup with matchers that shares user
  rpc.call('getUser', 1).save() // the code under test
  expectCounts(t, "call('getUser', 2)", 0, (form, count) => rpc.call('getUser', 2)[form.key](...form.args(count)).save())
  expectCounts(t, "call('getUser', 1)", 1, (form, count) => rpc.call('getUser', 1)[form.key](...form.args(count)).save())
  t.true(failureOf(t, () => rpc.call('getUser', 2).received(1).save()).includes('but received none.'))
  // the test's own calls are not recorded
  t.notThrows(() => rpc.received(1).call('getUser', 1))
  t.notThrows(() => rpc.didNotReceive().call('getUser', 2))
  // when the substitute was returned to other calls too, it is E99's usage error
  rpc.call('getUser', 2).name // the code under test again
  t.true(errorOf(t, () => rpc.call('getUser', 2).received(1).save()).startsWith("Cannot check through @Substitute.call('getUser', 2): "))
})

test('R16-ADV-5 (E111) a nested setup through call(), redis-style calls and fn.call/apply in the check narrow the same way', t => {
  const rpc = Substitute.for<any>()
  rpc.call('getUser', Arg.any()).name.returns('x') // a shared auto-substitute
  rpc.call('getUser', 1).save()
  expectCounts(t, "nested call('getUser', 2)", 0, (form, count) => rpc.call('getUser', 2)[form.key](...form.args(count)).save())
  expectCounts(t, "nested call('getUser', 1)", 1, (form, count) => rpc.call('getUser', 1)[form.key](...form.args(count)).save())

  const redis = Substitute.for<any>()
  redis.call('get', Arg.any()).length.returns(3)
  redis.call('get', 'a').toUpperCase()
  expectCounts(t, "redis.call('get', 'b')", 0, (form, count) => redis.call('get', 'b')[form.key](...form.args(count)).toUpperCase())
  expectCounts(t, "redis.call('get', 'a')", 1, (form, count) => redis.call('get', 'a')[form.key](...form.args(count)).toUpperCase())

  const io = Substitute.for<any>()
  io.to(Arg.any()).emit(Arg.all()).returns(true)
  io.to('room-a').emit('m')
  expectCounts(t, "io.to.call(io, 'room-b')", 0, (form, count) => io.to.call(io, 'room-b')[form.key](...form.args(count)).emit('m'))
  expectCounts(t, "io.to.apply(io, ['room-b'])", 0, (form, count) => io.to.apply(io, ['room-b'])[form.key](...form.args(count)).emit('m'))
  expectCounts(t, "io.to.call(io, 'room-a')", 1, (form, count) => io.to.call(io, 'room-a')[form.key](...form.args(count)).emit('m'))
  expectCounts(t, "io.to.bind(io)('room-b')", 0, (form, count) => io.to.bind(io)('room-b')[form.key](...form.args(count)).emit('m'))
  // two steps down
  const api = Substitute.for<any>()
  api.client(Arg.any()).items.list().returns([])
  api.client.call(api, 'a').items.clear()
  expectCounts(t, "api.client.call(api, 'b').items", 0, (form, count) => api.client.call(api, 'b').items[form.key](...form.args(count)).clear())
  expectCounts(t, "api.client.apply(api, ['a']).items", 1, (form, count) => api.client.apply(api, ['a']).items[form.key](...form.args(count)).clear())
})

test('R16-ADV-5 (E111) a substitute that call/apply answers is handed out, so a setup or check in the same expression leaves the call out', t => {
  const api = Substitute.for<any>()
  const user = Substitute.for<any>()
  api.getUser(1).returns(user) // a literal setup: not shared
  api.getUser.call(api, 1).name.returns('ann') // a setup through the answer of a call made with call()
  t.is(user.name, 'ann')
  t.notThrows(() => api.didNotReceive().getUser(1))
  api.getUser.apply(api, [1]).save() // the code under test
  t.notThrows(() => api.getUser.call(api, 1)[received](1).save())
  t.notThrows(() => api.received(1).getUser(1))
  t.notThrows(() => user.received(1).save())
})

// ---- E111 (R16-ADV-7): the shared answer is the substitute that was called -----------------------------------------------

test('R16-ADV-7 (E111) the finding: io.to(Arg.any()).returns(io), a mimicked return this and E108\'s fluent remedy narrow a check through a concrete call', t => {
  const kinds: Array<[string, (io: any) => void]> = [
    ['returns(io)', io => io.to(Arg.any()).returns(io)],
    ['a mimicked return this', io => io[mimick]({ to() { return this }, emit() { return true } })]
  ]
  for (const [name, arrange] of kinds) {
    const io = Substitute.for<any>()
    arrange(io)
    t.is(io.to('room-a'), io, name)
    io.to('room-a').emit('m') // the code under test: room-a only
    expectCounts(t, `${name}: to('room-b')`, 0, (form, count) => io.to('room-b')[form.key](...form.args(count)).emit('m'))
    expectCounts(t, `${name}: to('room-a')`, 1, (form, count) => io.to('room-a')[form.key](...form.args(count)).emit('m'))
    t.true(failureOf(t, () => io.to('room-b').received(1).emit('m')).includes('but received none.'), name)
    // the leading calls of the checks are not recorded, those of the code under test are
    t.notThrows(() => io.received(2).to('room-a'), name)
    t.notThrows(() => io.didNotReceive().to('room-b'), name)
  }

  // E108's own remedy for a fluent API
  const reply = Substitute.for<any>()
  reply.code(Arg.all()).returns(reply)
  reply.code(404).send({ e: 1 }) // the code under test
  expectCounts(t, 'reply.code(500)', 0, (form, count) => reply.code(500)[form.key](...form.args(count)).send({ e: 1 }))
  expectCounts(t, 'reply.code(404)', 1, (form, count) => reply.code(404)[form.key](...form.args(count)).send({ e: 1 }))
  // returned to code(404) and to code(500): which call it came through cannot be told
  reply.code(500).header('x')
  t.true(errorOf(t, () => reply.code(404).received(1).send({ e: 1 })).startsWith('Cannot check through @Substitute.code(404): '))
  t.notThrows(() => reply.received(1).send({ e: 1 }))
})

test('R16-ADV-7 (E111) further down a call that answered the substitute itself, and checks one after the other in one function', t => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).returns(io)
  io.to('room-a').in('x').emit('m') // the code under test
  expectCounts(t, "to('room-b').in('x')", 0, (form, count) => io.to('room-b').in('x')[form.key](...form.args(count)).emit('m'))
  expectCounts(t, "to('room-a').in('x')", 1, (form, count) => io.to('room-a').in('x')[form.key](...form.args(count)).emit('m'))

  // a check view uses its hand-out up: the next check, in the same function, starts afresh
  const bus = Substitute.for<any>()
  bus.on(Arg.is((event: string) => event === 'b'), Arg.any()).returns(bus)
  bus.on('a', 1)() // the code under test: an unconfigured call, then a call of what it answered
  const view = bus.on('b', 2)[didNotReceive]()
  view()
  t.notThrows(() => bus.on('a', 1)[received](1)())
  t.notThrows(() => bus.on('a', 1)[received](1)())
})

test('R16-ADV-7 (E111) E39 stays for a setup without matchers that returns the substitute itself, and a check in another function', t => {
  const map = Substitute.for<any>()
  map.set('b', 2).returns(map) // a setup of that call only: nothing is shared
  t.is(map.set('b', 2), map)
  t.notThrows(() => map.received(1).set('b', 2))

  const shared = Substitute.for<any>()
  shared.set(Arg.all()).returns(shared)
  t.is(shared.set('b', 2), shared)
  t.notThrows(() => shared.received(1).set('b', 2))
})

test('R16-ADV-7 (E111) a call that answered the substitute itself continues its expression on its own line only, so the next statement starts afresh', t => {
  // the docs' fluent map: the test's own call, then a check in the same function on the next line (nothing is left out)
  const map = Substitute.for<any>()
  map.set(Arg.all()).returns(map)
  const answered = map.set('b', 2)
  map.received(1).set('b', 2)
  t.is(answered, map)

  // the docs' http.Server: the code under test chains on() on one line, and the checks follow in the same function
  const server = Substitute.for<any>()
  const listeners: { [event: string]: (...args: any[]) => void } = {}
  server.on(Arg.all()).mimicks((event: string, listener: (...args: any[]) => void) => {
    listeners[event] = listener
    return server
  })
  const failures: string[] = []
  server.on('error', (error: Error) => failures.push(error.message)).on('close', () => { })
  listeners.error(new Error('EADDRINUSE'))
  server.received(1).on('error', Arg.any())
  server.received(2).on(Arg.any('string'), Arg.any())
  server.received(1).on('close', Arg.any())
  t.deepEqual(failures, ['EADDRINUSE'])

  // on the call's own line, the check continues it: io.to('room-b') answered io, and emit() came through to('room-a')
  const io = Substitute.for<any>()
  io.to(Arg.any()).returns(io)
  io.to('room-a').emit('m') // the code under test
  const roomB = passes(() => io.to('room-b').received(1).emit('m'))
  io.received(1).to('room-a') // the check's leading call is not recorded
  io.didNotReceive().to('room-b')
  t.false(roomB)
})

// ---- E113 (R16V-3 = R16-ADV-3): a function bound from a substitute of another copy -----------------------------------------

test('R16V-3 (E113) the finding: a function bound from another copy\'s substitute, as the answer of a call with matchers, is a usage error in every form', t => {
  const other = loadSecondCopy()
  const api = Substitute.for<any>()
  const worker = other.Substitute.for<any>()
  api.handler(Arg.any()).returns(worker.process.bind(worker))
  api.handler('a')(1) // the code under test calls the bound function: worker.process(1)
  t.notThrows(() => worker[other.received](1).process(1))

  const message = expectUsageError(t, 'bound in another copy', "Cannot check through @Substitute.handler(Arg.any{any}): the received call @Substitute.handler('a'), which it matches, ",
    (form, count) => api.handler(Arg.any())[form.key](...form.args(count))(1))
  t.true(message.includes('is configured with returns(@Substitute.process.bind(@Substitute)), a bound function, which is not a substitute. '), message)

  // another copy's substitute itself is still counted, and the same bound function of this copy is still E104's error
  const job = other.Substitute.for<any>()
  const app = Substitute.for<any>()
  app.handler(Arg.any()).returns(job)
  app.handler('a').run()
  t.notThrows(() => app.handler(Arg.any())[received](1).run())
  const own = Substitute.for<any>()
  const local = Substitute.for<any>()
  own.handler(Arg.any()).returns(local.process.bind(local))
  own.handler('a')(1)
  t.true(errorOf(t, () => own.handler(Arg.any())[didNotReceive]()(1)).includes('Check the calls of the member it is bound from instead (for example sub.received(1).process(...))'))
})

test('R16V-3 (E113) the copies share where bound functions are noted, and a bound function of either copy is no other copy\'s substitute', t => {
  const other = loadSecondCopy()
  const guard = (globalThis as any)[Symbol.for('@fluffy-spoon/substitute:guard')]
  t.true(guard.boundFunctions instanceof WeakSet)
  const ours = Substitute.for<any>()
  const theirs = other.Substitute.for<any>()
  const boundOurs = ours.run.bind(ours)
  const boundTheirs = theirs.run.bind(theirs)
  t.true(guard.boundFunctions.has(boundOurs))
  t.true(guard.boundFunctions.has(boundTheirs))
  t.false(guard.boundFunctions.has(ours))
  t.false(guard.boundFunctions.has(theirs))
  // a member read below a call with matchers that answered another copy's bound function
  const app = Substitute.for<any>()
  app.session('s').handler.returns(boundTheirs)
  app.session('s').handler(1)
  t.true(errorOf(t, () => app.session(Arg.any()).handler[didNotReceive]()(1)).includes('a bound function, which is not a substitute'))
})

// ---- E119 (R16V-4): a mimicked getter that throws ---------------------------------------------------------------------------

test('R16V-4 (E119) the finding: a read below a call with matchers that a mimicked getter answered by throwing is E88\'s usage error in every form', t => {
  const api = Substitute.for<any>()
  const failure = new Error('g')
  api.session('s1')[mimick]({ get user() { throw failure } })
  const thrown = (() => { try { api.session('s1').user } catch (error) { return error } })() // the code under test: the read threw
  t.is(thrown, failure)

  const message = expectUsageError(t, 'throwing getter', "Cannot check through @Substitute.session(Arg.any{any}).user: the read of @Substitute.session('s1').user, which it goes through, ",
    (form, count) => api.session(Arg.any()).user[form.key](...form.args(count)).save())
  t.true(message.includes('threw an error instead of answering a substitute.'), message)
  // the read was made, and is recorded like a read that a throws() setup answered
  t.notThrows(() => api.session('s1').received(1).user)
})

test('R16V-4 (E119) a getter that answers is unchanged, and so are throwing mimicked methods and throws() setups', t => {
  const api = Substitute.for<any>()
  const user = Substitute.for<any>()
  let reads = 0
  api.session('s1')[mimick]({ get user() { reads++; return user } })
  api.session('s1').user.save()
  t.is(reads, 1)
  expectCounts(t, 'getter answering a substitute', 1, (form, count) => api.session(Arg.any()).user[form.key](...form.args(count)).save())
  t.is(reads, 1)

  const service = Substitute.for<any>()
  service.session('s1')[mimick]({ user() { throw new Error('m') } })
  t.throws(() => service.session('s1').user(), { message: 'm' })
  t.true(errorOf(t, () => service.session(Arg.any()).user()[didNotReceive]().save()).includes('threw an error instead of answering a substitute'))

  const configured = Substitute.for<any>()
  configured.session('s1').user.throws(new Error('x'))
  t.throws(() => configured.session('s1').user, { message: 'x' })
  t.true(errorOf(t, () => configured.session(Arg.any()).user[received](1).save()).includes('is configured with throws([Error: x])'))
})
