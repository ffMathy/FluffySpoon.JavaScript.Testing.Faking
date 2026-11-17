import { inspect, InspectOptions, types } from 'util'

let printDepth = 0

/**
 * Runs `print` while marking that the library is printing. Substitutes met while printing (for example a
 * substitute recorded as an argument of another substitute) are printed in their short form, so
 * printing never recurses through substitutes, even when they reference each other.
 */
export const withPrintGuard = <T>(print: () => T): T => {
  printDepth++
  try {
    return print()
  } finally {
    printDepth--
  }
}

export const isPrinting = (): boolean => printDepth > 0

/*
 * E44: bounded printing. Every value that a failure message, a printout of a substitute (String(), util.inspect) or a
 * path shows (an argument, an assigned value, a configured value) is printed within bounds, whatever its size: a DOM
 * event that holds its element, document and window, or an object with 5,000 keys, takes as long to print as a small
 * value, and gives a few lines.
 * - util.inspect goes `depth` levels deep, shows `maxArrayLength` items of an array, Map or Set and `maxStringLength`
 *   characters of a string (a string that is the value itself: up to about `characters`);
 * - an object shows its first `keys` own enumerable keys, then `... N more keys`;
 * - the text of one value is cut after `characters` characters: `… (N more characters)`;
 * - a call shows its first MAX_PRINTED_ARGUMENTS arguments, then `... N more arguments`.
 * A failure message also lists received calls only up to a number of characters (see SubstituteException).
 * The keys are capped by printing a copy of the object (see printable): util.inspect has no such option.
 */
export type PrintBounds = {
  readonly depth: number
  readonly maxArrayLength: number
  readonly maxStringLength: number
  readonly keys: number
  readonly characters: number
  /** util.inspect's breakLength; its default (80) when undefined. */
  readonly breakLength?: number
}

/** Values in failure messages and printouts. */
export const MESSAGE_BOUNDS: PrintBounds = { depth: 1, maxArrayLength: 20, maxStringLength: 200, keys: 20, characters: 1000 }

/** Arguments in the path of an auto-substitute (`@Substitute.lookup({ id: 1 })`), on one line. */
export const PATH_BOUNDS: PrintBounds = { depth: 0, maxArrayLength: 10, maxStringLength: 100, keys: 10, characters: 200, breakLength: Infinity }

/** The own properties and the cause of an error, inside its compact form (E45), on one line. */
const ERROR_PROPERTY_BOUNDS: PrintBounds = { depth: 0, maxArrayLength: 10, maxStringLength: 100, keys: 10, characters: 200, breakLength: Infinity }

/** A call shows at most this many arguments. */
export const MAX_PRINTED_ARGUMENTS = 20

/** Room for the quotes and util.inspect's `... N more characters` around a string that is cut (see stringLimit). */
const STRING_ROOM = 40

/** Cuts a text after `characters` characters (not inside a surrogate pair): `… (N more characters)`. */
export const truncateText = (text: string, characters: number): string => {
  if (text.length <= characters) return text
  let end = characters
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return `${text.slice(0, end)}… (${text.length - end} more characters)`
}

/** Whether a value is an error: a native error, or an object with Error.prototype in its prototype chain. */
const isError = (value: unknown): value is Error => {
  // a substitute is a function (proxy), never an error; reading from it would be recorded
  if (typeof value !== 'object' || value === null) return false
  try {
    return types.isNativeError(value) || value instanceof Error
  } catch {
    return false // a revoked proxy
  }
}

const errorHead = (error: Error): string => {
  const name = typeof error.name === 'string' && error.name !== '' ? error.name : 'Error'
  const message = typeof error.message === 'string' ? error.message : String(error.message)
  return message === '' ? `[${name}]` : `[${name}: ${message}]`
}

const propertyIsEnumerable = Object.prototype.propertyIsEnumerable
const hasOwnProperty = Object.prototype.hasOwnProperty

/** The own enumerable string and symbol keys, the keys util.inspect shows (in its order). */
const ownEnumerableKeys = (object: object): PropertyKey[] => {
  const keys: PropertyKey[] = Object.keys(object)
  const symbols = Object.getOwnPropertySymbols(object)
  for (let index = 0; index < symbols.length; index++) if (propertyIsEnumerable.call(object, symbols[index])) keys.push(symbols[index])
  return keys
}

/** A key as util.inspect shows it: `status`, `'content-type'`, `[Symbol(id)]`. */
const keyText = (key: PropertyKey): string =>
  typeof key === 'symbol' ? `[${key.toString()}]` : /^[A-Za-z_$][\w$]*$/.test(key as string) ? key as string : inspect(key)

