import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { inspect, isDeepStrictEqual } from 'util'

import { Substitute, Arg, configure } from '../../../src'
import { FALLBACK_HASH, hashArguments, identityHashArguments, structuralHash } from '../../../src/internals/utilities/ArgumentHash'

// Round 3, D35: the structural hash behind the auto-substitute cache and the index of literal substitutions.

/** A small deterministic PRNG (mulberry32), so that a failure can be reproduced. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

class Point { constructor(public x: unknown, public y: unknown) { } }
class Empty { }

const sharedSymbols = [Symbol('a'), Symbol('b'), Symbol.for('registered'), Symbol()]
const sharedFunctions = [() => 1, function named() { }, Substitute.for<any>(), Substitute.for<any>().member]

type Next = () => number

const generate = (next: Next, depth: number): unknown => {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
  const leaf = () => pick<() => unknown>([
    () => undefined, () => null, () => next() < 0.5,
    () => pick([0, -0, 1, -1, 2 ** 31, -(2 ** 31) - 1, 1.5, -2.25, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE]),
    () => Math.floor(next() * 1000),
    () => pick(['', 'a', 'b', 'ab', 'ba', 'é', '😀', 'x'.repeat(100), 'x'.repeat(99) + 'y']),
    () => BigInt(Math.floor(next() * 5)),
    () => pick(sharedSymbols),
    () => pick(sharedFunctions),
    () => new Date(pick([0, 1, 1e12])), // invalid Dates are never deep strictly equal, not even to themselves' copies
    () => pick([/a/, /a/g, /b/i, new RegExp('a', 'gi')]),
    () => pick<() => unknown>([() => new Number(pick([0, -0, 1, NaN])), () => new String(pick(['', 'a'])), () => new Boolean(next() < 0.5),
      () => Object(pick(sharedSymbols)), () => Object(BigInt(pick([0, 1])))])(),
    () => pick<() => unknown>([
      () => new Uint8Array([1, 2, 3].slice(0, Math.floor(next() * 4))),
      () => Buffer.from(pick(['', 'ab', 'abc'])),
      () => new Float64Array([pick([0, -0, NaN, 1.5])]),
      () => new Int16Array([Math.floor(next() * 3)]),
      () => new Uint8Array([1, 2]).buffer,
      () => new DataView(new Uint8Array([Math.floor(next() * 3)]).buffer)
    ])()
  ])()
  if (depth <= 0 || next() < 0.35) return leaf()
  const size = Math.floor(next() * 4)
  const children = () => Array.from({ length: size }, () => generate(next, depth - 1))
  return pick<() => unknown>([
    () => children(),
    () => { const sparse = new Array(size + 1); if (size > 0) sparse[0] = generate(next, depth - 1); return sparse },
    () => Object.fromEntries(children().map((value, index) => [pick(['a', 'b', 'c', 'd']) + index, value])),
    () => Object.assign(Object.create(null), { k: generate(next, depth - 1) }),
    () => new Point(generate(next, depth - 1), generate(next, depth - 1)),
    () => new Empty(),
    () => ({ [pick(sharedSymbols)]: generate(next, depth - 1), plain: size }),
    () => { const hidden = { visible: size }; Object.defineProperty(hidden, pick(sharedSymbols), { value: next(), enumerable: false }); return hidden },
    () => new Map(children().map((value, index) => [index % 2 === 0 ? index : { key: index }, value])),
    () => new Set(children()),
    () => [generate(next, depth - 1), { nested: [generate(next, depth - 1)] }]
  ])()
}

const shuffle = <T>(next: Next, items: T[]): T[] => {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1))
    ;[items[index], items[other]] = [items[other], items[index]]
  }
  return items
}

/** A deep strictly equal copy with other identities, other key orders and other Map/Set insertion orders. */
const copy = (next: Next, value: unknown, seen = new Map<object, unknown>()): unknown => {
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const result: unknown[] = new Array(value.length)
    seen.set(value, result)
    for (const key of Object.keys(value)) (result as any)[key] = copy(next, (value as any)[key], seen)
    return result
  }
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
    return value instanceof DataView ? new DataView(bytes.buffer) : new (value.constructor as any)(bytes.buffer)
  }
  if (value instanceof ArrayBuffer) return value.slice(0)
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)
  if (value instanceof Map) return new Map(shuffle(next, [...value].map(([k, v]) => [copy(next, k, seen), copy(next, v, seen)])))
  if (value instanceof Set) return new Set(shuffle(next, [...value].map(item => copy(next, item, seen))))
  if (value instanceof Number || value instanceof String || value instanceof Boolean || value instanceof Symbol || value instanceof BigInt)
    return Object(value.valueOf())
  const result = Object.create(Object.getPrototypeOf(value))
  seen.set(value, result)
  for (const key of shuffle(next, Reflect.ownKeys(value))) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    Object.defineProperty(result, key, { ...descriptor, value: copy(next, descriptor.value, seen) })
  }
  return result
}

