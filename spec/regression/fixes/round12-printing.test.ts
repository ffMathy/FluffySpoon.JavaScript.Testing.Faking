import test from 'ava'
import * as path from 'path'
import { inspect } from 'util'

import * as library from '../../../src'
import { Substitute, Arg } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import {
  DifferenceSearch, MAX_MESSAGE_DEPTH, MESSAGE_BOUNDS, firstVisibleDifference, formatArguments, formatValue, messageBounds
} from '../../../src/internals/utilities/Stringify'

// Round 12: how failure messages print the expected and received calls (fix spec E67-E73), the findings of round 11
// R11V-1..5, R11-ADV-1, R11-ADV-4..6 and R11DOC-1.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of a failing check, without colours and without its "called at" lines. */
const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    // (or the SubstituteException of another copy of the library)
    if (!(error instanceof SubstituteException) && !(error instanceof Error && error.name === 'SubstituteException')) throw error
    return plain((error as Error).message).split('\n').filter(line => !/^\s+called at /.test(line)).join('\n')
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

// ---- E67 (R11V-2, R11-ADV-5): the other keys of arrays ------------------------------------------------------------

test('R11V-2 (E67) arrays that differ only in their other keys (paginated rows, Array subclasses) are printed as deep as that shows', t => {
  const page = (total: number) => Object.assign([{ id: 1 }, { id: 2 }], { total, cursor: 'c2' })
  const view = Substitute.for<any>()
  view.render('users', { model: { list: { users: page(10) } } })
  // 98a8973: render('users', { model: { list: { users: [Array] } } }) on both lines
  const literal = linesOf(messageOf(() => view.received(1).render('users', { model: { list: { users: page(11) } } })))
  t.is(literal.expected, "render('users', { model: { list: { users: [ [Object], [Object], total: 11, cursor: 'c2' ] } } })")
  t.deepEqual(literal.received, ["@Substitute.render('users', { model: { list: { users: [ [Object], [Object], total: 10, cursor: 'c2' ] } } })"])
  // next to a matcher, too (E59)
  const matched = linesOf(messageOf(() => view.received(1).render(Arg.any('string'), { model: { list: { users: page(11) } } })))
  t.is(matched.expected, "render(Arg.any{string}, { model: { list: { users: [ [Object], [Object], total: 11, cursor: 'c2' ] } } })")
  t.deepEqual(matched.received, literal.received)

  class Rows<T> extends Array<T> { }
  const rows = (total: number) => Object.assign(Rows.from([{ id: 1 }]), { total })
  const list = Substitute.for<any>()
  list.render({ model: { list: { users: rows(1) } } })
  const subclass = linesOf(messageOf(() => list.received(1).render({ model: { list: { users: rows(2) } } })))
  t.is(subclass.expected, 'render({ model: { list: { users: Rows(1) [ [Object], total: 2 ] } } })')
  t.deepEqual(subclass.received, ['@Substitute.render({ model: { list: { users: Rows(1) [ [Object], total: 1 ] } } })'])
})

test('R11-ADV-5 (E67) an array whose named property differs further down is printed deeper, as at c503043', t => {
  const s = Substitute.for<any>()
  const made: any = [1, 2]
  made.meta = { a: { b: 1 } }
  const expected: any = [1, 2]
  expected.meta = { a: { b: 2 } }
  s.d({ p: { q: made } })
  // 98a8973: d({ p: { q: [ 1, 2, meta: [Object] ] } }) on both lines
  const lines = linesOf(messageOf(() => s.received(1).d({ p: { q: expected } })))
  t.is(lines.expected, 'd({ p: { q: [ 1, 2, meta: { a: { b: 2 } } ] } })')
  t.deepEqual(lines.received, ['@Substitute.d({ p: { q: [ 1, 2, meta: { a: { b: 1 } } ] } })'])
})