/** The errors whose compact form is being built (an error among its own properties or causes shows only its head). */
const formattingErrors = new Set<Error>()
/** How many causes deep a compact form shows the properties and the cause of an error. */
const MAX_CAUSE_DEPTH = 3
let causeDepth = 0

/**
 * E40, E45: an error as a value in a message or a printout, without its stack (whose frames would look like the "called
 * at" lines of the calls), as util.inspect shows an error without a stack: `[SyntaxError: Unexpected end of JSON input]`,
 * with its own enumerable properties other than name, message and stack, which tell errors apart (`status`, `code`),
 * and its cause, likewise: `[HttpError: not found] { status: 404, [cause]: [TypeError: x is undefined] }`. The
 * properties are printed briefly (see ERROR_PROPERTY_BOUNDS), errors among them compactly as well.
 */
const compactError = (error: Error): string => {
  const head = errorHead(error)
  if (formattingErrors.has(error) || causeDepth >= MAX_CAUSE_DEPTH) return head
  formattingErrors.add(error)
  causeDepth++
  try {
    const parts: string[] = []
    const keys = ownEnumerableKeys(error).filter(key => key !== 'name' && key !== 'message' && key !== 'stack' && key !== 'cause')
    const shown = Math.min(keys.length, ERROR_PROPERTY_BOUNDS.keys)
    for (let index = 0; index < shown; index++) {
      const key = keys[index]
      const descriptor = Object.getOwnPropertyDescriptor(error, key)
      const value = descriptor === undefined ? undefined
        : 'value' in descriptor ? formatBounded(descriptor.value, ERROR_PROPERTY_BOUNDS, false)
          : descriptor.get !== undefined ? (descriptor.set !== undefined ? '[Getter/Setter]' : '[Getter]') : '[Setter]'
      parts.push(`${keyText(key)}: ${value}`)
    }
    if (keys.length > shown) parts.push(`... ${keys.length - shown} more ${keys.length - shown === 1 ? 'key' : 'keys'}`)
    if (hasOwnProperty.call(error, 'cause')) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'cause')
      const cause = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
      parts.push(`[cause]: ${descriptor !== undefined && !('value' in descriptor) ? '[Getter]' : formatBounded(cause, ERROR_PROPERTY_BOUNDS, false)}`)
    }
    return parts.length === 0 ? head : `${head} { ${parts.join(', ')} }`
  } finally {
    causeDepth--
    formattingErrors.delete(error)
  }
}

/** What util.inspect calls on a value that prints itself (its custom inspection). */
const inspectCustom: symbol = inspect.custom

/** A value that prints as `print` returns (util.inspect calls it with the depth left and its options). */
const printsAs = (print: (depth: number, options: InspectOptions) => string): object => ({
  [inspectCustom]: (depth: number, options: InspectOptions) => print(depth, options)
})

/** An error's stand-in: its compact form (E45), at any depth. */
const errorStandIn = (error: Error): object => {
  let text: string
  try {
    text = compactError(error)
  } catch {
    // an error whose name, message or properties cannot be read
    text = inspect(error, { depth: -1 })
  }
  return printsAs(() => text)
}

/**
 * The text of a copy of a container that shows only some of its entries, with `... N more <unit>` added at its end (and,
 * for a Map or a Set, its real size): `{ k0: 0, k1: 1, ... 4998 more keys }`, `Map(5000) { 0 => 0, ... 4999 more items }`.
 */
const withMore = (copy: object, hidden: number, unit: string, size?: [number, number]) => printsAs((depth, options) => {
  let text = inspect(copy, { ...options, depth })
  if (depth < 0) return text // `[Object]`, `[Map]`: nothing more to say
  if (size !== undefined) text = text.replace(`(${size[0]})`, `(${size[1]})`)
  const more = `... ${hidden} more ${hidden === 1 ? unit.slice(0, -1) : unit}`
  if (text.endsWith(' }')) return `${text.slice(0, -2)}, ${more} }`
  if (text.endsWith('\n}')) return `${text.slice(0, -2)},\n  ${more}\n}`
  if (text.endsWith('{}')) return `${text.slice(0, -1)} ${more} }`
  return `${text} ${more}`
})

// util.types.isBoxedPrimitive is missing from Node.js 10.0 (and from older typings)
const typeChecks = types as unknown as Record<string, ((value: unknown) => boolean) | undefined>
const isBoxedPrimitive = typeChecks.isBoxedPrimitive ??
  ((value: unknown) => types.isNumberObject(value) || types.isStringObject(value) || types.isBooleanObject(value) || types.isSymbolObject(value))

/**
 * Objects that util.inspect shows by their own keys alone (plain objects, class instances), so that a copy with the
 * same prototype and some of the keys prints like them. Not: proxies (util.inspect shows their target), objects with a
 * custom inspection (URLs, matchers, substitutes' printers), and the kinds util.inspect shows by their internal state.
 */
