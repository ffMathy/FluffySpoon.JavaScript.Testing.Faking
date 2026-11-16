import test, { ExecutionContext } from 'ava'
import { inspect, isDeepStrictEqual, types } from 'util'

import { Substitute, Arg } from '../../../src'
import { FALLBACK_HASH, hashArguments, refinedHashArguments, refinedStructuralHash, structuralHash } from '../../../src/internals/utilities/ArgumentHash'
import { RecordedArguments } from '../../../src/internals/RecordedArguments'

// Round 4, E3 (R3-ADV-2, R3-1): the structural hash costs a bounded amount per argument, whatever its size or shape,
// and it still never separates values that the RUNNING Node.js finds deep strictly equal. Only that agreement is
// asserted: Node.js itself changed its rules (invalid Dates and cycles of a different shape, errors' cause).

/** A small deterministic PRNG (mulberry32), so that a failure can be reproduced. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
type Next = () => number

class Point { constructor(public x: unknown, public y: unknown) { } }

const Aggregate = (globalThis as any).AggregateError as (new (errors: unknown[], message: string) => Error) | undefined
const sharedSymbols = [Symbol('a'), Symbol.for('registered')]
const sharedFunctions = [() => 1, Substitute.for<any>()]
const middle = (char: string, half: number) => 'm'.repeat(half) + char + 'm'.repeat(half)
/**
 * R4-ADV-4 (E10): an object that inherits from Error.prototype without being a native error, optionally with the
 * toStringTag of an error. Node.js compares such objects as errors, and finds them deep strictly equal to a native error
 * with the same message when they have the tag.
 */
const errorLike = (message: string, tagged: boolean): Error => Object.create(Error.prototype, {
  message: { value: message, writable: true, configurable: true },
  ...(tagged ? { [Symbol.toStringTag]: { value: 'Error', configurable: true } } : {})
})

/** Builds an object with these entries, in a random insertion order. */
const objectOf = (next: Next, entries: Array<[PropertyKey, unknown]>): Record<PropertyKey, unknown> => {
  const result: Record<PropertyKey, unknown> = {}
  for (const [key, value] of shuffle(next, entries)) result[key as any] = value
  return result
}

const shuffle = <T>(next: Next, items: T[]): T[] => {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1))
    ;[items[index], items[other]] = [items[other], items[index]]
  }
  return items
}

/**
 * R5V-1 / R5-ADV-1 (E13, round 6): values with as many keys or entries as the limits of the hash, and on both sides of
 * them: 256 (wide containers above, each entry with a budget of its own), 1,025 string keys (families) and 65,536 (a
 * sample of the values above). The widest ones are built once and shared (generated values refer to them, and copies
 * copy them).
 */
const sharedWide: unknown[] = []
const widest = (): unknown[] => {
  if (sharedWide.length === 0) {
    for (const size of [65_535, 65_536, 65_537]) {
      sharedWide.push(Object.fromEntries(Array.from({ length: size }, (_, index) => [`h${index}`, index % 7])))
      sharedWide.push(new Map(Array.from({ length: size }, (_, index): [unknown, number] => [index % 1000 === 0 ? { index } : `h${index}`, index % 7])))
    }
  }
  return sharedWide
}

/** R5V-1 (E13, round 6): records shared by the tables below (copies copy them, other values refer to the same ones). */
const sharedRecords = Array.from({ length: 4 }, (_, index) => ({ id: index, name: `r${index}` }))