test('R11V-2 (E67) printed copies of arrays, Maps and Sets keep their other keys, as util.inspect shows them', t => {
  // an array is copied for printing when it holds an error (which is printed without its stack)
  const s = Substitute.for<any>()
  s.f(Object.assign([new Error('boom'), { id: 2 }], { total: 10 }))
  // 98a8973: f([ [Error: boom], { id: 2 } ]) on both lines
  const rows = linesOf(messageOf(() => s.received(1).f(Object.assign([new Error('boom'), { id: 2 }], { total: 11 }))))
  t.is(rows.expected, 'f([ [Error: boom], { id: 2 }, total: 11 ])')
  t.deepEqual(rows.received, ['@Substitute.f([ [Error: boom], { id: 2 }, total: 10 ])'])
  // a Set likewise, and a Map with more entries than are shown
  s.g(Object.assign(new Set([new Error('x')]), { label: 'a' }))
  t.true(plain(String(s)).includes("g(Set(1) { [Error: x], label: 'a' })"), plain(String(s)))
  const map = Object.assign(new Map(Array.from({ length: 25 }, (_, index) => [index, index])), { label: 'a' })
  t.true(formatValue(map, false).replace(/\s+/g, ' ').endsWith("19 => 19, label: 'a', ... 5 more items }"), formatValue(map, false))
  // and an array's other keys holding an error show it without its stack, as anywhere else (E45)
  const withError = Object.assign([1], { failure: new TypeError('bad') })
  t.is(formatValue(withError, false), '[ 1, failure: [TypeError: bad] ]')
})

// ---- E68 (R11V-3): the least depth that tells the lines apart -----------------------------------------------------

test('R11V-3 (E68) lines are printed at the least depth at which they print differently, also with several alike lines', t => {
  const config = (max: number) => new Map([['db', { pool: { opts: { max, idle: { ms: 1000 } } } }]])
  const s = Substitute.for<any>()
  s.configure(config(5))
  s.configure(config(6))
  s.configure(config(7))
  // 98a8973: four levels deep, `opts: { max: 10, idle: { ms: 1000 } }`
  const lines = linesOf(messageOf(() => s.received(1).configure(config(10))))
  t.is(lines.expected, "configure(Map(1) { 'db' => { pool: { opts: { max: 10, idle: [Object] } } } })")
  t.deepEqual(lines.received, [5, 6, 7].map(max => `@Substitute.configure(Map(1) { 'db' => { pool: { opts: { max: ${max}, idle: [Object] } } } })`))

  // a value compared by its text (it prints itself): the depth the message prints at is tried before deeper ones
  class Settings extends Map<string, unknown> {
    [inspect.custom](depth: number, options: object) {
      return `Settings ${inspect(new Map(this), { ...options, depth })}`
    }
  }
  const settings = (max: number) => new Settings([['db', { pool: { opts: { max, idle: { ms: 1000 } } } }]])
  const custom = Substitute.for<any>()
  custom.configure(settings(5))
  custom.configure(settings(6))
  custom.configure(settings(7))
  const texts = linesOf(messageOf(() => custom.received(1).configure(settings(10))))
  t.is(texts.expected, "configure(Settings Map(1) { 'db' => { pool: { opts: { max: 10, idle: [Object] } } } })")
  t.deepEqual(texts.received, [5, 6, 7].map(max => `@Substitute.configure(Settings Map(1) { 'db' => { pool: { opts: { max: ${max}, idle: [Object] } } } })`))

  // a Set in an event
  const events = Substitute.for<any>()
  const event = (id: number) => ({ type: 'x', detail: new Set([{ user: { id, prefs: { a: { b: 1 } } } }]) })
  events.emit(event(1))
  events.emit(event(2))
  const emitted = linesOf(messageOf(() => events.received(1).emit(event(3))))
  t.is(emitted.expected, "emit({ type: 'x', detail: Set(1) { { user: { id: 3, prefs: [Object] } } } })")
  t.deepEqual(emitted.received, [1, 2].map(id => `@Substitute.emit({ type: 'x', detail: Set(1) { { user: { id: ${id}, prefs: [Object] } } } })`))
})

// ---- E69 (R11V-1, R11-ADV-1, R11V-5): Maps, Sets, typed arrays and functions with properties ------------------------

