import { isDeepStrictEqual, types } from 'util'

/**
 * Structural hashes of argument lists (D35, E3). They let the auto-substitute cache and the index of literal
 * substitutions find the candidates for a call in O(1) expected time, whatever the shape of the arguments, instead of
 * comparing the call against every earlier argument list.
 *
 * Contract: argument lists that the running Node.js finds deep strictly equal (util.isDeepStrictEqual, element by
 * element) always get the same structural hash. Unequal lists may share a hash (callers confirm every candidate with
 * live deep equality), so the hash only looks at what deep strict equality compares, and may leave things out:
 * - primitives by value (NaN as one value, symbols by their description), functions (substitutes included) by
 *   identity: they are never traversed;
 * - arrays by their length and their items (a hole counts as undefined), plain objects and class instances by their
 *   own enumerable string and symbol keys and values, in any key order (prototypes are left out);
 * - Maps and Sets by their entries, in any order; Dates, RegExps and boxed primitives by their value; typed arrays,
 *   DataViews and ArrayBuffers by their bytes; native errors also by the name, message, cause and errors that the
 *   running Node.js compares (found out once, when the library is loaded).
 *
 * E3: the cost per argument is bounded, whatever its size, so that every call costs about the same:
 * - each argument has a budget of BUDGET objects. An object takes one and shares the rest evenly among the values it
 *   hashes, and an object without a share, or nested more than MAX_DEPTH levels deep, gives a constant tag. Cycles
 *   simply end there (deep strictly equal values unroll to the same tree, whatever the shape of their cycles);
 * - long arrays are sampled by position (their length, the first and the last items and items at a fixed stride),
 *   long strings and byte arrays likewise; the samples depend only on the length;
 * - objects with many keys, and large Maps and Sets, contribute every key, but only shallowly (primitives by value,
 *   objects by a constant tag).
 * No limit depends on the order of keys or of Map and Set entries, as deep strictly equal values may differ in it.
 * Arguments that cannot be read give the constant FALLBACK_HASH: anything that throws while it is read, such as a
 * throwing getter or a revoked proxy.
 *
 * The identity hash counts objects by identity (and is undefined when there are no objects among the arguments, as
 * the structural hash is exact then). It finds the entry recorded for the same objects again after they were mutated.
 */

export const FALLBACK_HASH = 0x2f6b1c33

/** Objects (and functions) by identity. Weak, so that hashing never keeps a value alive. */
const objectIds = new WeakMap<object, number>()
let nextObjectId = 0
const idOf = (value: object): number => {
  let id = objectIds.get(value)
  if (id === undefined) {
    id = ++nextObjectId
    objectIds.set(value, id)
  }
  return id
}

/** How many objects of one argument are hashed at most. */
const BUDGET = 1024
/** How many levels of nested objects are hashed at most. */
const MAX_DEPTH = 32
/** Arrays with more items are sampled: the first and last SAMPLED_ITEMS / 4 items, and SAMPLED_ITEMS / 2 strided ones. */
const SAMPLED_ITEMS = 256
/** Objects with more keys, and Maps and Sets with more entries, are hashed shallowly. */
const MAX_ENTRIES = 256
/** Objects with more keys, and Maps and Sets with more entries, are hashed by their size only. */
const MAX_SCANNED_ENTRIES = 65536
/** Strings and byte arrays that are longer are sampled, like arrays. */
const SAMPLED_UNITS = 4096

// tags that keep the kinds of values apart
const enum Tag {
  Undefined = 0x1b873593, Null = 0x2e5c4a1d, True = 0x5a9e1d27, False = 0x3c6ef372, Number = 0x7f4a7c15,
  NaN = 0x6c078965, String = 0x0bad5eed, BigInt = 0x4cf5ad43, Symbol = 0x1f83d9ab, Function = 0x5be0cd19,
  Array = 0x6a09e667, Object = 0x3c6ef373, Map = 0x510e527f, Set = 0x9b05688c, Date = 0x1f83d9ac,
  RegExp = 0x5be0cd1a, Bytes = 0x428a2f98, Boxed = 0x71374491, Identity = 0x2a5c4e2b, Arguments = 0x0f1bbcdc,
  Cut = 0x24b6f2d1, Key = 0x63a1b5c7, Error = 0x1d8e4e27, Wide = 0x3a8f05c5
}

