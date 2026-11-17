import test, { ExecutionContext } from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute, Arg, configure } from '../../../src'
import { hashArguments, refinedStructuralHash, structuralHash } from '../../../src/internals/utilities/ArgumentHash'
import { RecordedArguments } from '../../../src/internals/RecordedArguments'
import { assertWithin, timeLimit } from '../../helpers/timing'

// Round 6: the structural hash of wide objects, Maps and Sets (R5V-1, R5-ADV-1, R5TD-2; E13) and of values that cannot
// be read (R5V-2; E14). The tests run in order: which wide objects were hashed before matters for how fast a hash is
// (see "families" in ArgumentHash), never for its result. The values are created beforehand: only the calls are timed.

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}

/** An object with `size` keys, in insertion order. */
const wideObject = (size: number, value: (index: number) => unknown, key: (index: number) => string = index => `k${index}`): Record<string, unknown> => {
  const object: Record<string, unknown> = {}
  for (let index = 0; index < size; index++) object[key(index)] = value(index)
  return object
}

/** The same entries in another (shuffled) insertion order. */
const shuffledCopy = (object: Record<string, unknown>, seed: number): Record<string, unknown> => {
  const keys = Object.keys(object)
  for (let index = keys.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    const other = seed % (index + 1)
    ;[keys[index], keys[other]] = [keys[other], keys[index]]
  }
  const copy: Record<string, unknown> = {}
  for (const key of keys) copy[key] = object[key]
  return copy
}

/** Calls `sub.put(value)` for every value (unconfigured calls) and returns the time it took. */
const timeCalls = (values: readonly unknown[]): number => {
  const sub = Substitute.for<any>()
  return millisecondsOf(() => {
    for (const value of values) sub.put(value)
  })
}

test.serial('R5V-1 (E13) distinct wide objects with the same keys are told apart: 200 calls with 5,000 keys, 100 with 70,000 keys', t => {
  // 45facfb: 21 s for the first shape, as all objects with more than 4,096 keys had the same hash
  const shapes: Array<[string, Array<Record<string, unknown>>]> = [
    ['200 calls with distinct 5,000-key objects', Array.from({ length: 200 }, (_, call) => wideObject(5000, key => call * 100_000 + key))],
    ['100 calls with the same keys and other values', Array.from({ length: 100 }, (_, call) => wideObject(5000, key => key + call))],
    ['100 calls with distinct 70,000-key objects', Array.from({ length: 100 }, (_, call) => wideObject(70_000, key => call * 100_000 + key))]
  ]
  for (const [name, values] of shapes) {
    const elapsedLimit = timeLimit(1000)
    const elapsed = timeCalls(values)
    t.log(`${name}: ${elapsed.toFixed(1)} ms`)
    assertWithin(t, elapsed, elapsedLimit, `${name}`)
  }

  // still exact: copies (in another key order) find the same auto-substitute, other values another one
  const [, sameKeys] = shapes[1]
  const sub = Substitute.for<any>()
  const first = sameKeys.map(value => sub.put(value))
  sameKeys.forEach((value, index) => t.is(sub.put(shuffledCopy(value, index)), first[index], `copy ${index}`))
  t.is(new Set(first).size, sameKeys.length)
  // objects that differ in a single value, or that have one more key, are other arguments as well
  const changed = { ...sameKeys[0], k4322: -1 }
  const alsoChanged = { ...sameKeys[0], k1: -1 }
  const grown = { ...sameKeys[0], extra: 1 }
  const results = [changed, alsoChanged, grown].map(value => sub.put(value))
  t.is(new Set([first[0], ...results]).size, 4)
  t.is(sub.put({ ...grown }), results[2])
  t.is(sub.put(shuffledCopy(changed, 7)), results[0])
  t.notThrows(() => sub.received(2).put(sameKeys[3]))
  t.notThrows(() => sub.received(2).put(changed))
  t.notThrows(() => sub.received(1).put(alsoChanged))
})

