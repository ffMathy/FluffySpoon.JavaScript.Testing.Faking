import test, { ExecutionContext } from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 16: the calls-and-arguments part of the round-15 findings (R15-ADV-4 with the docs agent's E95 cost, R15V-1,
// R15V-2, R15V-3 with the docs agent's E88 gap), decided in the fix spec as E100, E101, E102 and E103.

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

const library = path.resolve(__dirname, '../../../src/index.js')

/** Runs a script with the library in a child process: what it prints (as JSON when `json`), and its exit code and stderr. */
const runScript = (script: string): { stdout: string, stderr: string, status: number | null } => {
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

/** Calls the code under test makes through wrappers (a retry helper, a spy): fn.apply(this, args), fn.call(undefined, ...). */
const withRetry = (fn: Function): any => function (this: unknown, ...args: unknown[]): unknown {
  return fn.apply(this, args)
}
const callWith = (fn: Function): any => (...args: unknown[]) => fn.call(undefined, ...args)

// ---- E100 (R15-ADV-4): only a matcher's look at the values being matched leaves no trace --------------------------

/** jest's and vitest's asymmetric matchers, as E75 recognises them (the shape, without jest). */
const asymmetric = (test: (value: any) => unknown): object => ({ $$typeof: Symbol.for('jest.asymmetricMatcher'), asymmetricMatch: test })
/** sinon's matchers, as E75 recognises them (the shape, without sinon): an object that is not plain, with test and message. */
class SinonLikeMatcher {
  constructor(public test: (value: any) => unknown, public message = 'match(fn)') { }
  and(): void { }
  or(): void { }
}

/** Loads a second, independent copy of the library (a duplicate install), as duplicate-copies.test.ts does. */
const loadSecondCopy = (): typeof import('../../../src') => {
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

test('R15-ADV-4 (E100) calls that the code under test makes from a callback that a predicate invokes are recorded and use up sequence values', t => {
  const db = Substitute.for<any>()
  const logger = Substitute.for<any>()
  const ids = Substitute.for<any>()
  ids.next().returns(1, 2, 3)
  // driving a callback API by invoking the callback in a predicate
  db.query(Arg.any(), Arg.is((callback: Function) => { callback(null, [{ id: 7 }]); return true })).returns(undefined)
  const seen: unknown[] = []
  const load = (sql: string) => db.query(sql, (_error: unknown, rows: unknown[]) => {
    seen.push(ids.next())
    logger.info('rows', rows.length)
  })
  load('a') // the code under test
  load('b')
  // cd1bf29: [1, 1], and both checks failed with "received none" (as if the code under test had made none of the calls)
  t.deepEqual(seen, [1, 2])
  t.notThrows(() => logger[received](2).info('rows', 1))
  t.notThrows(() => ids[received](2).next())
  t.notThrows(() => db.received(1).query('a', Arg.any()))

  // in a check, the callback runs again, and nothing it does is recorded or used up there
  t.notThrows(() => db.received(2).query(Arg.any(), Arg.is((callback: Function) => { callback(null, []); return true })))
  t.deepEqual(seen, [1, 2, 3, 3], 'the check\'s callback runs saw the next value without using it up')
  t.notThrows(() => logger[received](2).info(Arg.all()))
  t.notThrows(() => ids[received](2).next())
  t.is(ids.next(), 3)

  // the documented way to drive callbacks, mimicks(), as before
  const db2 = Substitute.for<any>()
  const logger2 = Substitute.for<any>()
  db2.query(Arg.any(), Arg.any()).mimicks((_sql: string, callback: Function) => callback(null, [{ id: 7 }]))
  db2.query('a', (_error: unknown, rows: unknown[]) => logger2.info('rows', rows.length))
  t.notThrows(() => logger2[received](1).info('rows', 1))
})

test('R15-ADV-4 (E100) a predicate runs at every comparison: a callback it invokes runs once per setup the call is compared with', t => {
  const emitter = Substitute.for<any>()
  const audit = Substitute.for<any>()
  // compared with the most recent setup first: it does not match, so the older one is compared too
  emitter.on('data', Arg.is((listener: Function) => { listener('first'); return true })).returns('older')
  emitter.on('data', Arg.is((listener: Function) => { listener('second'); return false })).returns('newer')
  t.is(emitter.on('data', (chunk: string) => audit.write(chunk)), 'older')
  t.notThrows(() => audit.received(1).write('second'))
  t.notThrows(() => audit.received(1).write('first'))
  t.notThrows(() => audit.received(2).write(Arg.all()))
})

test('R15-ADV-4 (E100) the predicate\'s own look at substitute arguments, and at what they answer, leaves no trace', t => {
  const repo = Substitute.for<any>()
  const user = Substitute.for<any>()
  const address = Substitute.for<any>()
  user.name.returns('ann', 'bob')
  user.address.returns(address)
  address.city.returns('Oslo', 'Rome')
  user.load().returns(address)
  repo.save(Arg.is(u => u.name === 'ann' && u.address.city === 'Oslo' && u.load().city === 'Oslo' &&
    u.profile.tags.first() !== undefined && u.settings.get.call(u.settings, 'x') !== undefined)).returns('saved')
  t.is(repo.save(user), 'saved') // the code under test
  t.is(repo.save(user), 'saved', 'the predicate saw the same values again')
  t.notThrows(() => repo.received(2).save(user))
  for (const check of [() => user.didNotReceive().name, () => user.didNotReceive().address, () => user.didNotReceive().load(),
    () => user.didNotReceive().profile, () => user.profile.didNotReceive().tags, () => user.didNotReceive().settings,
    () => address.didNotReceive().city]) t.notThrows(check)
  t.is(user.name, 'ann', 'the first real read gets the first value')
  t.is(address.city, 'Oslo')

  // substitutes inside the argument: in plain objects, arrays, Maps, Sets and class instances, and a prototype
  class Box { constructor(public item: unknown) { } }
  const base = Substitute.for<any>()
  class Derived extends base.Base { }
  const store = Substitute.for<any>()
  const item = Substitute.for<any>()
  item.id.returns(1, 2)
  store.put(Arg.is(v => v.list[0].id === 1 && v.map.get('k').id === 1 && [...v.set][0].id === 1 &&
    v.box.item.id === 1 && v.nested.deeper.item.id === 1)).returns('stored')
  t.is(store.put({ list: [item], map: new Map([['k', item]]), set: new Set([item]), box: new Box(item), nested: { deeper: { item } } }), 'stored')
  store.keep({ owner: Arg.is((owner: any) => owner.id === 1) }).returns('kept')
  t.is(store.keep({ owner: item }), 'kept')
  store.derive(Arg.is(value => value.tag === undefined || true)).returns('derived')
  t.is(store.derive(new Derived()), 'derived')
  t.notThrows(() => item.didNotReceive().id)
  t.notThrows(() => base.Base.prototype.didNotReceive().tag)
  t.is(item.id, 1)

  // assignments the predicate makes on a looked substitute are not made (as in checks, E95)
  const target = Substitute.for<any>()
  const instance = { count: 1 }
  target[mimick](instance)
  store.touch(Arg.is(v => { v.count = 9; return true })).returns('touched')
  t.is(store.touch(target), 'touched')
  t.is(instance.count, 1)
  t.notThrows(() => target.didNotReceive().count = Arg.any())
})

test('R15-ADV-4 (E100) a substitute that is not among the values being matched is recorded when a predicate reads it, as at d417925', t => {
  const repo = Substitute.for<any>()
  const config = Substitute.for<any>()
  config.limit.returns(5, 6)
  repo.find(Arg.is(n => n < config.limit)).returns('found')
  t.is(repo.find(3), 'found') // the code under test
  t.notThrows(() => config.received(1).limit)
  t.is(config.limit, 6, 'the predicate\'s read used up the first value')
  // in a check, nothing at all is recorded (the look of a check, E95)
  t.notThrows(() => repo.received(1).find(Arg.is(n => n < config.limit)))
  t.notThrows(() => config.received(2).limit)
})

test('R15-ADV-4 (E100) matchers of test runners and sinon: their look at the arguments leaves no trace, a callback they invoke is recorded', t => {
  const user = Substitute.for<any>()
  user.id.returns('u1', 'u2')
  const audit = Substitute.for<any>()
  const api = Substitute.for<any>()
  api.send(asymmetric(u => u.id === 'u1')).returns('runner')
  api.post(new SinonLikeMatcher(u => u.id === 'u1')).returns('sinon')
  // an Arg matcher inside a runner matcher (E96): the runner's equality asks it, in the same look
  api.put({ user: asymmetric(value => Arg.is((u: any) => u.id === 'u1').asymmetricMatch(value)) } as any).returns('nested')
  t.is(api.send(user), 'runner')
  t.is(api.post(user), 'sinon')
  t.is(api.put({ user }), 'nested')
  t.notThrows(() => user.didNotReceive().id)
  t.is(user.id, 'u1')

  api.subscribe(asymmetric((listener: Function) => { listener('event'); return true })).returns('subscribed')
  api.listen(new SinonLikeMatcher((listener: Function) => { listener('event'); return true })).returns('listening')
  t.is(api.subscribe((event: string) => audit.log(event)), 'subscribed')
  t.is(api.listen((event: string) => audit.log(event)), 'listening')
  t.notThrows(() => audit.received(2).log('event'))
})

test('R15-ADV-4 (E100) re-entrancy: a real call made from a predicate\'s callback is matched in a look of its own, and the outer look applies again after it', t => {
  const service = Substitute.for<any>()
  const repo = Substitute.for<any>()
  const user = Substitute.for<any>()
  const order = Substitute.for<any>()
  const metrics = Substitute.for<any>()
  user.name.returns('ann')
  order.total.returns(10, 20)
  repo.save(Arg.is(o => o.total === 10)).returns('saved')
  service.run(user, Arg.is((callback: Function) => { callback(); return true })).returns('ran')
  const result = service.run(user, () => {
    // the code under test, inside the callback: a real call matched against setups with a predicate of their own
    if (repo.save(order) !== 'saved') throw new Error('not answered')
    metrics.count()
    void user.name // a substitute the outer look looks at: not recorded, as the predicate's own reads are not
  })
  t.is(result, 'ran')
  t.notThrows(() => repo.received(1).save(order))
  t.notThrows(() => metrics.received(1).count())
  t.notThrows(() => order.didNotReceive().total)
  t.is(order.total, 10)
  t.notThrows(() => user.didNotReceive().name)

  // a predicate whose callback calls the same member again (recursion through the same setups)
  const tree = Substitute.for<any>()
  const visits: number[] = []
  tree.visit(Arg.is((node: { depth: number, next: Function }) => { node.next(); return true })).returns('visited')
  const visit = (depth: number): unknown => tree.visit({ depth, next: () => { visits.push(depth); if (depth < 3) visit(depth + 1) } })
  t.is(visit(1), 'visited')
  t.deepEqual(visits, [1, 2, 3])
  t.notThrows(() => tree.received(3).visit(Arg.any()))
})

test('R15-ADV-4 (E100) two copies of the library: a substitute of the other copy among the arguments is looked at, one outside them is recorded', t => {
  const copyB = loadSecondCopy()
  const user = copyB.Substitute.for<any>()
  user.name.returns('ann', 'bob')
  const audit = copyB.Substitute.for<any>()
  const repo = Substitute.for<any>()
  repo.save(Arg.is(u => u.name === 'ann'), Arg.is((callback: Function) => { callback(); return true })).returns('saved')
  t.is(repo.save(user, () => audit.log('saved')), 'saved')
  t.notThrows(() => user[copyB.didNotReceive]().name)
  t.is(user.name, 'ann')
  t.notThrows(() => audit[copyB.received](1).log('saved'))
  // and the other way around: a substitute of this copy in a call on the other copy's substitute
  const own = Substitute.for<any>()
  own.id.returns(1, 2)
  const otherRepo = copyB.Substitute.for<any>()
  otherRepo.save(copyB.Arg.is((value: any) => value.id === 1)).returns('saved by B')
  t.is(otherRepo.save(own), 'saved by B')
  t.notThrows(() => own.didNotReceive().id)
  t.is(own.id, 1)
})

// ---- E101 (R15V-1): a throwing answer is noted without catching it ------------------------------------------------

test('R15V-1 (E101) a debugger that pauses on caught exceptions stops once per throwing call, where it was thrown', t => {
  const result = runScript(`
    const inspector = require('inspector')
    const session = new inspector.Session()
    session.connect()
    const pauses = []
    session.on('Debugger.paused', ({ params }) => {
      const top = params.callFrames[0]
      pauses.push(top.functionName)
      session.post('Debugger.resume')
    })
    session.post('Debugger.enable')
    const { Substitute, Arg, mimick } = require(${JSON.stringify(library)})
    const cases = {
      'throws()': [s => s.load(1).throws(new Error('x')), s => s.load(1)],
      'throws() with a matcher': [s => s.load(Arg.any()).throws(new Error('x')), s => s.load(1)],
      'a throwing mimicks()': [s => s.load(1).mimicks(function ownThrow() { throw new Error('x') }), s => s.load(1)],
      'a throwing mimicked method': [s => s[mimick]({ load: function ownThrow() { throw new Error('x') } }), s => s.load(1)],
      'a bound method answered by throws()': [s => s.load(1).throws(new Error('x')), s => s.load.bind(s)(1)],
      'new answered by throws()': [s => s.Client(1).throws(new Error('x')), s => new s.Client(1)],
      // E103: the same through call/apply
      'throws() through apply': [s => s.load(1).throws(new Error('x')), s => s.load.apply(undefined, [1])],
      'throws() through call': [s => s.load(Arg.any()).throws(new Error('x')), s => s.load.call(null, 1)],
      'a throwing mimicks() through apply': [s => s.load(1).mimicks(function ownThrow() { throw new Error('x') }), s => s.load.apply(s, [1])],
      'a throwing mimicked method through apply': [s => s[mimick]({ load: function ownThrow() { throw new Error('x') } }), s => s.load.apply(s, [1])],
      'a function substitute through call': [s => s(Arg.any()).throws(new Error('x')), s => s.call(null, 1)],
      'a member call() of its own': [s => s.rpc.call('get', 1).throws(new Error('x')), s => s.rpc.call('get', 1)]
    }
    const outcome = {}
    for (const [name, [arrange, act]] of Object.entries(cases)) {
      const s = Substitute.for()
      arrange(s)
      session.post('Debugger.setPauseOnExceptions', { state: 'all' })
      const before = pauses.length
      try { act(s) } catch { }
      session.post('Debugger.setPauseOnExceptions', { state: 'none' })
      outcome[name] = pauses.slice(before)
    }
    console.log(JSON.stringify(outcome))
  `)
  t.is(result.status, 0, result.stderr)
  const outcome: Record<string, string[]> = JSON.parse(result.stdout)
  for (const [name, pauses] of Object.entries(outcome)) {
    // cd1bf29: two pauses, the second one in resolveCall (`catch (thrown) { ...; throw thrown }`)
    t.is(pauses.length, 1, `${name}: ${pauses.join(' | ')}`)
    const where = pauses[0] ?? ''
    // the throw of the code under test, or the configured throw (the library's execute)
    t.is(where, name.includes('mimick') ? 'ownThrow' : 'execute', name)
  }
})

test('R15V-1 (E101) an uncaught error of a throwing mimicks() points at the throw of the code under test, not into the library', t => {
  for (const act of ['s.load(1)', 's.load.apply(undefined, [1])', 'new s.load(1)']) {
    const result = runScript(`
      const { Substitute } = require(${JSON.stringify(library)})
      const s = Substitute.for()
      s.load(1).mimicks(() => { throw new Error('from mimicks') })
      ${act}
    `)
    t.not(result.status, 0)
    const [where, line] = result.stderr.split('\n')
    // cd1bf29: ".../internals/Engine.js:1411" and "throw thrown;"
    t.is(where, '[eval]:4', `${act}: ${result.stderr}`)
    t.true(line.includes("throw new Error('from mimicks')"), `${act}: ${result.stderr}`)
  }
})

test('R15V-1 (E101) a throwing call is still noted for checks through a call with matchers (E88), and nothing else changes', t => {
  const api = Substitute.for<any>()
  api.load(Arg.any()).throws(new Error('boom'))
  t.throws(() => api.load(1), { message: 'boom' }) // the code under test
  t.throws(() => api.load(2), { message: 'boom' })
  t.notThrows(() => api.received(2).load(Arg.any()))
  t.true(failureOf(t, () => api.load(Arg.any())[didNotReceive]().save())
    .includes('the received call @Substitute.load(1), which it matches, is configured with throws([Error: boom]), so it threw instead of answering a substitute.'))
  const service = Substitute.for<any>()
  service.run(Arg.any()).mimicks(() => { throw new TypeError('bad') })
  t.throws(() => service.run(1), { instanceOf: TypeError, message: 'bad' })
  t.true(failureOf(t, () => service.run(Arg.any()).didNotReceive().stop())
    .includes('the received call @Substitute.run(1), which it matches, threw an error instead of answering a substitute.'))
})

// ---- E102 (R15V-2): a throwing getter is read at most once per comparison -------------------------------------------

test('R15V-2 (E102) a throwing getter of an argument is read once per comparison with a setup or a check that holds nested matchers', t => {
  let reads = 0
  const lazy = () => Object.defineProperty({}, 'name', { enumerable: true, get() { reads++; throw new Error('not loaded') } })
  const count = (act: () => void): number => {
    reads = 0
    act()
    return reads
  }
  // (as at d417925; cd1bf29 read it twice per comparison: 10, 4, 21 and 3)
  const checked = Substitute.for<any>()
  for (let index = 0; index < 5; index++) checked.save(lazy())
  t.is(count(() => checked.didNotReceive().save({ name: Arg.any() })), 5)
  t.is(count(() => { try { checked.received(5).save({ name: Arg.any() }) } catch { /* fails: they cannot be read */ } }), 5)
  const one = Substitute.for<any>()
  one.save({ name: Arg.any() }).returns(1)
  t.is(count(() => one.save(lazy())), 1) // the comparison with the setup (the search for matchers runs no getter)
  const ten = Substitute.for<any>()
  for (let index = 0; index < 10; index++) ten.save({ name: Arg.is(name => name === `u${index}`) }).returns(index)
  t.is(count(() => ten.save(lazy())), 10)
  const deeper = Substitute.for<any>()
  deeper.save({ user: { name: Arg.any() } }).returns(1)
  t.is(count(() => deeper.save({ user: lazy() })), 1)
})

test('R15V-2 (E102) such a value still matches by identity, and never matches an equal-looking container', t => {
  const unreadable = Object.defineProperty({}, 'name', { enumerable: true, get(): string { throw new Error('not loaded') } })
  const sub = Substitute.for<any>()
  sub.save({ user: unreadable, id: Arg.any() }).returns('same object')
  t.is(sub.save({ user: unreadable, id: 1 }), 'same object')
  t.not(sub.save({ user: Object.defineProperty({}, 'name', { enumerable: true, get(): string { throw new Error('not loaded') } }), id: 1 }), 'same object')
  t.not(sub.save({ user: { name: 'x' }, id: 1 }), 'same object')
  t.notThrows(() => sub.received(1).save({ user: unreadable, id: Arg.any() }))
})

// ---- E103 (R15V-3): a throwing answer reached through call/apply is noted like the direct call's --------------------

test('R15V-3 (E103) a call through call/apply answered by throws() makes a check through a call with matchers a usage error', t => {
  const paths: Array<{ name: string, act: (api: any) => unknown }> = [
    { name: 'a wrapper calling fn.apply(this, args)', act: api => withRetry(api.load)(1) },
    { name: 'fn.call(undefined, ...args)', act: api => callWith(api.load)(1) },
    { name: 'api.load.call(api, 1)', act: api => api.load.call(api, 1) },
    { name: 'api.load.apply(null, [1])', act: api => api.load.apply(null, [1]) }
  ]
  const answers: Array<{ name: string, setup: (api: any) => void, says: string }> = [
    { name: 'throws()', setup: api => api.load(Arg.any()).throws(new Error('x')), says: 'is configured with throws([Error: x]), so it threw instead of answering a substitute' },
    { name: 'a literal throws()', setup: api => api.load(1).throws(new Error('x')), says: 'is configured with throws([Error: x]), so it threw instead of answering a substitute' },
    { name: 'a throwing mimicks()', setup: api => api.load(Arg.any()).mimicks(() => { throw new Error('x') }), says: 'threw an error instead of answering a substitute' },
    { name: 'a throwing mimicked method', setup: api => api[mimick]({ load: () => { throw new Error('x') } }), says: 'threw an error instead of answering a substitute' }
  ]
  for (const answer of answers) {
    for (const route of paths) {
      const api = Substitute.for<any>()
      answer.setup(api)
      t.throws(() => route.act(api), { message: 'x' }, `${answer.name}, ${route.name}`) // the code under test
      // cd1bf29: these passed, as if load(1) had answered nothing that save() could be called on
      for (const open of [(v: any) => v.didNotReceive(), (v: any) => v[didNotReceive](), (v: any) => v.received(1), (v: any) => v[received](1)]) {
        const message = failureOf(t, () => open(api.load(Arg.any())).save(), `${answer.name}, ${route.name}`)
        t.true(message.startsWith('Cannot check through @Substitute.load(Arg.any{any}): the received call @Substitute.load(1), which it matches, ' +
          `${answer.says}.`), `${answer.name}, ${route.name}: ${message}`)
      }
      // recording is unchanged (D26): counted under both readings
      t.notThrows(() => api.received(1).load(1))
    }
  }
})

test('R15V-3 (E103) a function substitute called through call/apply, and the member reading of call/apply, are noted too', t => {
  const fn = Substitute.for<any>()
  fn(Arg.any()).throws(new Error('x'))
  t.throws(() => fn.call(null, 1), { message: 'x' })
  t.true(failureOf(t, () => fn(Arg.any()).didNotReceive().go())
    .startsWith('Cannot check through @Substitute(Arg.any{any}): the received call @Substitute(1), which it matches, is configured with throws([Error: x])'))

  const handler = Substitute.for<any>()
  handler(Arg.any()).mimicks(() => { throw new Error('x') })
  t.throws(() => handler.apply(undefined, [1]), { message: 'x' })
  t.true(failureOf(t, () => handler(Arg.any())[didNotReceive]().go()).includes('threw an error instead of answering a substitute'))

  // a member named call that is an API of its own (E91): its throws() setup answers, and it is noted for that member
  const rpc = Substitute.for<any>()
  rpc.call('getUser', Arg.any()).throws(new Error('x'))
  t.throws(() => rpc.call('getUser', 1), { message: 'x' })
  t.true(failureOf(t, () => rpc.call('getUser', Arg.any())[didNotReceive]().save())
    .includes("the received call @Substitute.call('getUser', 1), which it matches, is configured with throws([Error: x])"))

  // and a call that answered normally afterwards counts as before
  const api = Substitute.for<any>()
  const user = Substitute.for<any>()
  api.load(1).throws(new Error('x'))
  api.load(2).returns(user)
  t.throws(() => withRetry(api.load)(1), { message: 'x' })
  withRetry(api.load)(2).save()
  t.notThrows(() => api.load(2).received(1).save())
  t.notThrows(() => user.received(1).save())
})