const generateWide = (next: Next, depth: number): unknown => {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
  if (next() < 0.05) return pick(widest())
  const size = pick([255, 256, 257, 1024, 1025, 1026])
  // two key sets, values that differ in a few places: independently generated values are often equal
  const prefix = pick(['k', 'q'])
  const special = (index: number) => index === 3 ? generate(next, depth - 1) : index === size - 1 ? pick([1, 2]) : index
  // E13 (round 6): records as the values of wide containers, hashed with a small budget each; they differ in a few
  // places (a field, a nested field, a shared record), so that tables of records are often equal as well
  const record = (index: number): unknown => index === 4 ? pick(sharedRecords)
    : index === 5 ? { id: index, name: pick(['a', 'b']) }
    : index === 6 ? { id: index, address: { city: pick(['x', 'y']) } }
    : index === 7 ? generate(next, depth - 1)
    : { id: index }
  const keyed = (count: number, value: (index: number) => unknown) =>
    objectOf(next, Array.from({ length: count }, (_, index): [PropertyKey, unknown] => [`${prefix}${index}`, value(index)]))
  return pick<() => unknown>([
    () => keyed(size, special),
    () => new Map(shuffle(next, Array.from({ length: Math.min(size, 257) }, (_, index): [unknown, unknown] => [index % 50 === 0 ? { index } : `${prefix}${index}`, special(index)]))),
    () => new Set(shuffle(next, Array.from({ length: Math.min(size, 257) }, (_, index) => special(index)))),
    // tables of records: a wide object, a Map with object keys and a Set of records
    () => keyed(size, record),
    () => new Map(shuffle(next, Array.from({ length: Math.min(size, 300) }, (_, index): [unknown, unknown] => [index === 8 ? { key: pick([1, 2]) } : { key: index }, record(index)]))),
    () => new Set(shuffle(next, Array.from({ length: Math.min(size, 300) }, (_, index) => record(index)))),
    // a table of tables (a wide container inside an entry counts as a constant), and a cycle through a wide container
    () => keyed(300, index => index === 2 ? keyed(300, record) : index === 9 ? new Set(Array.from({ length: 300 }, (_, member) => member === 1 ? pick([1, 2]) : -member)) : index),
    () => { const table: any = keyed(size, record); table.self = table; return table }
  ])()
}

/**
 * Values from small domains, so that independently generated values are often deep strictly equal: with keys inserted
 * in other orders, cycles of other shapes, other identities.
 */
