import test from 'ava'
import { Substitute, Arg, configure } from '../../../src'
import { refinedStructuralHash, structuralHash } from '../../../src/internals/utilities/ArgumentHash'

// Round 6: the structural hash of wide objects, Maps and Sets (R5V-1, R5-ADV-1, R5TD-2; E13). The tests run in order: which wide objects were hashed before matters for how fast a hash is
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
    const elapsed = timeCalls(values)
    t.log(`${name}: ${elapsed.toFixed(1)} ms`)
    t.true(elapsed < 1000, `${name}: ${elapsed} ms`)
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

test.serial('R5-ADV-1 (E13) 50 normalized-state actions with a nested 5,000-entry byId finish well under 1s', t => {
  const actions = Array.from({ length: 50 }, (_, action) => ({
    type: 'users/loaded',
    payload: { byId: wideObject(5000, key => ({ id: action * 5000 + key, name: `n${key}` }), key => `u${action * 5000 + key}`) }
  }))
  const store = Substitute.for<any>()
  const elapsed = millisecondsOf(() => actions.forEach(action => store.dispatch(action)))
  t.log(`50 normalized-state actions: ${elapsed.toFixed(1)} ms`)
  t.true(elapsed < 1000, `50 normalized-state actions: ${elapsed} ms`)
  t.is(store.dispatch({ ...actions[7], payload: { byId: { ...actions[7].payload.byId } } }), store.dispatch(actions[7]))
  t.not(store.dispatch(actions[8]), store.dispatch(actions[7]))
})

test.serial('R5-ADV-1 (E13) 200 literal setups and 200 calls with copies of distinct 5,000-key objects finish well under 1s', t => {
  const objects = Array.from({ length: 200 }, (_, index) => wideObject(5000, key => index * 100_000 + key))
  const copies = objects.map(object => ({ ...object }))
  const sink = Substitute.for<any>()
  let wrong = 0
  // each copy is confirmed with live deep equality, which takes about a millisecond for 5,000 keys
  const elapsed = millisecondsOf(() => {
    objects.forEach((object, index) => sink.write(object).returns(index))
    copies.forEach((copy, index) => { if (sink.write(copy) !== index) wrong++ })
  })
  t.log(`200 literal setups + 200 calls with copies: ${elapsed.toFixed(1)} ms`)
  t.is(wrong, 0)
  t.true(elapsed < 1000, `200 literal setups + 200 calls with copies: ${elapsed} ms`)
  // the most recent setup wins, also through configure() with a copy in another key order
  sink[configure]().write(shuffledCopy(objects[5], 5)).returns('again')
  t.is(sink.write(objects[5]), 'again')
  t.is(sink.write(copies[6]), 6)
})

test.serial('R5-ADV-1 (E13) objects on both sides of each limit (256, 1,025 and 65,536 keys) cost about the same per key', t => {
  for (const size of [255, 256, 257, 1024, 1025, 1026, 4096, 4097, 65_535, 65_536, 65_537]) {
    const calls = size > 10_000 ? 10 : 200
    const values = Array.from({ length: calls }, (_, call) => wideObject(size, key => call * 1_000_000 + key, key => `w${size}_${key}`))
    const elapsed = timeCalls(values)
    t.log(`${calls} calls with distinct ${size}-key objects: ${elapsed.toFixed(1)} ms`)
    t.true(elapsed < 1000, `${calls} calls with distinct ${size}-key objects: ${elapsed} ms`)
    // a copy in another key order hashes alike, also without families
    t.is(structuralHash(shuffledCopy(values[1], size)), structuralHash(values[1]), `${size} keys`)
    t.is(refinedStructuralHash(shuffledCopy(values[1], size)), refinedStructuralHash(values[1]), `${size} keys (refined)`)
  }
})

test.serial('R5-ADV-1 (E13) Maps and Sets on both sides of each limit (256 and 65,536 entries), with primitive and object keys', t => {
  for (const size of [256, 257, 65_536, 65_537]) {
    const count = size > 1000 ? 5 : 50
    const maps = Array.from({ length: count }, (_, call) => new Map(Array.from({ length: size }, (_, key): [unknown, number] => [key % 2 === 0 ? `m${key}` : { key }, call + key])))
    const sets = Array.from({ length: count }, (_, call) => new Set(Array.from({ length: size }, (_, key) => (key === 0 ? { call } : call * 1_000_000 + key))))
    const elapsed = timeCalls(maps) + timeCalls(sets)
    t.log(`${count} Maps and ${count} Sets with ${size} entries: ${elapsed.toFixed(1)} ms`)
    t.true(elapsed < 1000, `${count} Maps and ${count} Sets with ${size} entries: ${elapsed} ms`)
    t.not(structuralHash(maps[1]), structuralHash(maps[2]), `Maps of ${size}`)
    t.not(structuralHash(sets[1]), structuralHash(sets[2]), `Sets of ${size}`)
    // equal ones, in another insertion order, hash alike
    t.is(structuralHash(new Map([...maps[1]].reverse())), structuralHash(maps[1]), `Map of ${size}`)
    t.is(structuralHash(new Set([...sets[1]].reverse())), structuralHash(sets[1]), `Set of ${size}`)
  }
})

test.serial('R5TD-2 (E13) a wide object passed again and again is listed once: 10,000 calls with one shared 10,000-key table', t => {
  // 45facfb: about 12 s, as the keys of the table were listed for every call
  const messages = wideObject(10_000, key => `text ${key}`, key => `message.key.${key}`)
  const translations = Substitute.for<any>()
  const elapsed = millisecondsOf(() => {
    for (let index = 0; index < 10_000; index++) translations.t(`key${index}`, messages)
  })
  t.log(`10,000 calls with distinct first arguments and one shared table: ${elapsed.toFixed(1)} ms`)
  t.true(elapsed < 1000, `10,000 calls with distinct first arguments and one shared table: ${elapsed} ms`)
  t.is(translations.t('key7', messages), translations.t('key7', { ...messages }))

  // its keys are listed when it is first seen (to search it for matchers, and to hash it), never again
  let listings = 0
  const table = new Proxy(wideObject(5000, key => key, key => `entry.${key}`), {
    ownKeys: target => {
      listings++
      return Reflect.ownKeys(target)
    }
  })
  const lookup = Substitute.for<any>()
  lookup.find(0, table)
  const firstListings = listings
  for (let index = 1; index < 1000; index++) lookup.find(index, table)
  t.is(listings, firstListings)
  t.true(firstListings <= 4, `listed ${firstListings} times`)
  t.notThrows(() => lookup.received(1).find(999, table))
})

test.serial('R5V-1 (E13) more key sets than there are families: 100 calls with same-size objects whose keys differ', t => {
  // the key sets after the last family are listed and hashed with every key (see ArgumentHash)
  const values = Array.from({ length: 100 }, (_, call) => wideObject(5000, key => key, key => `k${call}_${key}`))
  const elapsed = timeCalls(values)
  t.log(`100 calls with same-size objects whose keys differ: ${elapsed.toFixed(1)} ms`)
  t.true(elapsed < 1000, `100 calls with same-size objects whose keys differ: ${elapsed} ms`)
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