const mix = (hash: number, value: number): number => {
  let h = Math.imul(hash ^ value, 0x5bd1e995)
  h ^= h >>> 15
  return Math.imul(h, 0x27d4eb2d) | 0
}

/** Mixes a hash into an order-independent sum (for object keys, Map and Set entries). */
const spread = (value: number): number => {
  let h = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  h ^= h >>> 13
  return Math.imul(h, 0xc2b2ae35) | 0
}

/**
 * The positions of a sequence of `length` units that are hashed: all of them up to `samples`, otherwise the first and
 * last quarter of `samples` and half of them at a fixed stride in between. They depend only on the length.
 */
const sampledPosition = (length: number, samples: number, index: number): number => {
  if (length <= samples) return index
  const edge = samples >>> 2
  if (index < edge) return index
  if (index >= samples - edge) return length - (samples - index)
  return edge + Math.floor((index - edge + 0.5) * (length - 2 * edge) / (samples - 2 * edge))
}

/** hashString for a string longer than SAMPLED_UNITS: the positions of sampledPosition, in three loops. */
const hashSampledString = (text: string, h: number): number => {
  const length = text.length
  const edge = SAMPLED_UNITS >>> 2
  const strided = SAMPLED_UNITS - 2 * edge
  const span = length - 2 * edge
  for (let index = 0; index < edge; index++) h = Math.imul(h ^ text.charCodeAt(index), 0x01000193)
  for (let index = 0; index < strided; index++) h = Math.imul(h ^ text.charCodeAt(edge + Math.floor((index + 0.5) * span / strided)), 0x01000193)
  for (let index = length - edge; index < length; index++) h = Math.imul(h ^ text.charCodeAt(index), 0x01000193)
  return h
}

const hashString = (text: string, seed: number): number => {
  const length = text.length
  let h = mix(seed, length)
  if (length <= SAMPLED_UNITS) {
    for (let index = 0; index < length; index++) h = Math.imul(h ^ text.charCodeAt(index), 0x01000193)
  } else h = hashSampledString(text, h)
  return mix(h, 0)
}

const float = new Float64Array(1)
const floatWords = new Int32Array(float.buffer)
const hashNumber = (value: number): number => {
  if ((value | 0) === value && !Object.is(value, -0)) return mix(Tag.Number, value)
  if (value !== value) return Tag.NaN
  float[0] = value
  return mix(mix(Tag.Number, floatWords[0]), floatWords[1])
}

const hashBytes = (bytes: Uint8Array): number => {
  const length = bytes.length
  let h = mix(Tag.Bytes, length)
  if (length <= SAMPLED_UNITS) {
    for (let index = 0; index < length; index++) h = Math.imul(h ^ bytes[index], 0x01000193)
  } else {
    for (let index = 0; index < SAMPLED_UNITS; index++) h = Math.imul(h ^ bytes[sampledPosition(length, SAMPLED_UNITS, index)], 0x01000193)
  }
  return mix(h, 0)
}

// util.types.isBigIntObject is missing from older runtimes (and from the Node typings in use)
const typeChecks = types as unknown as Record<string, ((value: unknown) => boolean) | undefined>
const isBigIntObject: (value: unknown) => boolean = typeChecks.isBigIntObject ?? (() => false)

const hashPrimitive = (value: unknown): number => {
  switch (typeof value) {
    case 'string': return hashString(value, Tag.String)
    case 'number': return hashNumber(value)
    case 'boolean': return value ? Tag.True : Tag.False
    case 'undefined': return Tag.Undefined
    // D30: by description, so that no symbol is kept alive; equality confirms the identity
    case 'symbol': return hashString(value.toString(), Tag.Symbol)
    case 'bigint': return hashString(value.toString(), Tag.BigInt)
  }
  return Tag.Null
}

/** Primitives by value, functions by identity, objects by a constant tag. */
const shallowHash = (value: unknown): number => {
  if (typeof value === 'function') return mix(Tag.Function, idOf(value))
  if (typeof value !== 'object' || value === null) return hashPrimitive(value)
  return Tag.Cut
}