test('ENG2-2 (D35) the structural hash is consistent with isDeepStrictEqual (property test over generated values)', t => {
  const next = random(20261116)
  const values: unknown[] = []
  let equalPairs = 0
  for (let index = 0; index < 4000; index++) {
    const value = generate(next, 4)
    values.push(value)
    const twin = copy(next, value)
    t.true(isDeepStrictEqual(value, twin), 'the copy is deep strictly equal')
    if (structuralHash(value) !== structuralHash(twin) || hashArguments([value, 1]) !== hashArguments([twin, 1]))
      t.fail(`equal values hash differently: ${String(index)}`)
    equalPairs++
  }

  // random pairs: equal ones must hash equal; unequal ones should rarely collide
  let unequal = 0
  let collisions = 0
  for (let index = 0; index < 20000; index++) {
    const a = values[Math.floor(next() * values.length)]
    const b = values[Math.floor(next() * values.length)]
    const sameHash = structuralHash(a) === structuralHash(b)
    if (isDeepStrictEqual(a, b)) {
      equalPairs++
      if (!sameHash) t.fail('equal values hash differently')
    } else {
      unequal++
      if (sameHash) collisions++
    }
  }
  t.true(equalPairs > 4000)
  t.true(unequal > 1000)
  // only values that differ in what the hash leaves out collide: prototypes, holes, non-enumerable keys, symbols
  // with the same description, ...
  t.true(collisions / unequal < 0.05, `${collisions} collisions in ${unequal} unequal pairs`)
})

