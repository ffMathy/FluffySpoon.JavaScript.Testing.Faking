import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { MAX_MESSAGE_DEPTH, leastDifference } from '../../../src/internals/utilities/Stringify'

// Round 13: how printouts and failure messages print values (fix spec E74, E78, E79), the findings of round 12
// R12-ADV-1, R12V-2 and R12-ADV-2.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of a failing check, without colours and without its "called at" lines. */
const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message).split('\n').filter(line => !/^\s+called at /.test(line)).join('\n')
  }
  throw new Error('expected the assertion to fail')
}

/** The expected-call line and the listed received calls of a message, each on one line. */
const linesOf = (message: string) => {
  const flat = message.replace(/\n\s*/g, ' ')
  const expected = /matching (.*?), but received/.exec(flat)?.[1]
  const received = message.split('\n› ').slice(1).map(line => line.replace(/\n\s*/g, ' ').replace(/^[✔✘] /, '').replace(/ The substitutes are numbered.*$/, '').trim())
  return { expected, received }
}

/** `length` errors without stack traces (they are not printed, and capturing them is slow). */
const errors = (length: number): Error[] => {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    return Array.from({ length }, (_, index) => new Error(`failed ${index}`))
  } finally {
    Error.stackTraceLimit = limit
  }
}

// ---- E74 (R12-ADV-1): long arrays --------------------------------------------------------------------------------

test('R12-ADV-1 (E74) an array of more than 1,000 items whose first items print in a short form prints them and its other keys', t => {
  // the keys of an array other than its indices show after its items at any length (f9ce534 left them out of the copy
  // of an array of more than 1,000 items)
  const rows = (length: number) => Object.assign(errors(length), { total: length })
  const queue = Substitute.for<any>()
  queue.retry(rows(1000))
  queue.retry(rows(1001))
  const printout = plain(String(queue)).replace(/\s+/g, ' ')
  t.true(printout.includes('[Error: failed 19], ... 980 more items, total: 1000 ])'), printout)
  t.true(printout.includes('[Error: failed 19], ... 981 more items, total: 1001 ])'), printout)
  // as an array that prints as it is shows them, as util.inspect does
  const numbers = Object.assign(Array.from({ length: 1001 }, (_, index) => index), { total: 1001 })
  const other = Substitute.for<any>()
  other.retry(numbers)
  t.true(plain(String(other)).replace(/\s+/g, ' ').includes('... 981 more items, total: 1001 ])'), plain(String(other)))
  // and the copy of a long array prints like the array: its first items, and how many more there are
  const million = Substitute.for<any>()
  const shown = errors(20)
  million.retry(Array.from({ length: 1000000 }, (_, index) => shown[index % 20]))
  const lines = linesOf(messageOf(() => million.received(1).retry([])))
  t.is(lines.received[0].replace(/\s+/g, ' '), `@Substitute.retry([ ${Array.from({ length: 20 }, (_, index) => `[Error: failed ${index}]`).join(', ')}, ... 999980 more items ])`)
  t.is(inspect(million.retry(errors(3))), "@Substitute.retry([ [Error: failed 0], [Error: failed 1], [Error: failed 2] ])")
})

// ---- E78 (R12V-2): order that matching ignores, in Maps, Sets, errors and functions ---------------------------------