test('R11V-1 (E69) next to a matcher, a Set, Map, typed array or function with properties that differs further down is printed deeper', t => {
  const orders = Substitute.for<any>()
  orders.save('ord-1', { order: { meta: { tags: new Set(['gift']) } } })
  // 98a8973: save(Arg.any{string}, { order: { meta: { tags: [Set] } } }) and save('ord-1', { order: { meta: { tags: [Set] } } })
  const set = linesOf(messageOf(() => orders.received(1).save(Arg.any('string'), { order: { meta: { tags: new Set(['express']) } } })))
  t.is(set.expected, "save(Arg.any{string}, { order: { meta: { tags: Set(1) { 'express' } } } })")
  t.deepEqual(set.received, ["@Substitute.save('ord-1', { order: { meta: { tags: Set(1) { 'gift' } } } })"])

  const repo = Substitute.for<any>()
  repo.update({ id: 'u-1', patch: { settings: { flags: new Map([['beta', true]]) } } })
  const map = linesOf(messageOf(() => repo.received(1).update({ id: Arg.any(), patch: { settings: { flags: new Map([['beta', false]]) } } })))
  t.is(map.expected, "update({ id: Arg.any{any}, patch: { settings: { flags: Map(1) { 'beta' => false } } } })")
  t.deepEqual(map.received, ["@Substitute.update({ id: 'u-1', patch: { settings: { flags: Map(1) { 'beta' => true } } } })"])

  const bytes = Substitute.for<any>()
  bytes.save('id-1', { a: { b: { m: new Uint8Array([1]) } } })
  const typed = linesOf(messageOf(() => bytes.received(1).save(Arg.any('string'), { a: { b: { m: new Uint8Array([2]) } } })))
  t.is(typed.expected, 'save(Arg.any{string}, { a: { b: { m: Uint8Array(1) [ 2 ] } } })')
  t.deepEqual(typed.received, ["@Substitute.save('id-1', { a: { b: { m: Uint8Array(1) [ 1 ] } } })"])

  const handlers = Substitute.for<any>()
  handlers.save('id-1', { a: { b: { m: Object.assign(function f() { }, { v: 1 }) } } })
  const fn = linesOf(messageOf(() => handlers.received(1).save(Arg.any('string'), { a: { b: { m: Object.assign(function f() { }, { v: 2 }) } } })))
  t.is(fn.expected, 'save(Arg.any{string}, { a: { b: { m: [Function: f] { v: 2 } } } })')
  t.deepEqual(fn.received, ["@Substitute.save('id-1', { a: { b: { m: [Function: f] { v: 1 } } } })"])
})

test('R11-ADV-1 (E69) next to a matcher, a difference inside a Map or a Set, or under one, is printed deeper', t => {
  const repo = Substitute.for<any>()
  repo.save({ id: 'u-1', meta: { tags: new Map([['k', { a: { b: 1 } }]]) } })
  // 98a8973: `tags: Map(1) { 'k' => [Object] }` on both lines
  const under = linesOf(messageOf(() => repo.received(1).save({ id: Arg.any('string'), meta: { tags: new Map([['k', { a: { b: 2 } }]]) } })))
  t.is(under.expected, "save({ id: Arg.any{string}, meta: { tags: Map(1) { 'k' => { a: { b: 2 } } } } })")
  t.deepEqual(under.received, ["@Substitute.save({ id: 'u-1', meta: { tags: Map(1) { 'k' => { a: { b: 1 } } } } })"])

  const sets = Substitute.for<any>()
  sets.save({ id: 'u-1', a: { b: { s: new Set([1, 2]) } } })
  const inside = linesOf(messageOf(() => sets.received(1).save({ id: Arg.any('string'), a: { b: { s: new Set([1, 3]) } } })))
  t.is(inside.expected, 'save({ id: Arg.any{string}, a: { b: { s: Set(2) { 1, 3 } } } })')
  t.deepEqual(inside.received, ["@Substitute.save({ id: 'u-1', a: { b: { s: Set(2) { 1, 2 } } } })"])

  // a matcher inside a Map is not a matcher (D27): it is compared as the value it is, and prints as its label
  const literal = Substitute.for<any>()
  literal.f('x', new Map([['k', 1]]))
  const kept = linesOf(messageOf(() => literal.received(1).f(Arg.any(), new Map([['k', Arg.any()]]))))
  t.is(kept.expected, "f(Arg.any{any}, Map(1) { 'k' => Arg.any{any} })")
  t.deepEqual(kept.received, ["@Substitute.f('x', Map(1) { 'k' => 1 })"])
})