test('ENG2-2 (D35) the structural hash: special values, and values that cannot be hashed never crash', t => {
  const same = (a: unknown, b: unknown, message: string) => {
    t.true(isDeepStrictEqual(a, b), message)
    t.is(structuralHash(a), structuralHash(b), message)
  }
  same(NaN, NaN, 'NaN')
  same([NaN], [Number.NaN], 'NaN in arrays')
  same(new Number(NaN), new Number(NaN), 'boxed NaN')
  t.false(isDeepStrictEqual(0, -0))
  same({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }, 'key order')
  same(new Map([[1, 'a'], [2, 'b']]), new Map([[2, 'b'], [1, 'a']]), 'Map order')
  same(new Map([[{ k: 1 }, 'a']]), new Map([[{ k: 1 }, 'a']]), 'Map object keys')
  same(new Set([1, { a: 2 }]), new Set([{ a: 2 }, 1]), 'Set order')
  same(new Date(5), new Date(5), 'Dates')
  // Node.js changed this in 24: two invalid Dates are unequal up to Node.js 22 and equal from 24 on. The hash only
  // has to agree with whatever the running Node.js decides.
  if (isDeepStrictEqual(new Date(NaN), new Date(NaN))) {
    t.is(structuralHash(new Date(NaN)), structuralHash(new Date('nope')), 'invalid Dates, where Node.js finds them equal')
  }
  same(/x/gi, new RegExp('x', 'gi'), 'RegExps')
  same(Buffer.from('abc'), Buffer.from('abc'), 'Buffers')
  same(new Float64Array([-0, NaN]), new Float64Array([-0, NaN]), 'typed arrays')
  same(Object.assign(Object.create(null), { a: 1 }), Object.assign(Object.create(null), { a: 1 }), 'null prototype')
  same(new Point(1, { z: 2 }), new Point(1, { z: 2 }), 'class instances')
  const symbol = Symbol('key')
  same({ [symbol]: 1, a: 2 }, { a: 2, [symbol]: 1 }, 'symbol keys')
  same('x'.repeat(1000) + 'a', 'x'.repeat(1000) + 'a', 'long strings')
  const sparse = [1, , 3] // eslint-disable-line no-sparse-arrays
  same(sparse, [1, , 3], 'sparse arrays') // eslint-disable-line no-sparse-arrays

  // values that differ get different hashes (not required by the contract, but the index relies on it in practice)
  const differ = (a: unknown, b: unknown, message: string) => t.not(structuralHash(a), structuralHash(b), message)
  differ('x'.repeat(70) + 'a', 'x'.repeat(70) + 'b', 'long strings with a common prefix')
  differ(Buffer.from('abcdefghijklmnop'), Buffer.from('abcdefghijklmnoq'), 'Buffers of the same length')
  differ({ order: { customer: { id: 1 } } }, { order: { customer: { id: 2 } } }, 'deep objects')
  differ(Array.from({ length: 20 }, (_, i) => i), Array.from({ length: 20 }, (_, i) => (i === 19 ? -1 : i)), 'long arrays')
  differ(new Map([[1, 2]]), new Map([[1, 3]]), 'Maps of the same size')
  differ(new Set([1]), new Set([2]), 'Sets of the same size')
  differ(new Date(1), new Date(2), 'Dates')
  differ(Symbol('a'), Symbol('b'), 'symbols with other descriptions')

  // cycles (also cycles of a different shape that are deep strictly equal), throwing getters, revoked proxies
  const cyclic: any = { name: 'a' }
  cyclic.self = cyclic
  const longer: any = { name: 'a', self: { name: 'a' } }
  longer.self.self = longer
  // Node.js up to 22 finds these two equal, Node.js 24 and later do not; the hash must agree in both cases
  t.is(structuralHash(cyclic), FALLBACK_HASH)
  t.is(structuralHash(longer), FALLBACK_HASH)
  const throwing = { get value(): never { throw new Error('getter') } }
  t.is(structuralHash(throwing), FALLBACK_HASH)
  t.is(hashArguments([1, throwing]), FALLBACK_HASH)
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  t.is(structuralHash(proxy), FALLBACK_HASH)
  const wide: any[] = []
  for (let index = 0; index < 20; index++) wide.push(wide.length === 0 ? {} : [wide[index - 1], wide[index - 1]])
  t.is(structuralHash(wide[19]), FALLBACK_HASH, 'more nested objects than the limit (through shared references)')

  // substitutes and functions by identity, never traversed
  const substitute = Substitute.for<any>()
  t.is(structuralHash(substitute), structuralHash(substitute))
  t.not(structuralHash(substitute), structuralHash(Substitute.for<any>()))
  t.is(inspect(substitute), '@Substitute {\n}', 'nothing about it was recorded')

  // the identity hash is only there for arguments with objects
  t.is(identityHashArguments([1, 'a', () => 1]), undefined)
  const object = { a: 1 }
  t.is(identityHashArguments([object]), identityHashArguments([object]))
  t.not(identityHashArguments([object]), identityHashArguments([{ a: 1 }]))
})

