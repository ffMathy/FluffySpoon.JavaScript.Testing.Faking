/**
 * A cheap structural fingerprint of an argument list, used to look up the auto-substitute cached for a
 * call in O(1) instead of comparing against every earlier argument list.
 *
 * Contract: arguments that are deep strictly equal (util.isDeepStrictEqual) always get the same
 * fingerprint. The fingerprint may be coarser than equality (callers still compare with
 * isDeepStrictEqual inside a bucket). Functions, and therefore substitutes, are fingerprinted by
 * identity and are never traversed. Returns undefined when the arguments cannot be fingerprinted
 * (for example when a getter throws).
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

const fingerprintValue = (value: unknown, depth: number): string => {
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
  if (depth >= MAX_DEPTH) return 'O'
  if (Array.isArray(object)) {
    let fingerprint = `A${object.length}[`
    const length = Math.min(object.length, MAX_ITEMS)
    for (let index = 0; index < length; index++) fingerprint += fingerprintValue(object[index], depth + 1) + ','
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
  for (const key of keys) fingerprint += `${key}:${fingerprintValue((object as any)[key], depth + 1)},`
  return fingerprint + '}'
}

export const fingerprintArguments = (args: readonly unknown[]): string | undefined => {
  try {
    let fingerprint = `${args.length}|`
    for (const arg of args) fingerprint += fingerprintValue(arg, 0) + '|'
    return fingerprint
  } catch {
    return undefined
  }
}