const generate = (next: Next, depth: number): unknown => {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
  if (depth > 0 && next() < 0.01) return generateWide(next, depth)
  const leaf = () => pick<() => unknown>([
    () => undefined, () => null, () => next() < 0.5, () => pick([0, -0, 1, NaN, 1.5]),
    () => pick(['', 'a', 'b']),
    // long strings that differ only in the middle, hashed in full and sampled
    () => middle(pick(['a', 'b']), 1500), () => middle(pick(['a', 'b']), 6000),
    () => pick(sharedSymbols), () => pick(sharedFunctions),
    // invalid Dates: Node.js 24 and later find two of them equal, earlier versions do not
    () => new Date(pick([0, 1, NaN])),
    // errors: the same or another message, other classes, extra properties, a cause
    () => new (pick([Error, TypeError]))(pick(['a', 'b'])),
    () => Object.assign(new Error(pick(['a', 'b'])), { code: pick([1, 2]) }),
    () => new (Error as any)('a', { cause: pick([1, 2, undefined]) }),
    () => Aggregate === undefined ? new Error('a') : new Aggregate([pick([1, 2])], 'a'),
    // R4-ADV-4 (E10): error-like objects, which can be deep strictly equal to the native errors above
    () => errorLike(pick(['a', 'b']), next() < 0.5),
    // and native errors that Object.prototype.toString shows as [object Object]: Node.js compares those by their keys
    () => Object.defineProperty(new Error(pick(['a', 'b'])), Symbol.toStringTag, { value: 'Object', configurable: true }),
    () => Buffer.from(pick(['', 'ab']))
  ])()
  if (depth <= 0 || next() < 0.3) return leaf()
  const size = Math.floor(next() * 3)
  const child = () => generate(next, depth - 1)
  return pick<() => unknown>([
    () => Array.from({ length: size }, child),
    () => objectOf(next, Array.from({ length: size }, (_, index): [PropertyKey, unknown] => [pick(['a', 'b', 'c']) + index, child()])),
    () => objectOf(next, [[pick(sharedSymbols), child()], ['plain', size]]),
    () => new Point(child(), child()),
    // E13 (round 6): plain objects are hashed without further checks: objects without a prototype, arguments objects
    () => Object.assign(Object.create(null), objectOf(next, [['a', child()], ['b', pick([1, 2])]])),
    () => (function (..._: unknown[]) { return arguments })(...Array.from({ length: size }, child)),
    () => new Map(shuffle(next, Array.from({ length: size }, (_, index): [unknown, unknown] => [index % 2 === 0 ? index : { key: index }, child()]))),
    () => new Set(shuffle(next, Array.from({ length: size }, child))),
    // cycles of several shapes: a self reference, a child-to-parent back-reference, a cycle through two objects
    () => { const node: any = objectOf(next, [['name', pick(['a', 'b'])]]); node.self = node; return node },
    () => { const node: any = { name: pick(['a', 'b']) }; node.self = { name: node.name, self: node }; return node },
    () => { const parent: any = objectOf(next, [['id', pick([1, 2])], ['children', [] as unknown[]]]); parent.children.push(objectOf(next, [['parent', parent], ['value', child()]])); return parent },
    () => { const list: any[] = [pick([1, 2])]; list.push(list); return list },
    // wide and long values, sampled or hashed shallowly
    () => Array.from({ length: 300 }, (_, index) => (index === 150 ? child() : index)),
    () => objectOf(next, Array.from({ length: 300 }, (_, index): [PropertyKey, unknown] => [`k${index}`, index === 7 ? child() : index])),
    () => new Map(shuffle(next, Array.from({ length: 300 }, (_, index): [unknown, unknown] => [index === 0 ? { key: pick([1, 2]) } : index, index === 1 ? child() : index]))),
    () => new Set(shuffle(next, Array.from({ length: 300 }, (_, index) => (index === 0 ? child() : index))))
  ])()
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
  if (types.isArgumentsObject(value)) return (function (..._: unknown[]) { return arguments })(...Array.from(value as ArrayLike<unknown>, item => copy(next, item, seen)))
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof Map) {
    const result = new Map()
    seen.set(value, result)
    for (const [k, v] of shuffle(next, [...value])) result.set(copy(next, k, seen), copy(next, v, seen))
    return result
  }
  if (value instanceof Set) {
    const result = new Set()
    seen.set(value, result)
    for (const item of shuffle(next, [...value])) result.add(copy(next, item, seen))
    return result
  }
  // a native error of the same class, with the same own properties (cause, errors, extras), but another stack
  const result = types.isNativeError(value)
    ? Object.setPrototypeOf(new Error((value as Error).message), Object.getPrototypeOf(value))
    : Object.create(Object.getPrototypeOf(value))
  seen.set(value, result)
  for (const key of shuffle(next, Reflect.ownKeys(value))) {
    if (key === 'stack') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    // an accessor (the callee of a strict arguments object) is kept as it is
    Object.defineProperty(result, key, 'value' in descriptor ? { ...descriptor, value: copy(next, descriptor.value, seen) } : descriptor)
  }
  return result
}

/**
 * isDeepStrictEqual, or false when it throws: Node.js 22 can throw a TypeError on some Sets that hold null and
 * objects. The library treats such a comparison as unequal as well (see RecordedArguments).
 */
const deepStrictEqual = (a: unknown, b: unknown): boolean => {
  try {
    return isDeepStrictEqual(a, b)
  } catch {
    return false
  }
}

/** A short description of a generated value for a failure message. */
const describe = (value: unknown): string =>
  inspect(value, { depth: 3, breakLength: Infinity, maxArrayLength: 6, maxStringLength: 20, showHidden: true }).slice(0, 600)

const hashesAgree = (t: ExecutionContext, a: unknown, b: unknown, message: string): boolean => {
  if (!deepStrictEqual(a, b)) return false
  if (structuralHash(a) !== structuralHash(b) || hashArguments([a, 1]) !== hashArguments([b, 1])) t.fail(`equal values hash differently: ${message}: ${describe(a)} and ${describe(b)}`)
  // E13: the refined hashes (without families), which tell apart candidates with the same hash, agree as well
  if (refinedStructuralHash(a) !== refinedStructuralHash(b) || refinedHashArguments([a, 1]) !== refinedHashArguments([b, 1])) t.fail(`equal values have other refined hashes: ${message}: ${describe(a)} and ${describe(b)}`)
  return true
}