/** Runs a script with the library in a child process with --expose-gc, and returns what it prints as JSON. */
const measure = (script: string): any => {
  const library = path.resolve(__dirname, '../../../src/index.js')
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', `
    const { Substitute, Arg } = require(${JSON.stringify(library)})
    const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed }
    ${script}
  `], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

test('ENG2-9 (D30) an unconfigured call with distinct arguments costs little memory beyond its record', t => {
  const { unconfigured, configured } = measure(`
    const bytesPerCall = configure => {
      const calls = 50000
      const before = heap()
      const logger = Substitute.for()
      if (configure) logger.log(Arg.any()).returns(undefined)
      for (let index = 0; index < calls; index++) logger.log(index)
      const bytes = (heap() - before) / calls
      if (logger.log(1) === null) console.log('keeps the substitute alive until here')
      return Math.round(bytes)
    }
    console.log(JSON.stringify({ configured: bytesPerCall(true), unconfigured: bytesPerCall(false) }))
  `)
  t.log(`bytes per call: ${unconfigured} unconfigured (an auto-substitute each), ${configured} configured (the record only)`)
  // before D30 the auto-substitute cost about 1 KB more than the record (Node 22: 1309 against 279 bytes)
  t.true(unconfigured - configured < 450, `${unconfigured} - ${configured} bytes per call`)
})

test('ENG2-10 (D30) hashing does not keep symbols alive after the substitute that saw them is gone', t => {
  const { retained } = measure(`
    const before = heap()
    const run = () => {
      const emitter = Substitute.for()
      emitter.emit(0).returns(1)
      for (let index = 0; index < 100000; index++) emitter.emit(Symbol('event-' + index))
    }
    run()
    console.log(JSON.stringify({ retained: (heap() - before) / 1048576 }))
  `)
  t.log(`${retained.toFixed(2)} MB retained`)
  t.true(retained < 2, `${retained} MB retained`)
})

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}
const bestOfThree = (run: () => void) => Math.min(millisecondsOf(run), millisecondsOf(run), millisecondsOf(run))

const shapes: Array<[string, (index: number) => unknown]> = [
  ['nested objects', index => ({ order: { customer: { id: index } } })],
  ['Buffers', index => Buffer.from(`payload-${String(index).padStart(8, '0')}`)],
  ['long strings with a common prefix', index => `${'x'.repeat(70)}${index}`],
  ['arrays of 20 items', index => Array.from({ length: 20 }, (_, item) => (item === 19 ? index : item))],
  ['Maps', index => new Map([['id', index]])],
  ['Sets', index => new Set([index])],
  ['Dates', index => new Date(index)]
]

test('ENG2-2 (D35) 10k unconfigured calls with arguments of any shape finish well under 1s', t => {
  for (const [name, argument] of shapes) {
    const run = () => {
      const repository = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) repository.save(argument(index))
    }
    run() // warm up
    const elapsed = bestOfThree(run)
    t.true(elapsed < 1000, `${name}: ${elapsed} ms`)
  }

  // the cache still gives the same auto-substitute for equal arguments
  const repository = Substitute.for<any>()
  for (const [name, argument] of shapes) t.is(repository.save(argument(7)), repository.save(argument(7)), name)
})

test('V2-5 (D35) 4000 object-argument setups and 4000 matching calls finish well under 1s', t => {
  const run = () => {
    const finder = Substitute.for<any>()
    for (let index = 0; index < 4_000; index++) finder.find({ id: index, tags: [index] }).returns(index)
    for (let index = 0; index < 4_000; index++) if (finder.find({ id: index, tags: [index] }) !== index) throw new Error(`find(${index})`)
    for (let index = 0; index < 4_000; index++) finder.find({ id: -index - 1, tags: [] })
  }
  run() // warm up
  const elapsed = bestOfThree(run)
  t.true(elapsed < 1000, `took ${elapsed} ms`)

  // through configure(), and with matcher setups next to the literal ones
  const finder = Substitute.for<any>()
  finder.find(Arg.any()).returns('any')
  const configured = millisecondsOf(() => {
    for (let index = 0; index < 4_000; index++) finder[configure]().find([index, { nested: index }]).returns(index)
    for (let index = 0; index < 4_000; index++) if (finder.find([index, { nested: index }]) !== index) throw new Error(`find(${index})`)
  })
  t.true(configured < 1000, `took ${configured} ms through configure()`)
  t.is(finder.find([1, { nested: 2 }]), 'any')
})