const printsByKeys = (object: object): boolean => {
  if (types.isProxy(object) || typeof (object as any)[inspectCustom] === 'function') return false
  const prototype = Object.getPrototypeOf(object)
  if (prototype === Object.prototype || prototype === null) return true
  return !(types.isAnyArrayBuffer(object) || types.isArrayBufferView(object) || types.isDate(object) || types.isRegExp(object) ||
    isBoxedPrimitive(object) || types.isPromise(object) || types.isWeakMap(object) || types.isWeakSet(object) ||
    types.isMapIterator(object) || types.isSetIterator(object) || types.isGeneratorObject(object) || types.isArgumentsObject(object) ||
    types.isModuleNamespaceObject(object) || types.isExternal(object) || types.isMap(object) || types.isSet(object))
}

/** One preparation of a value for printing: the bounds and the copies made so far (by original, for cycles). */
type Walk = { readonly bounds: PrintBounds, readonly copies: Map<object, unknown> }

// the Map and Set methods themselves, which an instance (or a subclass) cannot replace
const mapEntries = Map.prototype.entries
const mapSet = Map.prototype.set
const setValues = Set.prototype.values
const setAdd = Set.prototype.add
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!

/**
 * E44, E45: what util.inspect is given to print a value within the bounds: the value itself, or, where it holds an error
 * (at any depth util.inspect shows, and one level below) or an object with more keys than the bounds allow, a copy in
 * which errors are their compact stand-ins and wide objects show their first keys. Only the levels that util.inspect
 * shows are looked at, so preparing a value costs as little as printing it. Getters are not run.
 */
const prepared = (value: unknown, level: number, walk: Walk): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const known = walk.copies.get(value)
  if (known !== undefined) return known
  if (isError(value)) {
    const standIn = errorStandIn(value)
    walk.copies.set(value, standIn)
    return standIn
  }
  // deeper than util.inspect looks (it shows `[Object]`): only errors are replaced, as their stand-in shows more
  if (level > walk.bounds.depth) return value
  if (Array.isArray(value)) return types.isProxy(value) ? value : preparedArray(value, level, walk)
  if ((types.isMap(value) || types.isSet(value)) && !types.isProxy(value) && typeof (value as any)[inspectCustom] !== 'function')
    return preparedCollection(value as Map<unknown, unknown>, types.isMap(value), level, walk)
  return printsByKeys(value) ? preparedKeyed(value, level, walk) : value
}

/** An array: its first maxArrayLength items (util.inspect shows how many more there are, as the copy has the same length). */
const preparedArray = (array: unknown[], level: number, walk: Walk): unknown => {
  const length = array.length
  const count = Math.min(length, walk.bounds.maxArrayLength)
  const copy: unknown[] = new Array(length)
  const prototype = Object.getPrototypeOf(array)
  if (prototype !== Array.prototype) Object.setPrototypeOf(copy, prototype)
  walk.copies.set(array, copy)
  let changed = false
  for (let index = 0; index < count; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(array, index)
    if (descriptor === undefined) continue // a hole
    if ('value' in descriptor) {
      const item = prepared(descriptor.value, level + 1, walk)
      if (item !== descriptor.value) changed = true
      copy[index] = item
    } else Object.defineProperty(copy, index, { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true })
  }
  if (changed) return copy
  walk.copies.set(array, array)
  return array
}

/** An object shown by its keys: its first `keys` own enumerable keys, data properties prepared, accessors as they are. */
const preparedKeyed = (object: object, level: number, walk: Walk): unknown => {
  const keys = ownEnumerableKeys(object)
  const count = Math.min(keys.length, walk.bounds.keys)
  const hidden = keys.length - count
  const copy = Object.create(Object.getPrototypeOf(object))
  const result = hidden > 0 ? withMore(copy, hidden, 'keys') : copy
  walk.copies.set(object, result)
  let changed = hidden > 0
  for (let index = 0; index < count; index++) {
    const key = keys[index]
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (descriptor === undefined) continue
    if ('value' in descriptor) {
      const item = prepared(descriptor.value, level + 1, walk)
      if (item !== descriptor.value) changed = true
      Object.defineProperty(copy, key, { value: item, writable: true, enumerable: true, configurable: true })
    } else Object.defineProperty(copy, key, { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true })
  }
  if (changed) return result
  walk.copies.set(object, object)
  return object
}

/**
 * A Map or a Set: its first maxArrayLength entries, prepared. A copy that leaves entries out shows the real size and how
 * many more there are (util.inspect would show the size of the copy).
 */