test('R3-ADV-2 / R3-1 (E3) the bounded hash agrees with the running Node.js isDeepStrictEqual (property test)', t => {
  const next = random(20261117)
  const values: unknown[] = []
  let equalPairs = 0
  for (let index = 0; index < 3000; index++) {
    const value = generate(next, 4)
    values.push(value)
    const twin = copy(next, value)
    // a copy is equal unless Node.js finds the value unequal to itself (an invalid Date up to Node.js 22)
    if (hashesAgree(t, value, twin, `copy ${index}`)) equalPairs++
    t.not(structuralHash(value), FALLBACK_HASH, 'every generated value can be hashed (cycles included)')
  }

  let unequal = 0
  let collisions = 0
  for (let index = 0; index < 30000; index++) {
    const a = values[Math.floor(next() * values.length)]
    const b = values[Math.floor(next() * values.length)]
    if (hashesAgree(t, a, b, `pair ${index}`)) equalPairs++
    else {
      unequal++
      if (structuralHash(a) === structuralHash(b)) collisions++
    }
  }
  t.log(`${equalPairs} equal pairs, ${unequal} unequal pairs, ${collisions} collisions`)
  t.true(equalPairs > 3000, `${equalPairs} equal pairs`)
  t.true(unequal > 1000)
  // only values that differ in what the hash leaves out collide: prototypes, holes, deep or sampled parts, ...
  t.true(collisions / unequal < 0.1, `${collisions} collisions in ${unequal} unequal pairs`)
})

test('R5V-1 / R5-ADV-1 (E13) wide objects, Maps and Sets around every limit agree with the running Node.js isDeepStrictEqual (property test)', t => {
  // round 6: only wide values (the test above meets one now and then), with records, tables of tables and cycles
  const next = random(20261116)
  const values: unknown[] = []
  let equalPairs = 0
  for (let index = 0; index < 400; index++) {
    const value = generateWide(next, 3)
    values.push(value)
    if (hashesAgree(t, value, copy(next, value), `copy ${index}`)) equalPairs++
    t.not(structuralHash(value), FALLBACK_HASH)
  }
  let unequal = 0
  let collisions = 0
  for (let index = 0; index < 4000; index++) {
    const a = values[Math.floor(next() * values.length)]
    const b = values[Math.floor(next() * values.length)]
    if (hashesAgree(t, a, b, `pair ${index}`)) equalPairs++
    else {
      unequal++
      if (structuralHash(a) === structuralHash(b)) collisions++
    }
  }
  t.log(`${equalPairs} equal pairs, ${unequal} unequal pairs, ${collisions} collisions`)
  t.true(equalPairs > 400 && unequal > 1000, `${equalPairs} equal pairs, ${unequal} unequal pairs`)
  t.true(collisions / unequal < 0.1, `${collisions} collisions in ${unequal} unequal pairs`)
})

