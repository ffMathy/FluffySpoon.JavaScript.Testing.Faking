import test, { ExecutionContext } from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute, Arg, configure } from '../../../src'
import { RecordedArguments } from '../../../src/internals/RecordedArguments'

// Round 6: wide objects, Maps and Sets (R5V-1, R5-ADV-1, R5TD-2; E13) and values that cannot be read (R5V-2; E14) as
// arguments.

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

/** Calls `sub.put(value)` for every value (unconfigured calls). */
const putAll = (values: readonly unknown[]): void => {
  const sub = Substitute.for<any>()
  for (const value of values) sub.put(value)
}

test.serial('R5V-1 (E13) distinct wide objects with the same keys are told apart', t => {
  // 30 objects with the same 5,000 keys and other values: copies (in another key order) find the same
  // auto-substitute, other values another one
  const sameKeys = Array.from({ length: 30 }, (_, call) => wideObject(5000, key => key + call))
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
 * Each limit: calls with distinct objects of `size` keys, on both sides of 256, 1,025 and 65,536 keys (the limits that
 * earlier versions treated wide objects by). `prefix` gives each run key sets of its own.
 */
const eachLimit = (t: ExecutionContext, prefix: string) => {
  for (const size of [255, 256, 257, 1024, 1025, 1026, 4096, 4097, 65_535, 65_536, 65_537]) {
    const calls = size > 10_000 ? 5 : 20
    const values = Array.from({ length: calls }, (_, call) => wideObject(size, key => call * 1_000_000 + key, key => `${prefix}${size}_${key}`))
    putAll(values)
    // a copy in another key order is the same argument
    const sub = Substitute.for<any>()
    t.is(sub.put(shuffledCopy(values[1], size)), sub.put(values[1]), `${size} keys`)
  }
}

test.serial('R5-ADV-1 (E13) objects on both sides of each limit (256, 1,025 and 65,536 keys) are the same argument in another key order', t => {
  eachLimit(t, 'w')
})

test.serial('R5-ADV-1 (E13) 50 normalized-state actions with a nested 5,000-entry byId are told apart', t => {
  const actions = Array.from({ length: 50 }, (_, action) => ({
    type: 'users/loaded',
    payload: { byId: wideObject(5000, key => ({ id: action * 5000 + key, name: `n${key}` }), key => `u${action * 5000 + key}`) }
  }))
  const store = Substitute.for<any>()
  actions.forEach(action => store.dispatch(action))
  t.is(store.dispatch({ ...actions[7], payload: { byId: { ...actions[7].payload.byId } } }), store.dispatch(actions[7]))
  t.not(store.dispatch(actions[8]), store.dispatch(actions[7]))
})

test.serial('R5-ADV-1 (E13) distinct Sets of records are told apart', t => {
  // still exact: equal copies (in another order) find the same auto-substitute, a record that differs anywhere (also
  // three levels down) another one
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

test.serial('R5-ADV-1 (E13) 20 literal setups with distinct 5,000-key objects are each found by a copy', t => {
  // each copy is confirmed with live deep equality (D35)
  const objects = Array.from({ length: 20 }, (_, index) => wideObject(5000, key => index * 100_000 + key))
  const copies = objects.map(object => ({ ...object }))
  const sink = Substitute.for<any>()
  objects.forEach((object, index) => sink.write(object).returns(index))
  copies.forEach((copy, index) => t.is(sink.write(copy), index))
  // the most recent setup wins, also through configure() with a copy in another key order
  sink[configure]().write(shuffledCopy(objects[5], 5)).returns('again')
  t.is(sink.write(objects[5]), 'again')
  t.is(sink.write(copies[6]), 6)
})

test.serial('R5-ADV-1 (E13) Maps and Sets on both sides of each limit (256 and 65,536 entries), with primitive and object keys, are told apart', t => {
  for (const size of [256, 257, 65_536, 65_537]) {
    const count = size > 1000 ? 5 : 50
    const maps = Array.from({ length: count }, (_, call) => new Map(Array.from({ length: size }, (_, key): [unknown, number] => [key % 2 === 0 ? `m${key}` : { key }, call + key])))
    const sets = Array.from({ length: count }, (_, call) => new Set(Array.from({ length: size }, (_, key) => (key === 0 ? { call } : call * 1_000_000 + key))))
    putAll(maps)
    putAll(sets)
    const sub = Substitute.for<any>()
    t.not(sub.put(maps[1]), sub.put(maps[2]), `Maps of ${size}`)
    t.not(sub.put(sets[1]), sub.put(sets[2]), `Sets of ${size}`)
    // equal ones, in another insertion order, are the same argument
    t.is(sub.put(new Map([...maps[1]].reverse())), sub.put(maps[1]), `Map of ${size}`)
    t.is(sub.put(new Set([...sets[1]].reverse())), sub.put(sets[1]), `Set of ${size}`)
  }
})

test.serial('R5TD-2 (E13) a wide object passed again and again: calls with one shared table of 300 to 10,000 keys find their auto-substitutes and are counted', t => {
  for (const size of [300, 1000, 10_000]) {
    const messages = wideObject(size, key => `text ${key}`, key => `message.key.${key}`)
    const translations = Substitute.for<any>()
    for (let index = 0; index < 100; index++) translations.t(`key${index}`, messages)
    t.is(translations.t('key7', messages), translations.t('key7', { ...messages }))
  }

  // a proxy table passed again and again
  for (const size of [300, 5000]) {
    const table = new Proxy(wideObject(size, key => key, key => `entry.${key}`), {})
    const lookup = Substitute.for<any>()
    for (let index = 0; index < 1000; index++) lookup.find(index, table)
    t.notThrows(() => lookup.received(1).find(999, table))
  }

  const role = { name: 'admin', permissions: ['read', 'write'] }
  // a matcher deep inside a wide table of records is recognised, on every call
  const hidden = wideObject(600, key => key === 300 ? { id: key, more: { deep: Arg.any() } } : { id: key, role }, key => `user${key}`)
  t.true(RecordedArguments.containsMatchers([hidden]))
  t.true(RecordedArguments.containsMatchers([hidden]))
  t.true(RecordedArguments.containsMatchers([hidden.user300]))

  // a matcher nested in a table is still found when the table is first seen, also after an equal one without
  const tableOf = (value: unknown) => wideObject(300, key => key === 150 ? value : key, key => `entry.${key}`)
  const lookup = Substitute.for<any>()
  lookup.find(tableOf(150))
  lookup.find(tableOf(Arg.any())).returns('configured')
  t.is(lookup.find(tableOf(-1)), 'configured')
  t.notThrows(() => lookup.received(1).find(tableOf(Arg.is((value: number) => value < 0))))
})

test.serial('R5V-2 (E14) values that cannot be read are matched by identity', t => {
  let getterRuns = 0
  const unreadable = (): object => Object.defineProperty({}, 'bad', { enumerable: true, get() { getterRuns++; throw new Error('cannot be read') } })

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
})

test.serial('R5V-1 (E13) 30 calls with same-size objects whose keys differ are told apart', t => {
  const values = Array.from({ length: 30 }, (_, call) => wideObject(5000, key => key, key => `k${call}_${key}`))
  const sub = Substitute.for<any>()
  const results = values.map(value => sub.put(value))
  values.forEach((value, index) => t.is(sub.put(shuffledCopy(value, index)), results[index]))
  t.is(new Set(results).size, values.length)

  // a matcher in an object with 5,000 other keys is found (as in any object): the call is a setup
  const withMatcher = { ...wideObject(5000, key => key), extra: Arg.any() }
  const store = Substitute.for<any>()
  store.put(withMatcher).returns('configured')
  t.is(store.put({ ...withMatcher, extra: 1 }), 'configured')
})

test.serial('R5-ADV-1 (E13) objects on both sides of each limit are the same argument in another key order, also after many other wide objects', t => {
  eachLimit(t, 'x')
})