/**
 * The cliff around each limit: calls with distinct objects of `size` keys, on both sides of 256 (wide containers),
 * 1,025 (families) and 65,536 (a sample of the values above). `prefix` gives each run key sets of its own.
 */
const eachLimit = (t: ExecutionContext, prefix: string) => {
  for (const size of [255, 256, 257, 1024, 1025, 1026, 4096, 4097, 65_535, 65_536, 65_537]) {
    const calls = size > 10_000 ? 10 : 200
    const values = Array.from({ length: calls }, (_, call) => wideObject(size, key => call * 1_000_000 + key, key => `${prefix}${size}_${key}`))
    const elapsedLimit = timeLimit(1000)
    const elapsed = timeCalls(values)
    t.log(`${calls} calls with distinct ${size}-key objects: ${elapsed.toFixed(1)} ms`)
    assertWithin(t, elapsed, elapsedLimit, `${calls} calls with distinct ${size}-key objects`)
    // a copy in another key order hashes alike, also without families
    t.is(structuralHash(shuffledCopy(values[1], size)), structuralHash(values[1]), `${size} keys`)
    t.is(refinedStructuralHash(shuffledCopy(values[1], size)), refinedStructuralHash(values[1]), `${size} keys (refined)`)
  }
}

test.serial('R5-ADV-1 (E13) objects on both sides of each limit (256, 1,025 and 65,536 keys) cost about the same per key', t => {
  // the first wide key sets of this file: each one starts a family (see ArgumentHash)
  eachLimit(t, 'w')
})

test.serial('R5-ADV-1 (E13) 50 normalized-state actions with a nested 5,000-entry byId finish well under 1s', t => {
  const actions = Array.from({ length: 50 }, (_, action) => ({
    type: 'users/loaded',
    payload: { byId: wideObject(5000, key => ({ id: action * 5000 + key, name: `n${key}` }), key => `u${action * 5000 + key}`) }
  }))
  const store = Substitute.for<any>()
  const elapsedLimit = timeLimit(1000)
  const elapsed = millisecondsOf(() => actions.forEach(action => store.dispatch(action)))
  t.log(`50 normalized-state actions: ${elapsed.toFixed(1)} ms`)
  assertWithin(t, elapsed, elapsedLimit, `50 normalized-state actions`)
  t.is(store.dispatch({ ...actions[7], payload: { byId: { ...actions[7].payload.byId } } }), store.dispatch(actions[7]))
  t.not(store.dispatch(actions[8]), store.dispatch(actions[7]))
})

test.serial('R5-ADV-1 (E13) distinct tables of records, Sets of objects and Maps with object keys are told apart: 100 calls each', t => {
  // 45facfb (and ec64181): 3.4 to 4.2 s each, as the objects among the entries of a wide container all counted alike
  const records = (call: number) => Array.from({ length: 5000 }, (_, key) => ({ id: call * 5000 + key, name: `n${key}` }))
  // E29: the best of three runs, each with values of its own, made right before it (and dropped after it), so that a
  // busy machine, or a garbage collection of the values of the other shapes, does not count
  const shapes: Array<[string, (run: number) => unknown[]]> = [
    ['100 Sets of 5,000 records', run => Array.from({ length: 100 }, (_, call) => new Set(records(run * 100 + call)))],
    ['100 Maps with 5,000 object keys', run => Array.from({ length: 100 }, (_, call) => new Map(records(run * 100 + call).map((record, key): [object, object] => [{ key }, record])))],
    ['100 tables of 5,000 records with the same keys', run => Array.from({ length: 100 }, (_, call) => { const rows = records(run * 100 + call); return wideObject(5000, key => rows[key], key => `user${key}`) })],
    // the same keys and ids, other names: snapshots of a normalized state
    ['100 snapshots of 5,000 records', run => Array.from({ length: 100 }, (_, call) => wideObject(5000, key => ({ id: key, name: `n${key}`, address: { city: `c${run}_${call}` } }), key => `id${key}`))]
  ]
  for (const [name, values] of shapes) {
    const elapsedLimit = timeLimit(1000)
    let elapsed = Infinity
    for (let run = 0; run < 3; run++) elapsed = Math.min(elapsed, timeCalls(values(run)))
    t.log(`${name}: ${elapsed.toFixed(1)} ms`)
    assertWithin(t, elapsed, elapsedLimit, `${name}`)
  }

  // still exact: equal copies (in another order) find the same auto-substitute, a record that differs anywhere (also
  // deeper than the budget of an entry looks) another one
  const sub = Substitute.for<any>()
  const table = () => new Set(Array.from({ length: 300 }, (_, key) => ({ id: key, deep: { deeper: { deepest: 1 } } })))
  const first = sub.put(table())
  t.is(sub.put(new Set([...table()].reverse())), first)
  const changed = table()
  ;[...changed][7].deep.deeper.deepest = 2
  t.not(sub.put(changed), first)
  t.notThrows(() => sub.received(2).put(table()))
  t.notThrows(() => sub.received(1).put(changed))
})