test('R12V-2 (E78) a Set or a Map built in another order does not keep a difference further down from being printed deeper', t => {
  // a DTO with a Set of tags built in another order, and a real difference four levels down elsewhere
  const posts = Substitute.for<any>()
  posts.publish({ id: 'p1', tags: new Set(['news', 'tech']), author: { profile: { address: { city: 'Oslo' } } } })
  const set = linesOf(messageOf(() => posts.received(1).publish({ id: 'p1', tags: new Set(['tech', 'news']), author: { profile: { address: { city: 'Bergen' } } } })))
  // each line in its own order; caec697 and 98a8973 printed both two levels deep (`address: [Object]`)
  t.is(set.expected, "publish({ id: 'p1', tags: Set(2) { 'tech', 'news' }, author: { profile: { address: { city: 'Bergen' } } } })")
  t.deepEqual(set.received, ["@Substitute.publish({ id: 'p1', tags: Set(2) { 'news', 'tech' }, author: { profile: { address: { city: 'Oslo' } } } })"])
  // headers built from Object.entries in another order
  const http = Substitute.for<any>()
  http.send(new Map(Object.entries({ accept: 'json', auth: 'x' })), { body: { user: { address: { city: 'Oslo' } } } })
  const map = linesOf(messageOf(() => http.received(1).send(new Map([['auth', 'x'], ['accept', 'json']]), { body: { user: { address: { city: 'Bergen' } } } })))
  t.is(map.expected, "send(Map(2) { 'auth' => 'x', 'accept' => 'json' }, { body: { user: { address: { city: 'Bergen' } } } })")
  t.deepEqual(map.received, ["@Substitute.send(Map(2) { 'accept' => 'json', 'auth' => 'x' }, { body: { user: { address: { city: 'Oslo' } } } })"])
  // keys that are objects, and members that are objects, in another order
  const deep = (city: string) => ({ body: { user: { address: { city } } } })
  const index = Substitute.for<any>()
  index.put(new Map([[{ id: 1 }, 'a'], [{ id: 2 }, 'b']]), deep('Oslo'))
  const keys = linesOf(messageOf(() => index.received(1).put(new Map([[{ id: 2 }, 'b'], [{ id: 1 }, 'a']]), deep('Bergen'))))
  t.is(keys.expected, "put(Map(2) { { id: 2 } => 'b', { id: 1 } => 'a' }, { body: { user: { address: { city: 'Bergen' } } } })")
  t.deepEqual(keys.received, ["@Substitute.put(Map(2) { { id: 1 } => 'a', { id: 2 } => 'b' }, { body: { user: { address: { city: 'Oslo' } } } })"])
  const tags = Substitute.for<any>()
  tags.add(new Set([{ name: 'a' }, { name: 'b' }]), deep('Oslo'))
  const members = linesOf(messageOf(() => tags.received(1).add(new Set([{ name: 'b' }, { name: 'a' }]), deep('Bergen'))))
  t.is(members.expected, "add(Set(2) { { name: 'b' }, { name: 'a' } }, { body: { user: { address: { city: 'Bergen' } } } })")
  t.deepEqual(members.received, ["@Substitute.add(Set(2) { { name: 'a' }, { name: 'b' } }, { body: { user: { address: { city: 'Oslo' } } } })"])
  // a Set whose members differ stays two levels deep: that shows the difference
  const other = Substitute.for<any>()
  other.add(new Set(['news', 'tech']), deep('Oslo'))
  const differing = linesOf(messageOf(() => other.received(1).add(new Set(['tech', 'sport']), deep('Bergen'))))
  t.is(differing.expected, "add(Set(2) { 'tech', 'sport' }, { body: { user: { address: [Object] } } })")
})

test('R12V-2 (E78) errors and functions whose own properties come in another order do not keep a difference further down from being printed deeper', t => {
  const deep = (city: string) => ({ body: { user: { address: { city } } } })
  const declined = (codeFirst: boolean) => {
    const error = new Error('declined')
    if (codeFirst) Object.assign(error, { code: 'E1', status: 402 })
    else Object.assign(error, { status: 402, code: 'E1' })
    return error
  }
  const payments = Substitute.for<any>()
  payments.fail(declined(true), deep('Oslo'))
  const errors = linesOf(messageOf(() => payments.received(1).fail(declined(false), deep('Bergen'))))
  t.is(errors.expected, "fail([Error: declined] { status: 402, code: 'E1' }, { body: { user: { address: { city: 'Bergen' } } } })")
  t.deepEqual(errors.received, ["@Substitute.fail([Error: declined] { code: 'E1', status: 402 }, { body: { user: { address: { city: 'Oslo' } } } })"])
  const handler = (onceFirst: boolean) => {
    const onDone = function onDone() { }
    if (onceFirst) Object.assign(onDone, { once: true, id: 7 })
    else Object.assign(onDone, { id: 7, once: true })
    return onDone
  }
  const bus = Substitute.for<any>()
  bus.on(handler(true), deep('Oslo'))
  const functions = linesOf(messageOf(() => bus.received(1).on(handler(false), deep('Bergen'))))
  t.is(functions.expected, "on([Function: onDone] { id: 7, once: true }, { body: { user: { address: { city: 'Bergen' } } } })")
  t.deepEqual(functions.received, ["@Substitute.on([Function: onDone] { once: true, id: 7 }, { body: { user: { address: { city: 'Oslo' } } } })"])
  // functions with another name print differently: they stay two levels deep
  const other = Substitute.for<any>()
  other.on(Object.assign(function onDone() { }, { id: 7 }), deep('Oslo'))
  const named = linesOf(messageOf(() => other.received(1).on(Object.assign(function onFail() { }, { id: 7 }), deep('Bergen'))))
  t.is(named.expected, "on([Function: onFail] { id: 7 }, { body: { user: { address: [Object] } } })")
})