/**
 * E3: what deep strict equality compares on native errors besides their own enumerable properties. It changed between
 * Node.js versions (name since 12, cause and errors since 20 or 22), so it is found out once. A part is only hashed when
 * errors that differ in it alone are unequal, so that the hash never separates errors the running Node.js finds equal.
 */
const errorParts = ((): { name: boolean, message: boolean, cause: boolean, errors: boolean } => {
  const unequal = (create: () => [unknown, unknown]): boolean => {
    try {
      const [a, b] = create()
      return !isDeepStrictEqual(a, b)
    } catch {
      return false
    }
  }
  const named = (name: string) => {
    const error = new Error('x')
    Object.defineProperty(error, 'name', { value: name, enumerable: false, configurable: true, writable: true })
    return error
  }
  const withCause = (...cause: unknown[]) => new (Error as any)('x', ...cause.map(value => ({ cause: value }))) as Error
  // Node.js 10 has neither globalThis nor AggregateError
  const globalObject: any = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : undefined
  const Aggregate = globalObject?.AggregateError as (new (errors: unknown[], message: string) => Error) | undefined
  const withoutErrors = () => {
    const error = new Aggregate!([1], 'x')
    delete (error as any).errors
    return error
  }
  return {
    name: unequal(() => [named('A'), named('B')]),
    message: unequal(() => [new Error('a'), new Error('b')]),
    cause: unequal(() => [withCause(1), withCause(2)]) && unequal(() => [withCause(1), withCause()]),
    errors: Aggregate !== undefined && unequal(() => [new Aggregate([1], 'x'), new Aggregate([2], 'x')]) &&
      unequal(() => [new Aggregate([1], 'x'), withoutErrors()])
  }
})()

/** Each child's share of an object's budget. */
const share = (budget: number, children: number): number => children === 0 ? 0 : Math.floor((budget - 1) / children)

/** The own enumerable string and symbol keys (the keys deep strict equality compares). */
const ownEnumerableKeys = (object: object): PropertyKey[] => {
  const keys: PropertyKey[] = Object.keys(object)
  const symbols = Object.getOwnPropertySymbols(object)
  for (let index = 0; index < symbols.length; index++)
    if (Object.prototype.propertyIsEnumerable.call(object, symbols[index])) keys.push(symbols[index])
  return keys
}

const hashKey = (key: PropertyKey): number => typeof key === 'symbol' ? hashPrimitive(key) : hashString(key as string, Tag.Key)

/** The hash of one value with a budget of objects (see above). */
const hashValue = (value: unknown, budget: number, depth: number): number => {
  if (typeof value === 'function') return mix(Tag.Function, idOf(value))
  if (typeof value !== 'object' || value === null) return hashPrimitive(value)
  if (budget <= 0 || depth >= MAX_DEPTH) return Tag.Cut
  return hashObject(value, budget, depth + 1)
}