test.serial('R5-ADV-1 (E13) 200 literal setups and 200 calls with copies of distinct 5,000-key objects finish well under 1s', t => {
  // Each copy is confirmed with live deep equality (D35), which takes Node.js about a millisecond for 5,000 keys: most
  // of the time. The best of three runs (each with objects of its own, which are built before the timing), so that a
  // run slowed down by other processes or by a garbage collection does not count.
  let wrong = 0
  const run = () => {
    const objects = Array.from({ length: 200 }, (_, index) => wideObject(5000, key => index * 100_000 + key))
    const copies = objects.map(object => ({ ...object }))
    const sink = Substitute.for<any>()
    const elapsed = millisecondsOf(() => {
      objects.forEach((object, index) => sink.write(object).returns(index))
      copies.forEach((copy, index) => { if (sink.write(copy) !== index) wrong++ })
    })
    return { elapsed, objects, copies, sink }
  }
  // only the last run's objects are kept (they take about 80 MB per run)
  const bestLimit = timeLimit(1000)
  const elapsed = Math.min(run().elapsed, run().elapsed)
  const last = run()
  const best = Math.min(elapsed, last.elapsed)
  t.log(`200 literal setups + 200 calls with copies (best of 3): ${best.toFixed(1)} ms`)
  t.is(wrong, 0)
  assertWithin(t, best, bestLimit, `200 literal setups + 200 calls with copies`)
  // the most recent setup wins, also through configure() with a copy in another key order
  const { objects, copies, sink } = last
  sink[configure]().write(shuffledCopy(objects[5], 5)).returns('again')
  t.is(sink.write(objects[5]), 'again')
  t.is(sink.write(copies[6]), 6)
})

test.serial('R5-ADV-1 (E13) Maps and Sets on both sides of each limit (256 and 65,536 entries), with primitive and object keys', t => {
  for (const size of [256, 257, 65_536, 65_537]) {
    const count = size > 1000 ? 5 : 50
    const maps = Array.from({ length: count }, (_, call) => new Map(Array.from({ length: size }, (_, key): [unknown, number] => [key % 2 === 0 ? `m${key}` : { key }, call + key])))
    const sets = Array.from({ length: count }, (_, call) => new Set(Array.from({ length: size }, (_, key) => (key === 0 ? { call } : call * 1_000_000 + key))))
    const elapsedLimit = timeLimit(1000)
    const elapsed = timeCalls(maps) + timeCalls(sets)
    t.log(`${count} Maps and ${count} Sets with ${size} entries: ${elapsed.toFixed(1)} ms`)
    assertWithin(t, elapsed, elapsedLimit, `${count} Maps and ${count} Sets with ${size} entries`)
    t.not(structuralHash(maps[1]), structuralHash(maps[2]), `Maps of ${size}`)
    t.not(structuralHash(sets[1]), structuralHash(sets[2]), `Sets of ${size}`)
    // equal ones, in another insertion order, hash alike
    t.is(structuralHash(new Map([...maps[1]].reverse())), structuralHash(maps[1]), `Map of ${size}`)
    t.is(structuralHash(new Set([...sets[1]].reverse())), structuralHash(sets[1]), `Set of ${size}`)
  }
})

