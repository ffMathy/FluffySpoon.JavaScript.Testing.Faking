import { types } from 'util'

/**
 * Structural hashes of argument lists (D35). They let the auto-substitute cache and the index of literal
 * substitutions find the candidates for a call in O(1) expected time, whatever the shape of the arguments, instead of
 * comparing the call against every earlier argument list.
 *
 * Contract: argument lists that are deep strictly equal (util.isDeepStrictEqual, element by element) always get the
 * same structural hash. Unequal lists may share a hash (callers confirm every candidate with live deep equality),
 * so the hash only looks at what deep strict equality compares, and may leave things out:
 * - primitives by value (NaN as one value, symbols by their description), functions (substitutes included) by
 *   identity: they are never traversed;
 * - arrays element by element (a hole counts as undefined), plain objects and class instances by their own
 *   enumerable string and symbol keys and values, in any key order (prototypes are left out);
 * - Maps and Sets by their entries, in any order; Dates, RegExps and boxed primitives by their value; typed arrays,
 *   DataViews and ArrayBuffers by their bytes.
 * Arguments that cannot be hashed give the constant FALLBACK_HASH: a cycle (a value deep strictly equal to a cyclic
 * value is cyclic as well), more than MAX_OBJECTS nested objects (deep strictly equal values have the same number),
 * or anything that throws while it is read, such as a throwing getter or a revoked proxy.
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

const MAX_OBJECTS = 100_000
/** The depth from which the ancestors of the current value are also kept in a Set (cycle detection stays O(1)). */
const ANCESTOR_SET_DEPTH = 16

/** Thrown to stop hashing; the arguments then get FALLBACK_HASH. Not an Error, so that no stack trace is captured. */
const CANNOT_HASH = { reason: 'cannot hash' }

// tags that keep the kinds of values apart
const enum Tag {
  Undefined = 0x1b873593, Null = 0x2e5c4a1d, True = 0x5a9e1d27, False = 0x3c6ef372, Number = 0x7f4a7c15,
  NaN = 0x6c078965, String = 0x0bad5eed, BigInt = 0x4cf5ad43, Symbol = 0x1f83d9ab, Function = 0x5be0cd19,
  Array = 0x6a09e667, Object = 0x3c6ef373, Map = 0x510e527f, Set = 0x9b05688c, Date = 0x1f83d9ac,
  RegExp = 0x5be0cd1a, Bytes = 0x428a2f98, Boxed = 0x71374491, Identity = 0x2a5c4e2b, Arguments = 0x0f1bbcdc
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

const hashString = (text: string, seed: number): number => {
  let h = mix(seed, text.length)
  for (let index = 0; index < text.length; index++) h = Math.imul(h ^ text.charCodeAt(index), 0x01000193)
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
  let h = mix(Tag.Bytes, bytes.length)
  for (let index = 0; index < bytes.length; index++) h = Math.imul(h ^ bytes[index], 0x01000193)
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

/** One structural hashing run over an argument list. */
class StructuralHasher {
  private _objects = 0
  private readonly _ancestors: object[] = []
  private _ancestorSet?: Set<object>

  public hash(value: unknown): number {
    if (typeof value === 'function') return mix(Tag.Function, idOf(value))
    if (typeof value !== 'object' || value === null) return hashPrimitive(value)
    return this.hashObject(value)
  }

  private enter(object: object): void {
    if (++this._objects > MAX_OBJECTS) throw CANNOT_HASH
    const set = this._ancestorSet
    if (set !== undefined) {
      if (set.has(object)) throw CANNOT_HASH
      set.add(object)
    } else if (this._ancestors.indexOf(object) !== -1) throw CANNOT_HASH
    this._ancestors.push(object)
    if (set === undefined && this._ancestors.length > ANCESTOR_SET_DEPTH) this._ancestorSet = new Set(this._ancestors)
  }

  private exit(object: object): void {
    this._ancestors.pop()
    this._ancestorSet?.delete(object)
  }

  private hashObject(object: object): number {
    this.enter(object)
    try {
      return this.hashContents(object)
    } finally {
      this.exit(object)
    }
  }

  private hashContents(object: object): number {
    if (Array.isArray(object)) {
      let h = mix(Tag.Array, object.length)
      for (let index = 0; index < object.length; index++) h = mix(h, this.hash(object[index]))
      return h
    }
    if (ArrayBuffer.isView(object)) return hashBytes(new Uint8Array(object.buffer, object.byteOffset, object.byteLength))
    if (types.isAnyArrayBuffer(object)) return hashBytes(new Uint8Array(object as ArrayBuffer))
    if (types.isDate(object)) return mix(Tag.Date, hashNumber(Date.prototype.getTime.call(object)))
    if (types.isRegExp(object)) {
      const regExp = object as RegExp
      return mix(hashString(regExp.source, Tag.RegExp), hashString(regExp.flags, Tag.RegExp))
    }
    if (types.isMap(object)) {
      let sum = 0
      for (const [key, value] of object as Map<unknown, unknown>) sum = (sum + spread(mix(this.hash(key), this.hash(value)))) | 0
      return mix(mix(Tag.Map, (object as Map<unknown, unknown>).size), sum)
    }
    if (types.isSet(object)) {
      let sum = 0
      for (const value of object as Set<unknown>) sum = (sum + spread(this.hash(value))) | 0
      return mix(mix(Tag.Set, (object as Set<unknown>).size), sum)
    }
    if (types.isNumberObject(object)) return mix(Tag.Boxed, hashNumber(Number.prototype.valueOf.call(object)))
    if (types.isStringObject(object)) return mix(Tag.Boxed, hashString(String.prototype.valueOf.call(object), Tag.String))
    if (types.isBooleanObject(object)) return mix(Tag.Boxed, Boolean.prototype.valueOf.call(object) ? Tag.True : Tag.False)
    if (types.isSymbolObject(object)) return mix(Tag.Boxed, hashString(Symbol.prototype.toString.call(object), Tag.Symbol))
    if (isBigIntObject(object)) return mix(Tag.Boxed, hashString(String(object), Tag.BigInt))

    // own enumerable string and symbol keys, in any order
    const keys = Object.keys(object)
    let sum = 0
    for (const key of keys) sum = (sum + spread(mix(hashString(key, Tag.Object), this.hash((object as any)[key])))) | 0
    let count = keys.length
    for (const symbol of Object.getOwnPropertySymbols(object)) {
      if (!Object.prototype.propertyIsEnumerable.call(object, symbol)) continue
      count++
      sum = (sum + spread(mix(hashPrimitive(symbol), this.hash((object as any)[symbol])))) | 0
    }
    return mix(mix(types.isArgumentsObject(object) ? Tag.Arguments : Tag.Object, count), sum)
  }
}

/** The hash of one value (see above). Exported for the tests of the contract. */
export const structuralHash = (value: unknown): number => {
  try {
    return new StructuralHasher().hash(value)
  } catch {
    return FALLBACK_HASH
  }
}

/** The structural hash of an argument list (see above). */
export const hashArguments = (args: readonly unknown[]): number => {
  // the common cases need no hasher: no arguments, and primitives only
  let h = mix(Tag.Array, args.length)
  let hasher: StructuralHasher | undefined
  try {
    for (let index = 0; index < args.length; index++) {
      const value = args[index]
      if (typeof value === 'object' && value !== null) {
        if (hasher === undefined) hasher = new StructuralHasher()
        h = mix(h, hasher.hash(value))
      } else h = mix(h, typeof value === 'function' ? mix(Tag.Function, idOf(value)) : hashPrimitive(value))
    }
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