test('R11V-5 (E69) the comparison looks into Maps and Sets without printing them', t => {
  const leaf = (value: number) => {
    const object: Record<string, unknown> = {}
    for (let key = 0; key < 20; key++) object[`key${key}`] = { deep: { deeper: value } }
    return object
  }
  let printed = 0
  const search = (): DifferenceSearch => ({
    bounds: MESSAGE_BOUNDS,
    maxDepth: MAX_MESSAGE_DEPTH,
    textOf: (value, depth) => {
      printed++
      return formatValue(value, false, messageBounds(depth))
    },
    keys: new Map(),
    entries: 100_000
  })
  // R11V-5's shapes: they print alike up to four levels deep
  const set = (value: number) => ({ s: new Set([{ a: { b: leaf(value) } }]) })
  const map = (value: number) => new Map([['k', { a: { b: { c: leaf(value) } } }]])
  t.is(firstVisibleDifference(search(), [set(1), set(1)], [set(0), set(0)], 2), Infinity)
  t.is(firstVisibleDifference(search(), [map(1)], [map(0)], 2), Infinity)
  t.is(printed, 0)
  // and where they differ, the comparison finds the least depth
  const config = (max: number) => new Map([['db', { pool: { opts: { max, idle: { ms: 1000 } } } }]])
  t.is(firstVisibleDifference(search(), [config(10)], [config(5)], -1), 3)
  t.is(firstVisibleDifference(search(), [new Set([1, 2])], [new Set([1, 2, 3])], -1), 0)
  t.is(firstVisibleDifference(search(), [{ a: { s: new Set([{ x: 1 }]) } }], [{ a: { s: new Set([{ x: 2 }]) } }], -1), 3)
  t.is(firstVisibleDifference(search(), [{ a: { m: new Map([[{ k: 1 }, 1]]) } }], [{ a: { m: new Map([[{ k: 2 }, 1]]) } }], -1), 3)
  t.is(printed, 0)
})

// ---- E70 (R11DOC-1): after the comparison budget ------------------------------------------------------------------

test('R11DOC-1 (E70) after the comparison budget is spent, later lines are printed as deep as the earlier ones, with matchers too', t => {
  // 19 keys four levels down that print alike, and one (`z.y`) that tells some of the lines apart three levels deep
  const wide = (deep: number, shallow: number) => {
    const object: Record<string, unknown> = { z: { y: shallow } }
    for (let key = 0; key < 19; key++) object[`k${key}`] = { c: { d: { e: { f: deep } } } }
    return object
  }
  const shapeOf = (withMatcher: boolean): string => {
    const s = Substitute.for<any>()
    s.f({ id: 'x', a: { b: wide(1, 2) } }) // differs three levels deep
    for (let index = 0; index < 30; index++) s.f({ id: 'x', a: { b: wide(0, 1) } }) // alike up to four levels deep
    for (let index = 0; index < 3; index++) s.f({ id: 'x', a: { b: wide(1, 2) } })
    const message = messageOf(() => s.received(1).f({ id: withMatcher ? Arg.any() : 'x', a: { b: wide(1, 1) } }))
    // D: the line shows `y`, three levels down
    return message.split('\n› ').slice(1).map(line => /y: \d/.test(line) ? 'D' : 's').join('')
  }
  const literal = shapeOf(false)
  t.true(literal.startsWith('DDDDDDDDDDDDDDDDDDDDDDDDDDD'), literal)
  // 98a8973: DDDDDDDDDDDDDDDDDsssssssssssss (the lines after the budget stayed two levels deep)
  t.is(shapeOf(true), literal)
})

// ---- E71 (R11V-4): two copies of the library ----------------------------------------------------------------------

/** Loads a second, independent copy of the package (as duplicate installs do), as duplicate-copies.test.ts does. */
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

test('R11V-4 (E71) with two copies of the library, calls that differ in which substitute is the argument are numbered apart', t => {
  const copyB = loadSecondCopy()
  t.not(copyB.Substitute, Substitute)
  for (const called of [false, true]) {
    const app = copyB.Substitute.for<any>()
    const plugin = Substitute.for<any>()
    if (called) plugin.handler.init()
    app.events.subscribe(plugin.handler)
    const message = messageOf(() => app.events.received(1).subscribe(app.handler))
    // 98a8973: subscribe(@Substitute.handler) on both lines, without numbers
    const lines = linesOf(message)
    t.is(lines.expected, 'subscribe(@Substitute#1.handler)', message)
    t.deepEqual(lines.received, ['@Substitute#1.events.subscribe(@Substitute#2.handler)'], message)
    t.true(message.includes('The substitutes are numbered in this message (@Substitute#1, @Substitute#2, ...) to tell them apart.'), message)
  }
  // a check in either copy, with substitutes of both among the arguments
  const a = Substitute.for<any>()
  const b = copyB.Substitute.for<any>()
  a.child.x(1)
  b.use(a)
  b.use(a.child)
  const numbered = linesOf(messageOf(() => b.received(1).use(b)))
  t.is(numbered.expected, 'use(@Substitute#1)')
  t.deepEqual(numbered.received, ['@Substitute#1.use(@Substitute#2)', '@Substitute#1.use(@Substitute#2.child)'])
  // and the numbers are gone afterwards
  t.is(plain(String(b)), '@Substitute {\n  received:\n    use(@Substitute)\n    use(@Substitute.child)\n}')
})