test.serial('R5TD-2 (E13) a wide object passed again and again is listed once: 10,000 calls with one shared table of 300 to 10,000 keys', t => {
  // 45facfb: from 0.6 s (300 keys) to about 12 s (10,000 keys), as the keys of the table were listed for every call,
  // and a table of up to 1,024 keys was also searched for nested matchers on every call
  for (const size of [300, 1000, 10_000]) {
    const messages = wideObject(size, key => `text ${key}`, key => `message.key.${key}`)
    const translations = Substitute.for<any>()
    const elapsedLimit = timeLimit(1000)
    const elapsed = millisecondsOf(() => {
      for (let index = 0; index < 10_000; index++) translations.t(`key${index}`, messages)
    })
    t.log(`10,000 calls with distinct first arguments and one shared ${size}-key table: ${elapsed.toFixed(1)} ms`)
    assertWithin(t, elapsed, elapsedLimit, `10,000 calls with distinct first arguments and one shared ${size}-key table`)
    t.is(translations.t('key7', messages), translations.t('key7', { ...messages }))
  }

  // its keys are listed when it is first seen (to search it for matchers, and to hash it), never again
  for (const size of [300, 5000]) {
    let listings = 0
    const table = new Proxy(wideObject(size, key => key, key => `entry.${key}`), {
      ownKeys: target => {
        listings++
        return Reflect.ownKeys(target)
      }
    })
    const lookup = Substitute.for<any>()
    lookup.find(0, table)
    const firstListings = listings
    for (let index = 1; index < 1000; index++) lookup.find(index, table)
    t.is(listings, firstListings, `${size} keys`)
    t.true(firstListings <= 4, `${size} keys: listed ${firstListings} times`)
    t.notThrows(() => lookup.received(1).find(999, table))
  }

  // a shared table of records that share nested objects: the budget of the search leaves those out on every call, so
  // the table is searched once in full instead (45facfb: 1.8 s, ec64181: 1.6 s)
  const role = { name: 'admin', permissions: ['read', 'write'] }
  const users = wideObject(600, key => ({ id: key, role }), key => `user${key}`)
  const directory = Substitute.for<any>()
  const elapsedLimit = timeLimit(1000)
  const elapsed = millisecondsOf(() => {
    for (let index = 0; index < 10_000; index++) directory.t(`key${index}`, users)
  })
  t.log(`10,000 calls with distinct first arguments and one shared table of 600 records with a shared role: ${elapsed.toFixed(1)} ms`)
  assertWithin(t, elapsed, elapsedLimit, `10,000 calls with one shared table of 600 records`)
  // a matcher further inside than the search looks is not recognised there, on every call (as before)
  const hidden = wideObject(600, key => key === 300 ? { id: key, more: { deep: Arg.any() } } : { id: key, role }, key => `user${key}`)
  t.false(RecordedArguments.containsMatchers([hidden]))
  t.false(RecordedArguments.containsMatchers([hidden]))
  t.true(RecordedArguments.containsMatchers([hidden.user300]))

  // a matcher nested in a table is still found when the table is first seen, also after an equal one without
  const tableOf = (value: unknown) => wideObject(300, key => key === 150 ? value : key, key => `entry.${key}`)
  const lookup = Substitute.for<any>()
  lookup.find(tableOf(150))
  lookup.find(tableOf(Arg.any())).returns('configured')
  t.is(lookup.find(tableOf(-1)), 'configured')
  t.notThrows(() => lookup.received(1).find(tableOf(Arg.is((value: number) => value < 0))))
})