const hashObject = (object: object, budget: number, depth: number): number => {
  if (Array.isArray(object)) {
    const length = object.length
    const count = length <= SAMPLED_ITEMS ? length : SAMPLED_ITEMS
    const childBudget = share(budget, count)
    let h = mix(Tag.Array, length)
    for (let index = 0; index < count; index++) h = mix(h, hashValue(object[sampledPosition(length, SAMPLED_ITEMS, index)], childBudget, depth))
    return h
  }
  if (ArrayBuffer.isView(object)) return hashBytes(new Uint8Array(object.buffer, object.byteOffset, object.byteLength))
  if (types.isAnyArrayBuffer(object)) return hashBytes(new Uint8Array(object as ArrayBuffer))
  if (types.isDate(object)) return mix(Tag.Date, hashNumber(Date.prototype.getTime.call(object)))
  if (types.isRegExp(object)) {
    const regExp = object as RegExp
    return mix(hashString(regExp.source, Tag.RegExp), hashString(regExp.flags, Tag.RegExp))
  }
  if (types.isMap(object)) return hashMap(object as Map<unknown, unknown>, budget, depth)
  if (types.isSet(object)) return hashSet(object as Set<unknown>, budget, depth)
  if (types.isNumberObject(object)) return mix(Tag.Boxed, hashNumber(Number.prototype.valueOf.call(object)))
  if (types.isStringObject(object)) return mix(Tag.Boxed, hashString(String.prototype.valueOf.call(object), Tag.String))
  if (types.isBooleanObject(object)) return mix(Tag.Boxed, Boolean.prototype.valueOf.call(object) ? Tag.True : Tag.False)
  if (types.isSymbolObject(object)) return mix(Tag.Boxed, hashString(Symbol.prototype.toString.call(object), Tag.Symbol))
  if (isBigIntObject(object)) return mix(Tag.Boxed, hashString(String(object), Tag.BigInt))

  // own enumerable string and symbol keys, in any order
  const keys = ownEnumerableKeys(object)
  const count = keys.length
  const error = types.isNativeError(object) ? object as Error & { cause?: unknown, errors?: unknown } : undefined
  let h = mix(types.isArgumentsObject(object) ? Tag.Arguments : error !== undefined ? Tag.Error : Tag.Object, count)
  if (count > MAX_SCANNED_ENTRIES) return mix(h, Tag.Wide)
  const errorChildren = error === undefined ? 0 : (errorParts.cause ? 1 : 0) + (errorParts.errors ? 1 : 0)
  // wide objects: every key and its value, shallowly
  const childBudget = count > MAX_ENTRIES ? 0 : share(budget, count + errorChildren)
  let sum = 0
  for (let index = 0; index < count; index++) {
    const key = keys[index]
    sum = (sum + spread(mix(hashKey(key), hashValue((object as any)[key], childBudget, depth)))) | 0
  }
  h = mix(h, sum)
  if (error !== undefined) {
    // deep strict equality compares these with ===, or like the other properties (cause, errors)
    if (errorParts.name) h = mix(h, shallowHash(error.name))
    if (errorParts.message) h = mix(h, shallowHash(error.message))
    if (errorParts.cause) h = mix(h, hashValue(error.cause, childBudget, depth))
    if (errorParts.errors) h = mix(h, hashValue(error.errors, childBudget, depth))
  }
  return h
}

/** Map entries in any order. Large Maps contribute every entry, shallowly (objects among them by a constant tag). */
const hashMap = (map: Map<unknown, unknown>, budget: number, depth: number): number => {
  const size = map.size
  const h = mix(Tag.Map, size)
  if (size > MAX_SCANNED_ENTRIES) return mix(h, Tag.Wide)
  let sum = 0
  if (size > MAX_ENTRIES) {
    for (const [key, value] of map) sum = (sum + spread(mix(shallowHash(key), shallowHash(value)))) | 0
  } else {
    const childBudget = share(budget, 2 * size)
    for (const [key, value] of map) sum = (sum + spread(mix(hashValue(key, childBudget, depth), hashValue(value, childBudget, depth)))) | 0
  }
  return mix(h, sum)
}

/** Set members in any order, like Map entries. */
const hashSet = (set: Set<unknown>, budget: number, depth: number): number => {
  const size = set.size
  const h = mix(Tag.Set, size)
  if (size > MAX_SCANNED_ENTRIES) return mix(h, Tag.Wide)
  const childBudget = size > MAX_ENTRIES ? 0 : share(budget, size)
  let sum = 0
  for (const value of set) sum = (sum + spread(hashValue(value, childBudget, depth))) | 0
  return mix(h, sum)
}

/** The hash of one value (see above). Exported for the tests of the contract. */
export const structuralHash = (value: unknown): number => {
  try {
    return hashValue(value, BUDGET, 0)
  } catch {
    return FALLBACK_HASH
  }
}

/** The structural hash of an argument list (see above). Each argument has a budget of its own. */
export const hashArguments = (args: readonly unknown[]): number => {
  let h = mix(Tag.Array, args.length)
  try {
    for (let index = 0; index < args.length; index++) h = mix(h, hashValue(args[index], BUDGET, 0))
  } catch {
    return FALLBACK_HASH
  }
  return h
}

/**
 * The hash of an argument list with objects counted by identity, or undefined when there is no object among the
 * arguments (the structural hash already finds the same arguments then).
 */
export const identityHashArguments = (args: readonly unknown[]): number | undefined => {
  let h = mix(Tag.Identity, args.length)
  let hasObject = false
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (typeof value === 'object' && value !== null) {
      hasObject = true
      h = mix(h, idOf(value))
    } else h = mix(h, typeof value === 'function' ? mix(Tag.Function, idOf(value)) : hashPrimitive(value))
  }
  return hasObject ? h : undefined
}
