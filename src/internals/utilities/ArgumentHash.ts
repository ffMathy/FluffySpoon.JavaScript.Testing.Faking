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
 *   objects by a constant tag), and the widest objects and Maps only a sample of their values, chosen by key hash;
 * - E13: wide objects whose keys are those of an earlier wide object are hashed by the values of a fixed list of keys
 *   (a family, see below), without listing their keys, which costs more than anything else about them;
 * - E9, E13: the shallow part of a wide object, Map or Set is computed once (by identity), across calls, however many
 *   values refer to it (rows that share a lookup table) and however often it is passed.
 * No limit depends on the order of keys or of Map and Set entries, as deep strictly equal values may differ in it.
 * E14: a value that cannot be read (anything that throws while it is read, such as a throwing getter or a revoked
 * proxy) is hashed by its identity; only an argument list that cannot be hashed at all gets the constant FALLBACK_HASH.
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
/** Objects with more keys, and Maps and Sets with more entries, are hashed shallowly (and remembered, E13). */
const MAX_ENTRIES = 256
/**
 * Objects with more keys, and Maps with more entries, contribute every key but only a sample of about SAMPLED_ENTRIES
 * values, chosen by the hash of their keys (E13).
 */
const MAX_SCANNED_ENTRIES = 65536
const SAMPLED_ENTRIES = 256
/** Strings and byte arrays that are longer are sampled, like arrays. */
const SAMPLED_UNITS = 4096