test.serial('R5V-2 (E14) values that cannot be read are matched by identity: 4,000 calls with a throwing getter, with the same results', t => {
  let getterRuns = 0
  const unreadable = (): object => Object.defineProperty({}, 'bad', { enumerable: true, get() { getterRuns++; throw new Error('cannot be read') } })
  const values = Array.from({ length: 4000 }, unreadable)
  const elapsedLimit = timeLimit(1000)
  const elapsed = timeCalls(values)
  t.log(`4,000 calls with distinct objects whose only property is a throwing getter: ${elapsed.toFixed(1)} ms`)
  // 45facfb: about 65 s, as every such call was compared with every earlier one, running the getter each time
  assertWithin(t, elapsed, elapsedLimit, `4,000 calls`)

  const [first, second] = [unreadable(), unreadable()]
  const sub = Substitute.for<any>()
  // the same value finds what was recorded for it, another one does not (deep equality throws for them: no match)
  t.is(sub.f(first), sub.f(first))
  t.not(sub.f(first), sub.f(second))
  // a copy of a container that holds the same value is deep strictly equal to it (the value itself is not compared)
  t.true(isDeepStrictEqual({ value: first }, { value: first }))
  t.is(sub.g({ value: first }, 1), sub.g({ value: first }, 1))
  t.not(sub.g({ value: first }, 1), sub.g({ value: second }, 1))
  sub.h(first).returns('first')
  sub.wrap([first]).returns('wrapped')
  t.is(sub.h(first), 'first')
  t.not(sub.h(second), 'first')
  t.is(sub.wrap([first]), 'wrapped')
  t.not(sub.wrap([second]), 'wrapped')
  t.notThrows(() => sub.received(3).f(first))
  t.notThrows(() => sub.received(1).h(first))
  // once seen, a value is not read again by later calls
  const runs = getterRuns
  for (let index = 0; index < 100; index++) sub.f(first)
  t.is(getterRuns, runs)

  // revoked proxies, also as nested values
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  t.is(sub.p(proxy), sub.p(proxy))
  t.is(sub.p([proxy]), sub.p([proxy]))
  t.not(sub.p(proxy), sub.p(Proxy.revocable({}, {}).proxy))
  t.is(hashArguments([1, first]), hashArguments([1, first]))
  t.not(structuralHash(first), structuralHash(second))
})

test.serial('R5V-1 (E13) more key sets than there are families: 100 calls with same-size objects whose keys differ', t => {
  // the key sets after the last family are listed and hashed with every key (see ArgumentHash)
  const values = Array.from({ length: 100 }, (_, call) => wideObject(5000, key => key, key => `k${call}_${key}`))
  const elapsedLimit = timeLimit(1000)
  const elapsed = timeCalls(values)
  t.log(`100 calls with same-size objects whose keys differ: ${elapsed.toFixed(1)} ms`)
  assertWithin(t, elapsed, elapsedLimit, `100 calls with same-size objects whose keys differ`)
  const sub = Substitute.for<any>()
  const results = values.map(value => sub.put(value))
  values.forEach((value, index) => t.is(sub.put(shuffledCopy(value, index)), results[index]))
  t.is(new Set(results).size, values.length)
  values.slice(0, 20).forEach((value, index) => t.is(refinedStructuralHash(shuffledCopy(value, index)), refinedStructuralHash(value)))

  // a matcher in an object with as many keys as a family is not looked for (as in any object with more than 1,024 keys)
  const withMatcher = { ...wideObject(5000, key => key), extra: Arg.any() }
  const store = Substitute.for<any>()
  store.put(withMatcher)
  t.notThrows(() => store.received(1).put(withMatcher))
  store[configure]().put(withMatcher).returns('configured')
  t.is(store.put({ ...withMatcher }), 'configured')
})

test.serial('R5-ADV-1 (E13) objects on both sides of each limit cost about the same per key, also once every family is taken', t => {
  // the tests above took every family: these wide objects are hashed with every key, listed once
  eachLimit(t, 'x')
})