// ---- E72 (R11-ADV-4): keys in another order -----------------------------------------------------------------------

test('R11-ADV-4 (E72) keys in another order do not keep a DTO that differs further down from being printed deeper', t => {
  const repo = Substitute.for<any>()
  const input = { name: 'Ann', address: { geo: { point: { lat: 59.9, lng: 10.7 } } } }
  repo.save({ ...input, id: 'u-81f3' })
  // 98a8973: `address: { geo: { point: [Object] } }` on both lines
  const matched = linesOf(messageOf(() => repo.received(1).save({ id: Arg.any('string'), name: 'Ann', address: { geo: { point: { lat: 60.4, lng: 5.3 } } } })))
  t.is(matched.expected, "save({ id: Arg.any{string}, name: 'Ann', address: { geo: { point: { lat: 60.4, lng: 5.3 } } } })")
  t.deepEqual(matched.received, ["@Substitute.save({ name: 'Ann', address: { geo: { point: { lat: 59.9, lng: 10.7 } } }, id: 'u-81f3' })"])
  const literal = linesOf(messageOf(() => repo.received(1).save({ id: 'u-81f3', name: 'Ann', address: { geo: { point: { lat: 60.4, lng: 5.3 } } } })))
  t.is(literal.expected, "save({ id: 'u-81f3', name: 'Ann', address: { geo: { point: { lat: 60.4, lng: 5.3 } } } })")
  t.deepEqual(literal.received, matched.received)
  // the same keys in another order are the same keys to the comparison; other keys are not
  const search = { bounds: MESSAGE_BOUNDS, maxDepth: MAX_MESSAGE_DEPTH, textOf: () => '', keys: new Map(), entries: 1000 }
  t.is(firstVisibleDifference(search, [{ a: 1, b: { c: 2 } }], [{ b: { c: 3 }, a: 1 }], -1), 1)
  t.is(firstVisibleDifference(search, [{ a: 1, b: 2 }], [{ b: 2, c: 1 }], -1), 0)
  t.is(firstVisibleDifference(search, [{ a: 1, b: 2 }], [{ b: 2, a: 1 }], -1), Infinity)
})

// ---- E73 (R11-ADV-6): wide arguments --------------------------------------------------------------------------------

test('R11-ADV-6 (E73) a failure message lists the keys of each wide argument once', t => {
  const wide = (value: number) => {
    const object: Record<string, unknown> = { a: { b: { c: { d: value } } } }
    for (let key = 0; key < 5000; key++) object[`k${key}`] = key
    return object
  }
  const s = Substitute.for<any>()
  for (let index = 0; index < 50; index++) s.f('x', wide(1))
  const expected = wide(2)
  const listKeys = Object.keys
  let wideListings = 0
  Object.keys = function keys(object: object) {
    const keys = listKeys(object)
    if (keys.length > 1000) wideListings++
    return keys
  } as typeof Object.keys
  let message: string
  try {
    message = messageOf(() => s.received(1).f('x', expected))
  } finally {
    Object.keys = listKeys
  }
  // the lines differ three levels down: printed two and three levels deep, and compared
  t.true(message.includes('› ✘ @Substitute.f(\'x\', {\n  a: { b: { c: { d: 1 } } },'), message.slice(0, 600))
  // 98a8973: 153 listings (each argument at each depth and in the comparison), c503043: 102; one per argument: 51
  t.true(wideListings <= 51, `${wideListings} listings of 5,000 keys`)
})

// ---- E67-E69: the comparison agrees with the printed texts --------------------------------------------------------

class Point { constructor(readonly x: unknown, readonly y: unknown) { } }

