/**
 * Cheap fingerprints of an argument list, used to look up the auto-substitute cached for a call, or the literal
 * substitutions that can answer a call, in O(1) instead of comparing against every earlier argument list.
 *
 * Contract: arguments that are deep strictly equal (util.isDeepStrictEqual) always get the same structural and
 * the same stable fingerprint. A fingerprint may be coarser than equality (callers still compare with
 * isDeepStrictEqual inside a bucket). Functions, and therefore substitutes, are fingerprinted by identity and are
 * never traversed. Returns undefined when the arguments cannot be fingerprinted (for example when a getter throws).
 *
 * - structural: looks into objects (two levels deep). It describes the arguments as they are now, so it goes
 *   stale when an object in them is mutated later.
 * - stable: an object only counts as "an object", so it never goes stale. Used for configured substitutions,
 *   whose arguments are compared as they are when a call is made.
 * - identity: an object counts by identity. Equal identity fingerprints mean the same primitives and the same
 *   objects, so the arguments are equal however the objects were mutated since.
 */
const objectIds = new WeakMap<object, number>()
const symbolIds = new Map<symbol, number>()
let nextId = 0

const idOfObject = (value: object): number => {
  let id = objectIds.get(value)
  if (id === undefined) {
    id = ++nextId
    objectIds.set(value, id)
  }
  return id
}

const idOfSymbol = (value: symbol): number => {
  let id = symbolIds.get(value)
  if (id === undefined) {
    id = ++nextId
    symbolIds.set(value, id)
  }
  return id
}

const MAX_DEPTH = 2
const MAX_ITEMS = 8
const MAX_KEYS = 16
const MAX_STRING = 64

type ObjectMode = 'structure' | 'stable' | 'identity'

const fingerprintValue = (value: unknown, depth: number, objects: ObjectMode): string => {
  switch (typeof value) {
    case 'string':
      return `s${value.length}:${value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value}`
    case 'number':
      return Object.is(value, -0) ? 'n-0' : `n${value}`
    case 'bigint':
      return `b${value}`
    case 'boolean':
      return value ? 't' : 'f'
    case 'undefined':
      return 'u'
    case 'symbol':
      return `y${idOfSymbol(value)}`
    case 'function':
      return `F${idOfObject(value)}`
  }
  if (value === null) return 'N'
  const object = value as object
  if (objects === 'identity') return `I${idOfObject(object)}`
  if (objects === 'stable' || depth >= MAX_DEPTH) return 'O'
  if (Array.isArray(object)) {
    let fingerprint = `A${object.length}[`
    const length = Math.min(object.length, MAX_ITEMS)
    for (let index = 0; index < length; index++) fingerprint += fingerprintValue(object[index], depth + 1, objects) + ','
    return fingerprint + ']'
  }
  if (ArrayBuffer.isView(object)) return `V${object.byteLength}`
  if (object instanceof Date) return `D${object.getTime()}`
  if (object instanceof Map) return `M${object.size}`
  if (object instanceof Set) return `S${object.size}`
  const keys = Object.keys(object)
  if (keys.length > MAX_KEYS) return `K${keys.length}`
  keys.sort()
  let fingerprint = '{'
  for (const key of keys) fingerprint += `${key}:${fingerprintValue((object as any)[key], depth + 1, objects)},`
  return fingerprint + '}'
}

const fingerprintWith = (args: readonly unknown[], objects: ObjectMode): string | undefined => {
  try {
    let fingerprint = `${args.length}|`
    for (const arg of args) fingerprint += fingerprintValue(arg, 0, objects) + '|'
    return fingerprint
  } catch {
    return undefined
  }
}

/** Looks into objects; goes stale when they are mutated (see above). */
export const fingerprintArguments = (args: readonly unknown[]): string | undefined => fingerprintWith(args, 'structure')
/** Objects only count as objects, so it never goes stale. */
export const stableFingerprintArguments = (args: readonly unknown[]): string | undefined => fingerprintWith(args, 'stable')
/** Objects count by identity. */
export const identityFingerprintArguments = (args: readonly unknown[]): string | undefined => fingerprintWith(args, 'identity')