test('R12V-2 (E78) a function whose properties differ beyond what an object shows of its keys is printed at the least depth that shows it', t => {
  // util.inspect prints a function with all of its properties and all the keys of the objects in them (an object
  // argument shows its first 20 keys): here the 22nd key differs two levels deep, and another key four levels deep
  const handler = (last: number, deep: number) => {
    const meta: Record<string, unknown> = {}
    for (let index = 0; index < 22; index++) meta[`w${index}`] = index
    meta.w21 = last
    meta.w5 = { a: { b: deep } }
    return Object.assign(function handler() { }, { meta })
  }
  const bus = Substitute.for<any>()
  bus.on({ v: handler(0, 1) })
  const lines = linesOf(messageOf(() => bus.received(1).on({ v: handler(1, 2) })))
  // as 98a8973 and 325a37b printed it: two levels deep, where w21 shows (the fuzzer of round 13 found it printed four
  // levels deep at first)
  t.true(lines.expected!.includes('w5: [Object],'), lines.expected)
  t.true(lines.expected!.endsWith('w20: 20, w21: 1 } } })'), lines.expected)
  t.true(lines.received[0].includes('w5: [Object],'), lines.received[0])
  t.true(lines.received[0].endsWith('w20: 20, w21: 0 } } })'), lines.received[0])
})

test('R12V-2 (E78) orders inside the members of a Set and the properties of errors and functions do not keep a difference further down from being printed deeper', t => {
  const deep = (city: string) => ({ body: { user: { address: { city } } } })
  const DEEP = (city: string) => `{ body: { user: { address: { city: '${city}' } } } }`
  // an object held by an error, with its keys in another order
  const payments = Substitute.for<any>()
  payments.fail(Object.assign(new Error('x'), { info: { a: 1, b: 2 } }), deep('Oslo'))
  const errors = linesOf(messageOf(() => payments.received(1).fail(Object.assign(new Error('x'), { info: { b: 2, a: 1 } }), deep('Bergen'))))
  t.is(errors.expected, `fail([Error: x] { info: { b: 2, a: 1 } }, ${DEEP('Bergen')})`)
  t.deepEqual(errors.received, [`@Substitute.fail([Error: x] { info: { a: 1, b: 2 } }, ${DEEP('Oslo')})`])
  // and an error held by an error (its cause), with its properties in another order
  const cause = (codeFirst: boolean) => codeFirst ? Object.assign(new Error('c'), { code: 1, at: 2 }) : Object.assign(new Error('c'), { at: 2, code: 1 })
  const jobs = Substitute.for<any>()
  jobs.fail(Object.assign(new Error('x'), { cause: cause(true) }), deep('Oslo'))
  const causes = linesOf(messageOf(() => jobs.received(1).fail(Object.assign(new Error('x'), { cause: cause(false) }), deep('Bergen'))))
  t.is(causes.expected, `fail([Error: x] { [cause]: [Error: c] { at: 2, code: 1 } }, ${DEEP('Bergen')})`)
  // members of a Set in another order, whose keys are in another order, too
  const tags = Substitute.for<any>()
  tags.add(new Set([{ a: 1, b: 2 }, { c: 3 }]), deep('Oslo'))
  const members = linesOf(messageOf(() => tags.received(1).add(new Set([{ c: 3 }, { b: 2, a: 1 }]), deep('Bergen'))))
  t.is(members.expected, `add(Set(2) { { c: 3 }, { b: 2, a: 1 } }, ${DEEP('Bergen')})`)
  t.deepEqual(members.received, [`@Substitute.add(Set(2) { { a: 1, b: 2 }, { c: 3 } }, ${DEEP('Oslo')})`])
  // a Map held by a function, in another order
  const bus = Substitute.for<any>()
  bus.on(Object.assign(function h() { }, { m: new Map([['a', 1], ['b', 2]]) }), deep('Oslo'))
  const functions = linesOf(messageOf(() => bus.received(1).on(Object.assign(function h() { }, { m: new Map([['b', 2], ['a', 1]]) }), deep('Bergen'))))
  t.is(functions.expected, `on([Function: h] { m: Map(2) { 'b' => 2, 'a' => 1 } }, ${DEEP('Bergen')})`)
  // members that differ in more than their order stay two levels deep
  const other = Substitute.for<any>()
  other.add(new Set([{ a: 1, b: 2 }, { c: 3 }]), deep('Oslo'))
  const differing = linesOf(messageOf(() => other.received(1).add(new Set([{ c: 3 }, { b: 2, a: 9 }]), deep('Bergen'))))
  t.is(differing.expected, "add(Set(2) { { c: 3 }, { b: 2, a: 9 } }, { body: { user: { address: [Object] } } })")
})