test('R11V-1, R11V-2, R11V-3 (E67-E69) firstVisibleDifference finds the least depth at which calls with Maps, Sets, array keys and typed arrays print differently', t => {
  let seed = 12
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const below = (count: number) => Math.floor(random() * count)
  const leaf = (): unknown => {
    const pick = random()
    if (pick < 0.3) return below(4)
    if (pick < 0.4) return ['a', 'b', 'x'.repeat(250), 'x'.repeat(249) + 'y'][below(4)]
    if (pick < 0.45) return [null, undefined, -0, 0][below(4)]
    if (pick < 0.5) return new Uint8Array([below(2), below(2)])
    if (pick < 0.55) return Object.assign(function named() { }, below(2) === 0 ? {} : { v: below(2) })
    if (pick < 0.6) return new Date(below(2) * 1000)
    if (pick < 0.65) return new Error(`e${below(2)}`)
    return {}
  }
  const build = (level: number): unknown => {
    const pick = random()
    if (level > 6 || pick < 0.25) return leaf()
    if (pick < 0.4) {
      const items = Array.from({ length: below(3) + (random() < 0.05 ? 21 : 0) }, () => build(level + 1))
      return random() < 0.4 ? Object.assign(items, { total: build(level + 1) }) : items
    }
    if (pick < 0.5) return new Map(Array.from({ length: below(3) }, (_, index) => [random() < 0.2 ? { k: index } : `k${index}`, build(level + 1)] as [unknown, unknown]))
    if (pick < 0.58) return new Set(Array.from({ length: below(3) }, () => build(level + 1)))
    if (pick < 0.63) return new Point(build(level + 1), build(level + 1))
    const object: Record<string, unknown> = {}
    const width = below(4)
    for (let index = 0; index < width; index++) object[`k${below(30)}`] = build(level + 1)
    return object
  }
  // a copy, in which the value at one place (a path of keys, Map entries and Set members) can be replaced
  type Place = { get: () => unknown, set: (value: unknown) => void }
  const clone = (value: unknown, places: Place[], depth = 0): unknown => {
    if (typeof value !== 'object' || value === null || types(value) === 'other') return value
    let copy: any
    const visit = (get: () => unknown, set: (value: unknown) => void) => { if (depth < 7) places.push({ get, set }) }
    if (value instanceof Map) {
      copy = new Map()
      for (const [key, item] of value) {
        copy.set(key, clone(item, places, depth + 1))
        visit(() => copy.get(key), replaced => copy.set(key, replaced))
      }
      return copy
    }
    if (value instanceof Set) {
      // (a Set's member is replaced by rebuilding the Set in its order)
      const members = [...value].map(member => clone(member, places, depth + 1))
      copy = new Set(members)
      members.forEach((_, index) => visit(() => [...copy][index], replaced => {
        const next = [...copy]
        next[index] = replaced
        copy.clear()
        for (const member of next) copy.add(member)
      }))
      return copy
    }
    if (value instanceof Point) {
      copy = new Point(clone(value.x, places, depth + 1), clone(value.y, places, depth + 1))
      return copy
    }
    copy = Array.isArray(value) ? [] : {}
    for (const key of Object.keys(value)) {
      copy[key] = clone((value as any)[key], places, depth + 1)
      visit(() => copy[key], replaced => { copy[key] = replaced })
    }
    return copy
  }
  function types(value: object): string {
    return value instanceof Map || value instanceof Set || value instanceof Point || Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype ? 'container' : 'other'
  }
  const textAt = (args: unknown[], depth: number) => formatArguments(args, false, messageBounds(depth), value => formatValue(value, false, messageBounds(depth)))

  let compared = 0
  let deeper = 0
  let collections = 0
  for (let sample = 0; sample < 600; sample++) {
    const expected = [build(0)]
    const places: Place[] = []
    const actual = [clone(expected[0], places)]
    if (places.length === 0) continue
    places[below(places.length)].set(random() < 0.3 ? build(3) : leaf())
    const search = { bounds: MESSAGE_BOUNDS, maxDepth: MAX_MESSAGE_DEPTH, textOf: (value: unknown, depth: number) => formatValue(value, false, messageBounds(depth)), keys: new Map(), entries: 100_000 }
    const depth = firstVisibleDifference(search, expected, actual, -1)
    compared++
    if (/Map|Set/.test(textAt(expected, MAX_MESSAGE_DEPTH))) collections++
    for (let shallower = 0; shallower < Math.min(depth, MAX_MESSAGE_DEPTH + 1); shallower++)
      t.is(textAt(actual, shallower), textAt(expected, shallower), `sample ${sample}: alike ${shallower} levels deep`)
    if (depth <= MAX_MESSAGE_DEPTH) {
      if (depth > 1) deeper++
      const text = textAt(expected, depth)
      // (unless the difference is in a part that is cut off)
      if (!text.includes('more characters)')) t.not(textAt(actual, depth), text, `sample ${sample}: different ${depth} levels deep`)
    }
  }
  t.true(compared > 250 && deeper > 50 && collections > 100, `${compared} compared, ${deeper} different deeper down, ${collections} with Maps or Sets`)
})