const preparedCollection = (collection: Map<unknown, unknown> | Set<unknown>, isMap: boolean, level: number, walk: Walk): unknown => {
  const size: number = (isMap ? mapSize : setSize).call(collection)
  const count = Math.min(size, walk.bounds.maxArrayLength)
  const copy: Map<unknown, unknown> | Set<unknown> = isMap ? new Map() : new Set()
  Object.setPrototypeOf(copy, Object.getPrototypeOf(collection))
  const result = size > count ? withMore(copy, size - count, 'items', [count, size]) : copy
  walk.copies.set(collection, result)
  let changed = false
  const iterator: Iterator<unknown> = (isMap ? mapEntries : setValues).call(collection)
  for (let index = 0; index < count; index++) {
    const step = iterator.next()
    if (step.done === true) break
    if (isMap) {
      const [key, value] = step.value as [unknown, unknown]
      const preparedKey = prepared(key, level + 1, walk)
      const preparedValue = prepared(value, level + 1, walk)
      if (preparedKey !== key || preparedValue !== value) changed = true
      mapSet.call(copy, preparedKey, preparedValue)
    } else {
      const member = prepared(step.value, level + 1, walk)
      if (member !== step.value) changed = true
      setAdd.call(copy, member)
    }
  }
  if (changed) return result
  walk.copies.set(collection, collection)
  return collection
}

/**
 * How many characters of a string util.inspect shows: a string that is the value itself up to about the whole length
 * of a value's text, a string inside another value maxStringLength.
 */
const stringLimit = (value: unknown, bounds: PrintBounds): number =>
  typeof value === 'string' ? Math.max(bounds.maxStringLength, bounds.characters - STRING_ROOM) : bounds.maxStringLength

/**
 * E44: a value as messages, printouts and paths show it, within `bounds` (see PrintBounds): errors compactly (E40, E45),
 * anything else with a bounded util.inspect, cut after `bounds.characters` characters.
 */
export const formatBounded = (value: unknown, bounds: PrintBounds, colors: boolean): string => {
  const options: InspectOptions = {
    depth: bounds.depth,
    maxArrayLength: bounds.maxArrayLength,
    maxStringLength: stringLimit(value, bounds),
    colors
  }
  if (bounds.breakLength !== undefined) options.breakLength = bounds.breakLength
  let printable: unknown
  try {
    printable = prepared(value, 0, { bounds, copies: new Map() })
  } catch {
    printable = value // a value that cannot be looked at: util.inspect shows what it can, within the bounds above
  }
  const text = inspect(printable, options)
  if (text.length <= bounds.characters) return text
  // cut without the colours, so that no escape sequence is cut in two
  return truncateText(colors ? inspect(printable, { ...options, colors: false }) : text, bounds.characters)
}

export const formatValue = (value: unknown, colors: boolean, bounds: PrintBounds = MESSAGE_BOUNDS): string => {
  try {
    return withPrintGuard(() => formatBounded(value, bounds, colors))
  } catch {
    return `<${typeof value}>`
  }
}

/** The arguments of a call: `(1, 'a')`, at most MAX_PRINTED_ARGUMENTS of them, each one bounded (E44). */
export const formatArguments = (args: readonly unknown[] | undefined, colors: boolean, bounds: PrintBounds = MESSAGE_BOUNDS): string => {
  if (args === undefined) return ''
  const shown = args.length > MAX_PRINTED_ARGUMENTS ? args.slice(0, MAX_PRINTED_ARGUMENTS) : args
  const texts = shown.map(arg => formatValue(arg, colors, bounds))
  const hidden = args.length - shown.length
  if (hidden > 0) texts.push(`... ${hidden} more ${hidden === 1 ? 'argument' : 'arguments'}`)
  return `(${texts.join(', ')})`
}

/**
 * D26: for the direct-call reading of an invocation through call/apply, how it was written (` via .call(t, 1)`).
 * Typed structurally, so that this module does not depend on CallRecord.
 */
export const describeOtherReading = (
  record: { directReading?: boolean, twin?: { key: PropertyKey, args?: readonly unknown[] } },
  colors: boolean
): string => {
  const twin = record.twin
  if (record.directReading !== true || twin === undefined) return ''
  return ` via .${String(twin.key)}${formatArguments(twin.args, colors)}`
}

/** The first "at ..." line of a stack trace, if there is one (there is none with Error.stackTraceLimit = 0). */
export const firstStackFrame = (stack: string | undefined): string | undefined => {
  if (typeof stack !== 'string') return undefined
  const lines = stack.split('\n')
  for (let index = 1; index < lines.length; index++) {
    if (/^\s*at /.test(lines[index])) return lines[index]
  }
  return undefined
}

export const plural = (word: string, count: number | undefined) => `${word}${count === 1 ? '' : 's'}`