test('R12V-2 (E78) leastDifference finds the least depth at which Maps, Sets, errors and functions print differently in more than their order', t => {
  const least = (expected: unknown[], actual: unknown[]) => leastDifference(expected, actual, 0, MAX_MESSAGE_DEPTH)
  // only the order differs: they print alike up to four levels deep
  t.is(least([new Set(['a', 'b'])], [new Set(['b', 'a'])]), Infinity)
  t.is(least([new Map<string, unknown>([['a', 1], ['b', { c: 1 }]])], [new Map<string, unknown>([['b', { c: 1 }], ['a', 1]])]), Infinity)
  t.is(least([new Map([[{ k: 1 }, 1], [{ k: 2 }, 2]])], [new Map([[{ k: 2 }, 2], [{ k: 1 }, 1]])]), Infinity)
  t.is(least([new Set([{ k: 1 }, { k: 2 }])], [new Set([{ k: 2 }, { k: 1 }])]), Infinity)
  t.is(least([Object.assign(new Error('m'), { a: 1, b: 2 })], [Object.assign(new Error('m'), { b: 2, a: 1 })]), Infinity)
  t.is(least([Object.assign(function f() { }, { a: 1, b: { c: 2 } })], [Object.assign(function f() { }, { b: { c: 2 }, a: 1 })]), Infinity)
  // the entries of the same key, in another order, one level down
  t.is(least([new Map<string, unknown>([['x', 1], ['a', { b: { c: 2 } }]])], [new Map<string, unknown>([['a', { b: { c: 1 } }], ['x', 1]])]), 2)
  // members that are objects: the least depth at which their texts differ
  t.is(least([new Set<unknown>(['x', { a: { b: 1 } }])], [new Set<unknown>([{ a: { b: 2 } }, 'x'])]), 2)
  t.is(least([new Set<unknown>([{ i: 1 }, { a: { b: 1 } }])], [new Set<unknown>([{ a: { b: 2 } }, { i: 1 }])]), 2)
  // other differences show where they did
  t.is(least([new Set(['a', 'b'])], [new Set(['a', 'c'])]), 0)
  t.is(least([new Map([['a', 1]])], [new Map([['b', 1]])]), 0)
  t.is(least([new Map<unknown, number>([[1, 1], ['a', 2]])], [new Map<unknown, number>([['a', 2], ['1', 1]])]), 0)
  t.is(least([Object.assign(new Error('m'), { a: 1 })], [Object.assign(new Error('m'), { a: 2 })]), 0)
  t.is(least([Object.assign(function f() { }, { a: 1 })], [Object.assign(function g() { }, { a: 1 })]), 0)
  t.is(least([{ f: Object.assign(function f() { }, { a: { b: 1 } }) }], [{ f: Object.assign(function f() { }, { a: { b: 2 } }) }]), 2)
  // a Map or a Set in its order (R11V-5)
  t.is(least([new Map([['a', { b: { c: 1 } }]])], [new Map([['a', { b: { c: 2 } }]])]), 2)
  t.is(least([new Set([{ x: 1 }])], [new Set([{ x: 2 }])]), 1)
})