test('R3-ADV-2 / R3-1 (E3) cycles, errors, invalid Dates, long strings and key orders, value by value', t => {
  const agree = (a: unknown, b: unknown, message: string) => {
    hashesAgree(t, a, b, message)
    t.not(structuralHash(a), FALLBACK_HASH, message)
  }
  const differ = (a: unknown, b: unknown, message: string) => {
    t.false(deepStrictEqual(a, b), message)
    t.not(structuralHash(a), structuralHash(b), message)
  }

  // cycles of different shapes unroll to the same tree, so they hash the same whatever Node.js decides about them
  const cyclic: any = { name: 'a' }
  cyclic.self = cyclic
  const longer: any = { name: 'a', self: { name: 'a' } }
  longer.self.self = longer
  t.is(structuralHash(cyclic), structuralHash(longer))
  agree(cyclic, longer, 'cycles of a different shape')
  const parent: any = { id: 1, children: [] }
  parent.children.push({ parent })
  const otherParent: any = { children: [], id: 1 }
  otherParent.children.push({ parent: otherParent })
  agree(parent, otherParent, 'a child-to-parent back-reference')
  differ(parent, { id: 2, children: [{ parent }] }, 'back-references with other ids')

  // invalid Dates: equal from Node.js 24 on, never equal before; the hash agrees in both cases
  agree(new Date(NaN), new Date('nope'), 'invalid Dates')

  // errors: name and message (and cause, errors where the running Node.js compares them)
  agree(new Error('a'), new Error('a'), 'errors with the same message')
  differ(new Error('request 1 failed'), new Error('request 2 failed'), 'errors with other messages')
  differ(new TypeError('a'), new RangeError('a'), 'errors of other classes')
  agree(Object.assign(new Error('a'), { code: 1 }), Object.assign(new Error('a'), { code: 1 }), 'errors with extra properties')
  differ(Object.assign(new Error('a'), { code: 1 }), Object.assign(new Error('a'), { code: 2 }), 'errors with other extra properties')
  agree(new (Error as any)('a', { cause: { id: 1 } }), new (Error as any)('a', { cause: { id: 1 } }), 'errors with a cause')
  agree(new (Error as any)('a', { cause: undefined }), new Error('a'), 'a cause of undefined')
  if (!deepStrictEqual(new (Error as any)('a', { cause: 1 }), new (Error as any)('a', { cause: 2 })))
    differ(new (Error as any)('a', { cause: 1 }), new (Error as any)('a', { cause: 2 }), 'errors with other causes')

  // long strings that differ only in the middle: hashed in full up to 4096 characters, sampled beyond
  agree(middle('a', 1500), middle('a', 1500), 'long strings')
  differ(middle('a', 1500), middle('b', 1500), 'long strings that differ in the middle')
  agree(middle('a', 600000), middle('a', 600000), 'very long strings')
  agree(Buffer.alloc(1 << 20, 1), Buffer.alloc(1 << 20, 1), 'large Buffers')

  // the same keys inserted in other orders, at every depth; wide objects, large Maps and Sets in any order
  agree({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 }, 'key order at every depth')
  const keys = Array.from({ length: 400 }, (_, index) => `key${index}`)
  const wide = (order: string[]) => Object.fromEntries(order.map(key => [key, { value: key }]))
  agree(wide(keys), wide([...keys].reverse()), 'wide objects in other key orders')
  agree(new Map(keys.map(key => [key, key])), new Map([...keys].reverse().map(key => [key, key])), 'large Maps')
  agree(new Set(keys), new Set([...keys].reverse()), 'large Sets')
  agree(new Map(keys.map(key => [{ key }, 1])), new Map([...keys].reverse().map(key => [{ key }, 1])), 'large Maps with object keys')

  // values deeper and larger than the limits are cut, not given FALLBACK_HASH
  let chain: any = { leaf: 1 }
  for (let index = 0; index < 100; index++) chain = { next: chain }
  t.not(structuralHash(chain), FALLBACK_HASH)
  let dag: any = { leaf: 1 }
  for (let index = 0; index < 40; index++) dag = { a: dag, b: dag }
  t.not(structuralHash(dag), FALLBACK_HASH)

  // values that cannot be read: round 6 (E14) hashes them by their identity (the same value alike, another one not),
  // where round 4 gave them all FALLBACK_HASH
  const throwing = { get value(): never { throw new Error('getter') } }
  t.is(structuralHash(throwing), structuralHash(throwing))
  t.not(structuralHash(throwing), structuralHash({ get value(): never { throw new Error('getter') } }))
  t.not(structuralHash(throwing), FALLBACK_HASH)
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  t.is(structuralHash(proxy), structuralHash(proxy))
  t.not(structuralHash(proxy), FALLBACK_HASH)
})

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}
const bestOfThree = (run: () => void) => {
  run() // warm up
  return Math.min(millisecondsOf(run), millisecondsOf(run), millisecondsOf(run))
}