// tags that keep the kinds of values apart
const enum Tag {
  Undefined = 0x1b873593, Null = 0x2e5c4a1d, True = 0x5a9e1d27, False = 0x3c6ef372, Number = 0x7f4a7c15,
  NaN = 0x6c078965, String = 0x0bad5eed, BigInt = 0x4cf5ad43, Symbol = 0x1f83d9ab, Function = 0x5be0cd19,
  Array = 0x6a09e667, Object = 0x3c6ef373, Map = 0x510e527f, Set = 0x9b05688c, Date = 0x1f83d9ac,
  RegExp = 0x5be0cd1a, Bytes = 0x428a2f98, Boxed = 0x71374491, Identity = 0x2a5c4e2b, Arguments = 0x0f1bbcdc,
  Cut = 0x24b6f2d1, Key = 0x63a1b5c7, Error = 0x1d8e4e27, Family = 0x3a8f05c5, Unsampled = 0x7c3b1d95,
  Unreadable = 0x5f356495
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

/**
 * E10: which objects are hashed as errors, by name and message (see errorParts). The running Node.js compares an object
 * as an error when `isNativeError(value) || value instanceof Error`, unless its Object.prototype.toString tag is
 * `[object Object]`: such objects are compared by their keys alone (on Node.js 24 and later only when the other side is
 * not a native error, so that equality is not symmetric there). So an object that inherits from Error.prototype and has
 * the toStringTag 'Error' is compared like a native error, and can be deep strictly equal to one. Objects tagged
 * `[object Object]` are hashed by their keys, which keeps every pair that Node.js finds equal, in either order,
 * together. Whether error-like objects count is found out once, when the library is loaded (under jest, whose test
 * files have an Error of their own, Node.js does not count their error-like objects as errors, and neither does this
 * check, which uses the same Error).
 */
const errorLikesAreErrors = ((): boolean => {
  const errorLike = (message: string) => Object.create(Error.prototype, {
    message: { value: message, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: 'Error', configurable: true }
  })
  try {
    return !isDeepStrictEqual(errorLike('a'), errorLike('b'))
  } catch {
    return false
  }
})()

const objectToString = Object.prototype.toString

const isComparedAsError = (value: object): value is Error & { cause?: unknown, errors?: unknown } =>
  (types.isNativeError(value) || (errorLikesAreErrors && value instanceof Error)) && objectToString.call(value) !== '[object Object]'

/** Each child's share of an object's budget. */
const share = (budget: number, children: number): number => children === 0 ? 0 : Math.floor((budget - 1) / children)

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

/** The own enumerable string and symbol keys (the keys deep strict equality compares). */
const ownEnumerableKeys = (object: object): PropertyKey[] => {
  const keys: PropertyKey[] = Object.keys(object)
  const symbols = Object.getOwnPropertySymbols(object)
  for (let index = 0; index < symbols.length; index++)
    if (propertyIsEnumerable.call(object, symbols[index])) keys.push(symbols[index])
  return keys
}

const hashKey = (key: PropertyKey): number => typeof key === 'symbol' ? hashPrimitive(key) : hashString(key as string, Tag.Key)

/*
 * E13: memory of the containers hashed shallowly (objects, Maps and Sets with more than MAX_ENTRIES entries), by
 * identity and across calls, so that a wide container passed again (a lookup table passed to every call) is never
 * listed or hashed again. Weak, so that it keeps nothing alive. Mutating an argument after it was passed is not
 * supported (amended D15/D35): its hash stays the one of its first use.
 * Values that cannot be read are remembered here as well, with their identity hash (E14).
 * The hashes and the refined hashes (without families, see below) are remembered apart. A hash without a family is its
 * refined hash as well, and is remembered as both.
 */
const hashes = new WeakMap<object, number>()
const refinedHashes = new WeakMap<object, number>()
let remembered = false

/** Remembers the hash of a container hashed shallowly: as a refined hash too unless it is a family hash. */
const remember = (container: object, hash: number, familyHash = false): number => {
  if (!refining) hashes.set(container, hash)
  if (refining || !familyHash) refinedHashes.set(container, hash)
  remembered = true
  return hash
}

/*
 * E13: families. Listing the keys of a wide object costs more than anything else about it (Object.keys takes about
 * 10 ms for 70,000 keys), and it is the only way to count them. So distinct wide objects with the same keys (state
 * snapshots, translation tables per locale) are hashed by looking up a fixed list of keys, a family, without listing
 * theirs: the first object with at least FAMILY_KEYS string keys that matches no family starts one, with FAMILY_KEYS
 * of its keys. An object belongs to the first family whose keys are all its own enumerable keys, and is hashed by the
 * values of those keys (shallowly). Deep strictly equal objects have the same keys, so they belong to the same family.
 * Families are only ever added, and an object that belongs to none either starts one or comes after the last one was
 * added (or has fewer than FAMILY_KEYS string keys, and can belong to none), so the family an object belongs to never
 * changes: equal objects hash the same, whenever they are hashed.
 * A family hash leaves out the keys outside the family (an object that gained keys hashes as before), so a lookup that
 * finds more than one candidate with a family hash compares their refined hashes (without families) first.
 * FAMILY_KEYS is above the number of keys the search for nested matchers looks into (RecordedArguments), so that an
 * object in a family is known to be too wide to search, without listing its keys either.
 */
export const FAMILY_KEYS = 1025
const MAX_FAMILIES = 16
const families: string[][] = []
/** The first key of each family: an object without it (as most objects are) is no member, found out at little cost. */
const anchors: string[] = []
/** The family found for an object (an object stays in its family, see above). */
const familyMembers = new WeakMap<object, number>()
const hasOwnProperty = Object.prototype.hasOwnProperty

/**
 * The index of the first family that the object belongs to, or -1. An object that cannot be looked up (a proxy that
 * throws) belongs to none from there on.
 */
const familyOf = (object: object): number => {
  const count = anchors.length
  if (count === 0) return -1
  try {
    for (let index = 0; index < count; index++) {
      if (!hasOwnProperty.call(object, anchors[index])) continue
      const known = familyMembers.get(object)
      if (known !== undefined) return known
      const keys = families[index]
      let all = true
      for (let key = 0; key < keys.length && all; key++) all = propertyIsEnumerable.call(object, keys[key])
      if (all) {
        familyMembers.set(object, index)
        return index
      }
    }
  } catch { /* a proxy */ }
  return -1
}

/**
 * Whether an object is known to have more than FAMILY_KEYS - 1 own enumerable string keys without listing them: it
 * belongs to a family (for RecordedArguments' search for nested matchers).
 */
export const isInFamily = (object: object): boolean => familyOf(object) !== -1

/**
 * Starts a family with FAMILY_KEYS of the object's keys (`keys`), spread over them, or gives -1 when it has not enough
 * string keys. (Which of its keys they are does not matter, only that they never change.)
 */
const startFamily = (object: object, keys: readonly PropertyKey[]): number => {
  const strings: string[] = []
  for (let index = 0; index < keys.length; index++) if (typeof keys[index] === 'string') strings.push(keys[index] as string)
  if (strings.length < FAMILY_KEYS) return -1
  const family = Array.from({ length: FAMILY_KEYS }, (_, index) => strings[Math.floor(index * strings.length / FAMILY_KEYS)])
  families.push(family)
  anchors.push(family[0])
  familyMembers.set(object, families.length - 1)
  return families.length - 1
}

const familyHash = (object: object, family: number): number => {
  const keys = families[family]
  let h = mix(Tag.Family, family)
  for (let index = 0; index < keys.length; index++) h = mix(h, shallowHash((object as any)[keys[index]]))
  return h
}

/*
 * The state of the current hash: whether it is a refined one (no families), and whether a family hash took part.
 * Saved and restored around every hash, as a getter could start another hash while one runs.
 */
let refining = false
let approximate = false

/** The hash of one value with a budget of objects (see above). */
const hashValue = (value: unknown, budget: number, depth: number): number => {
  if (typeof value === 'function') return mix(Tag.Function, idOf(value))
  if (typeof value !== 'object' || value === null) return hashPrimitive(value)
  if (budget <= 0 || depth >= MAX_DEPTH) return Tag.Cut
  return hashObject(value, budget, depth + 1)
}

const hashObject = (object: object, budget: number, depth: number): number => {
  if (remembered) {
    const known = (refining ? refinedHashes : hashes).get(object)
    if (known !== undefined) {
      if (!refining && familyMembers.has(object)) approximate = true
      return known
    }
  }
  try {
    return hashReadable(object, budget, depth)
  } catch {
    // E14: a value that cannot be read (a throwing getter, a revoked proxy) is hashed by its identity, and only read
    // once: it is deep strictly equal to nothing but itself (Node.js throws when it compares it, which counts as
    // unequal), so only the same value finds the entries recorded for it, and no comparison reads it again. (A family
    // hash reads less of an object than its refined hash, which may come to another result.)
    return remember(object, mix(Tag.Unreadable, idOf(object)), !refining && familyMembers.has(object))
  }
}

const hashReadable = (object: object, budget: number, depth: number): number => {
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

  return hashKeyed(object, budget, depth)
}

/**
 * E13: whether the value of a key with this hash is part of the sample of an object with `count` keys (or a Map with
 * `count` entries): all of them up to MAX_SCANNED_ENTRIES, then about SAMPLED_ENTRIES chosen by their key hash, so
 * that deep strictly equal values, which have the same keys, choose the same ones, in any order.
 */
const sampled = (keyHash: number, count: number): boolean =>
  count <= MAX_SCANNED_ENTRIES || (keyHash >>> 0) % Math.ceil(count / SAMPLED_ENTRIES) === 0

/** Objects and class instances by their own enumerable string and symbol keys and their values, in any key order. */
const hashKeyed = (object: object, budget: number, depth: number): number => {
  const error = isComparedAsError(object) ? object : undefined
  const tag = types.isArgumentsObject(object) ? Tag.Arguments : error !== undefined ? Tag.Error : Tag.Object
  if (!refining) {
    const family = familyOf(object)
    if (family !== -1) return withFamily(object, tag, family, error, depth)
  }

  const keys = ownEnumerableKeys(object)
  const count = keys.length
  let h = mix(tag, count)
  const errorChildren = error === undefined ? 0 : (errorParts.cause ? 1 : 0) + (errorParts.errors ? 1 : 0)
  if (count <= MAX_ENTRIES) {
    const childBudget = share(budget, count + errorChildren)
    let sum = 0
    for (let index = 0; index < count; index++) {
      const key = keys[index]
      sum = (sum + spread(mix(hashKey(key), hashValue((object as any)[key], childBudget, depth)))) | 0
    }
    return withError(mix(h, sum), error, childBudget, depth)
  }

  if (!refining && families.length < MAX_FAMILIES) {
    const family = startFamily(object, keys)
    if (family !== -1) return withFamily(object, tag, family, error, depth)
  }
  // wide objects: every key, and the values of the sample, shallowly
  let sum = 0
  for (let index = 0; index < count; index++) {
    const key = keys[index]
    const keyHash = hashKey(key)
    sum = (sum + spread(mix(keyHash, sampled(keyHash, count) ? shallowHash((object as any)[key]) : Tag.Unsampled))) | 0
  }
  return remember(object, withError(mix(h, sum), error, 0, depth))
}

const withFamily = (object: object, tag: Tag, family: number, error: ComparedError | undefined, depth: number): number => {
  approximate = true
  return remember(object, withError(mix(tag, familyHash(object, family)), error, 0, depth), true)
}

type ComparedError = Error & { cause?: unknown, errors?: unknown }

/** Deep strict equality compares these with ===, or like the other properties (cause, errors). */
const withError = (h: number, error: ComparedError | undefined, childBudget: number, depth: number): number => {
  if (error === undefined) return h
  if (errorParts.name) h = mix(h, shallowHash(error.name))
  if (errorParts.message) h = mix(h, shallowHash(error.message))
  if (errorParts.cause) h = mix(h, hashValue(error.cause, childBudget, depth))
  if (errorParts.errors) h = mix(h, hashValue(error.errors, childBudget, depth))
  return h
}

// the iteration of Maps and Sets themselves, which an instance cannot replace (as for Node.js's comparison)
const mapForEach = Map.prototype.forEach
const setForEach = Set.prototype.forEach

/**
 * Map entries in any order. Large Maps contribute every entry, shallowly (objects among them by a constant tag), and
 * the largest ones every key but only a sample of the values (chosen by the hash of their primitive keys).
 */
const hashMap = (map: Map<unknown, unknown>, budget: number, depth: number): number => {
  const size = map.size
  const h = mix(Tag.Map, size)
  let sum = 0
  if (size > MAX_ENTRIES) {
    mapForEach.call(map, (value: unknown, key: unknown) => {
      const keyHash = shallowHash(key)
      // entries with object keys all have the same key hash: their values are all part of the sample
      const sample = (typeof key === 'object' && key !== null) || sampled(keyHash, size)
      sum = (sum + spread(mix(keyHash, sample ? shallowHash(value) : Tag.Unsampled))) | 0
    })
    return remember(map, mix(h, sum))
  }
  const childBudget = share(budget, 2 * size)
  mapForEach.call(map, (value: unknown, key: unknown) => {
    sum = (sum + spread(mix(hashValue(key, childBudget, depth), hashValue(value, childBudget, depth)))) | 0
  })
  return mix(h, sum)
}

/** Set members in any order, like Map entries (large Sets: every member, shallowly). */
const hashSet = (set: Set<unknown>, budget: number, depth: number): number => {
  const size = set.size
  const childBudget = size > MAX_ENTRIES ? 0 : share(budget, size)
  let sum = 0
  setForEach.call(set, (value: unknown) => {
    sum = (sum + spread(hashValue(value, childBudget, depth))) | 0
  })
  const h = mix(mix(Tag.Set, size), sum)
  return size > MAX_ENTRIES ? remember(set, h) : h
}

/** Runs one hash with a state of its own (a getter could start another hash while one runs). */
const hashing = (refine: boolean, hash: () => number): number => {
  const outerRefining = refining
  const outerApproximate = approximate
  refining = refine
  approximate = false
  try {
    return hash()
  } catch {
    return FALLBACK_HASH
  } finally {
    lastApproximate = approximate
    refining = outerRefining
    approximate = outerApproximate
  }
}
let lastApproximate = false

const hashList = (args: readonly unknown[]): number => {
  let h = mix(Tag.Array, args.length)
  for (let index = 0; index < args.length; index++) h = mix(h, hashValue(args[index], BUDGET, 0))
  return h
}

/** The hash of one value (see above). Exported for the tests of the contract. */
export const structuralHash = (value: unknown): number => hashing(false, () => hashValue(value, BUDGET, 0))

/** The structural hash of an argument list (see above). Each argument has a budget of its own. */
export const hashArguments = (args: readonly unknown[]): number => hashing(false, () => hashList(args))

/**
 * Whether a family hash took part in the last structural hash (hashArguments or structuralHash): equal hashes are
 * then less telling, and candidates are best compared by their refined hashes first.
 */
export const lastHashWasApproximate = (): boolean => lastApproximate

/** The hash of an argument list without families (E13): it also counts the keys a family leaves out. */
export const refinedHashArguments = (args: readonly unknown[]): number => hashing(true, () => hashList(args))

/** The refined hash of one value. Exported for the tests of the contract. */
export const refinedStructuralHash = (value: unknown): number => hashing(true, () => hashValue(value, BUDGET, 0))

/**
 * E9: a hash of an argument list that does not look into objects: primitives by value, functions by identity, every
 * object alike. Deep strictly equal lists share it, and computing it costs nothing, so the index of literal
 * substitutions uses it to see that no substitution can match a call before it computes the structural hash.
 */
export const coarseHashArguments = (args: readonly unknown[]): number => {
  let h = mix(Tag.Array, args.length)
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    h = mix(h, typeof value === 'object' && value !== null ? Tag.Object : shallowHash(value))
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