// ---- E79 (R12-ADV-2): numbering of substitutes, with matchers and key order -----------------------------------------

const NUMBERED = 'The substitutes are numbered in this message (@Substitute#1, @Substitute#2, ...) to tell them apart.'

test('R12-ADV-2 (E79) lines that differ only in which substitute is the argument are numbered also with a matcher elsewhere or keys in another order', t => {
  const app = Substitute.for<any>()
  const plugin = Substitute.for<any>()
  // the code under test subscribes the plugin's handler with a generated id; the test expects the app's handler
  const bus = Substitute.for<any>()
  bus.subscribe({ id: 'sub-81f3', handler: plugin.onEvent })
  const matcher = messageOf(() => bus.received(1).subscribe({ id: Arg.any('string'), handler: app.onEvent }))
  t.true(matcher.includes(NUMBERED), matcher)
  const withMatcher = linesOf(matcher)
  t.is(withMatcher.expected, 'subscribe({ id: Arg.any{string}, handler: @Substitute#2.onEvent })')
  t.deepEqual(withMatcher.received, ["@Substitute#1.subscribe({ id: 'sub-81f3', handler: @Substitute#3.onEvent })"])
  // a DTO built as `{ ...input, id }`
  const other = Substitute.for<any>()
  other.subscribe({ ...{ handler: plugin.onEvent }, id: 'sub-1' })
  const order = messageOf(() => other.received(1).subscribe({ id: 'sub-1', handler: app.onEvent }))
  t.true(order.includes(NUMBERED), order)
  const inOtherOrder = linesOf(order)
  t.is(inOtherOrder.expected, "subscribe({ id: 'sub-1', handler: @Substitute#2.onEvent })")
  t.deepEqual(inOtherOrder.received, ["@Substitute#1.subscribe({ handler: @Substitute#3.onEvent, id: 'sub-1' })"])
  // and a Map in another order (E78)
  const third = Substitute.for<any>()
  third.subscribe(new Map<string, unknown>([['handler', plugin.onEvent], ['id', 1]]))
  const map = messageOf(() => third.received(1).subscribe(new Map<string, unknown>([['id', 1], ['handler', app.onEvent]])))
  t.true(map.includes(NUMBERED), map)
  t.deepEqual(linesOf(map).received, ["@Substitute#1.subscribe(Map(2) { 'handler' => @Substitute#3.onEvent, 'id' => 1 })"])
})

test('R12-ADV-2 (E79) lines that do not differ in which substitute is the argument are not numbered', t => {
  const app = Substitute.for<any>()
  const plugin = Substitute.for<any>()
  // the same substitute, and a matcher that the received value does not satisfy
  const bus = Substitute.for<any>()
  bus.subscribe({ id: 3, handler: plugin.onEvent })
  const rejected = messageOf(() => bus.received(1).subscribe({ id: Arg.is((id: number) => id > 5), handler: plugin.onEvent }))
  t.false(rejected.includes(NUMBERED), rejected)
  t.is(linesOf(rejected).expected, 'subscribe({ id: Arg.is{(id) => id > 5}, handler: @Substitute.onEvent })')
  // lines that print differently in another way
  const other = Substitute.for<any>()
  other.subscribe({ id: 'a', handler: plugin.onEvent })
  const differing = messageOf(() => other.received(1).subscribe({ id: 'b', handler: app.onEvent }))
  t.false(differing.includes(NUMBERED), differing)
  // lines without substitutes are never numbered
  const third = Substitute.for<any>()
  third.subscribe({ handler: 'h', id: 1 }, Arg.any())
  const plain = messageOf(() => third.received(1).subscribe({ id: 1, handler: 'h' }, 2))
  t.false(plain.includes(NUMBERED), plain)
})