test('R3-1 (E3) 10k unconfigured calls with Error arguments, cb(err, null) and back-references finish well under 1s', t => {
  const cases: Array<[string, () => void]> = [
    ['logger.error(new Error(message_i))', () => {
      const logger = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) logger.error(new Error(`request ${index} failed`))
    }],
    ['cb(new TypeError(message_i), null)', () => {
      const callback = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) callback(new TypeError(`bad ${index}`), null)
    }],
    ['visit(node_i) with a child-to-parent back-reference', () => {
      const visitor = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) {
        const node: any = { id: index, children: [] }
        node.children.push({ parent: node })
        visitor.visit(node)
      }
    }],
    ['f({ err: new Error(message_i) })', () => {
      const substitute = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) substitute.f({ err: new Error(`e${index}`) })
    }]
  ]
  for (const [name, run] of cases) {
    const elapsed = bestOfThree(run)
    t.true(elapsed < 1000, `${name}: ${elapsed} ms`)
  }

  // the cache still finds equal arguments
  const logger = Substitute.for<any>()
  t.is(logger.error(new Error('x')), logger.error(new Error('x')))
  t.not(logger.error(new Error('x')), logger.error(new Error('y')))
  const node: any = { id: 1, children: [] }
  node.children.push({ parent: node })
  const same: any = { id: 1, children: [] }
  same.children.push({ parent: same })
  if (deepStrictEqual(node, same)) t.is(logger.visit(node), logger.visit(same))
  logger.received(3).error(new Error('x'))
})

test('R3-ADV-2 (E3) cyclic setups, 1 MB strings, deep DAGs and 150k-element arrays finish well under 1s', t => {
  const cases: Array<[string, () => void]> = [
    ['2000 cyclic setups and 2000 matching calls', () => {
      const repository = Substitute.for<any>()
      for (let index = 0; index < 2000; index++) {
        const entity: any = { id: index }
        entity.self = entity
        repository.save(entity).returns(index)
      }
      for (let index = 0; index < 2000; index++) {
        const entity: any = { id: index }
        entity.self = entity
        if (repository.save(entity) !== index) throw new Error(`save(${index})`)
      }
    }],
    ['200 calls with distinct 1 MB strings', () => {
      const log = Substitute.for<any>()
      const payload = 'x'.repeat(1 << 20)
      for (let index = 0; index < 200; index++) log.write(index + payload)
    }],
    ['50 calls with a deep DAG of shared subtrees', () => {
      const store = Substitute.for<any>()
      for (let index = 0; index < 50; index++) {
        let dag: any = { leaf: index }
        for (let level = 0; level < 25; level++) dag = { a: dag, b: dag }
        store.put(dag)
      }
    }]
  ]
  for (const [name, run] of cases) {
    const elapsed = bestOfThree(run)
    t.true(elapsed < 1000, `${name}: ${elapsed} ms`)
  }

  // 20 calls with 150k-element arrays (the arrays are created beforehand: only the calls are timed)
  const arrays = Array.from({ length: 20 }, (_, index) => {
    const items = Array.from({ length: 150_000 }, (_, item) => ({ item }))
    items[149_999] = { item: -index }
    return items
  })
  const elapsed = bestOfThree(() => {
    const sink = Substitute.for<any>()
    for (const items of arrays) sink.consume(items)
  })
  t.true(elapsed < 1000, `20 calls with 150k-element arrays: ${elapsed} ms`)
})

test('R3-ADV-2 (E3) the search for nested matchers is bounded as well, and still finds them in ordinary arguments', t => {
  const items = Array.from({ length: 150_000 }, (_, item) => ({ item }))
  const elapsed = bestOfThree(() => {
    for (let index = 0; index < 20; index++) RecordedArguments.containsMatchers([items])
  })
  t.true(elapsed < 100, `${elapsed} ms`)

  const repository = Substitute.for<any>()
  repository.save({ user: { id: Arg.any(), roles: [Arg.any('string'), 'admin'] } }).returns('saved')
  t.is(repository.save({ user: { id: 1, roles: ['x', 'admin'] } }), 'saved')
  const wide = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, index === 199 ? Arg.any() : index]))
  repository.update(wide).returns('updated')
  t.is(repository.update({ ...wide, k199: 'anything' }), 'updated')
  repository.received(1).save(Arg.all())
  repository.received(1).update(Arg.all())
})
