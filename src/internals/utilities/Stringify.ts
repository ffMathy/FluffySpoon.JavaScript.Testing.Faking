import { inspect, InspectOptions, types } from 'util'
import { isArgumentMatcher } from '../../shared'

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
 * The keys are capped by printing a copy of the object (see prepared): util.inspect has no such option.
 * E54: and what util.inspect is given to print holds only the entries that can show before the cut (see Walk.budget),
 * so that a value with many nested objects (20 keys of 20 keys of 20 keys, ...) costs no more than a small one.
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

/**
 * Values in failure messages and printouts. E54: two levels deep, as util.inspect's default, so that a failure message
 * shows where the expected call differs from a received one in arguments such as `{ where: { email: { contains: 'a' } } }`
 * (filters of ORMs, nested DTOs). A failure message prints an expected call and a received call that still print alike
 * up to MAX_MESSAGE_DEPTH levels deep (see messageBounds and SubstituteException).
 */
export const MESSAGE_BOUNDS: PrintBounds = { depth: 2, maxArrayLength: 20, maxStringLength: 200, keys: 20, characters: 1000 }

/** E54: how deep a failure message prints an expected and a received call that print alike at MESSAGE_BOUNDS' depth. */
export const MAX_MESSAGE_DEPTH = 4

const deeperMessageBounds: PrintBounds[] = []

/** The bounds of values in failure messages, `depth` levels deep (MESSAGE_BOUNDS at its own depth). */
export const messageBounds = (depth: number): PrintBounds => depth === MESSAGE_BOUNDS.depth
  ? MESSAGE_BOUNDS
  : deeperMessageBounds[depth] ?? (deeperMessageBounds[depth] = { ...MESSAGE_BOUNDS, depth })

/** Arguments in the path of an auto-substitute (`@Substitute.lookup({ id: 1 })`), on one line. */
export const PATH_BOUNDS: PrintBounds = { depth: 0, maxArrayLength: 10, maxStringLength: 100, keys: 10, characters: 200, breakLength: Infinity }

/** The own properties and the cause of an error, inside its compact form (E45), on one line. */
const ERROR_PROPERTY_BOUNDS: PrintBounds = { depth: 0, maxArrayLength: 10, maxStringLength: 100, keys: 10, characters: 200, breakLength: Infinity }

/** A call shows at most this many arguments. */
export const MAX_PRINTED_ARGUMENTS = 20

/** Room for the quotes and util.inspect's `... N more characters` around a string that is cut (see stringLimit). */
const STRING_ROOM = 40

/**
 * Cuts a text after `characters` characters (not inside a surrogate pair): `… (N more characters)`. `partial`: the text
 * is only the start of the value's text (see Walk.budget), which is longer than `characters`: `… (more characters)`.
 */
export const truncateText = (text: string, characters: number, partial = false): string => {
  if (text.length <= characters && !partial) return text
  let end = Math.min(characters, text.length)
  const last = text.charCodeAt(end - 1)
  if (end === characters && last >= 0xd800 && last <= 0xdbff) end--
  return `${text.slice(0, end)}… (${partial ? 'more' : text.length - end + ' more'} characters)`
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

/**
 * A value that prints as `print` returns (util.inspect calls it with the depth left and its options). A stand-in that is
 * asked to print while it is printing (a container that refers back to itself, which util.inspect cannot see through
 * the stand-in) prints as `[Circular]`.
 */
const printsAs = (print: (depth: number, options: InspectOptions) => string): object => {
  let printing = false
  return {
    [inspectCustom]: (depth: number, options: InspectOptions) => {
      if (printing) return '[Circular]'
      printing = true
      try {
        return print(depth, options)
      } finally {
        printing = false
      }
    }
  }
}

/** An error's stand-in: its compact form (E45), at any depth. */
const errorStandIn = (text: string): object => printsAs(() => text)

/** The compact form of an error (E45). */
const errorText = (error: Error): string => {
  try {
    return compactError(error)
  } catch {
    // an error whose name, message or properties cannot be read
    return inspect(error, { depth: -1 })
  }
}

// the Map and Set methods themselves, which an instance (or a subclass) cannot replace
const mapEntries = Map.prototype.entries
const mapSet = Map.prototype.set
const setValues = Set.prototype.values
const setAdd = Set.prototype.add
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!

/** What a copy that shows only some of the entries of a container adds at its end (see withMore). */
type More = { hidden: number, readonly unit: string }

/**
 * The text of a copy of a container that shows only some of its entries, with `... N more <unit>` added at its end (and,
 * for a Map or a Set, its real size `size`): `{ k0: 0, k1: 1, ... 4998 more keys }`, `Map(5000) { 0 => 0, ... 4999 more
 * items }`. `more.hidden` is read when it prints (it can be 0: a Map or a Set that shows its real size only).
 */
const withMore = (copy: object, more: More, size?: number) => printsAs((depth, options) => {
  let text = inspect(copy, { ...options, depth })
  if (depth < 0) return text // `[Object]`, `[Map]`: nothing more to say
  if (size !== undefined) text = text.replace(`(${(types.isMap(copy) ? mapSize : setSize).call(copy)})`, `(${size})`)
  const hidden = more.hidden
  if (hidden === 0) return text
  const marker = `... ${hidden} more ${hidden === 1 ? more.unit.slice(0, -1) : more.unit}`
  if (text.endsWith(' }')) return `${text.slice(0, -2)}, ${marker} }`
  if (text.endsWith('\n}')) return `${text.slice(0, -2)},\n  ${marker}\n}`
  if (text.endsWith('{}')) return `${text.slice(0, -1)} ${marker} }`
  return `${text} ${marker}`
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

/*
 * E54: matchers nested at any depth are shown. The arguments of a setup or a check can hold matchers nested in plain
 * objects and arrays (D27); RecordedArguments notes the containers that hold one. Such a container deeper than
 * util.inspect looks is shown anyway (with the levels below it as util.inspect shows them, so other objects there are
 * `[Object]`): `{ data: { profile: { name: Arg.is(...) } } }`, also one level deeper.
 */
const matcherHolders = new WeakSet<object>()

/** Notes a plain object or array in the arguments of a setup or a check that holds a matcher somewhere inside. */
export const noteMatcherHolder = (container: object): void => {
  matcherHolders.add(container)
}

/** How many entries deepestMatcher looks at, at most. */
const MATCHER_SEARCH_ENTRIES = 1000

/**
 * E54: how deep the deepest matcher in the arguments of a setup or a check is (an argument itself: 0, a value inside an
 * argument: 1, ...), looking through the containers noted as holding one, at most `limit` levels deep; -1 for none.
 */
export const deepestMatcher = (args: readonly unknown[], limit: number): number => {
  let deepest = -1
  let entries = MATCHER_SEARCH_ENTRIES
  const seen = new Set<object>()
  const visit = (value: unknown, level: number): void => {
    if (isArgumentMatcher(value)) {
      if (level > deepest) deepest = level
      return
    }
    if (level >= limit || typeof value !== 'object' || value === null || !matcherHolders.has(value) || seen.has(value) || types.isProxy(value)) return
    seen.add(value)
    for (const key of ownEnumerableKeys(value)) {
      if (--entries < 0) return
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor !== undefined && 'value' in descriptor) visit(descriptor.value, level + 1)
    }
  }
  try {
    for (const argument of args) visit(argument, 0)
  } catch {
    // a container that cannot be read
  }
  return deepest
}

/** Settings for tests. `budget`: whether a value is prepared only as far as it shows before the cut (see Walk.budget). */
export const printSettings = { budget: true }

/**
 * E54: how many characters, beyond `characters`, the entries copied for a value take at least before the copying ends
 * (see Walk.budget). util.inspect lays a container out on one line (when it fits in breakLength) or as a grid of short
 * items (an array of at most 21 items of at most about 16 characters) from all of its entries, so leaving out entries
 * can change the layout of a container that ends within some 500 characters of the point where entries are left out.
 * Everything before that is printed as it would be with every entry.
 */
const BUDGET_MARGIN = 1000

/**
 * One preparation of a value for printing (see prepared).
 * - `ancestors`: the containers being prepared, with what an entry that refers back to one of them (a cycle) is given;
 * - `budget`: E54, how many characters are left for the entries. Each entry that is copied takes off at least as many
 *   characters as util.inspect prints for it before its value's own entries start (separator, key, primitive value), and
 *   the entries are copied in the order util.inspect prints them. Once the budget has run out (the text then has at least
 *   `characters` + BUDGET_MARGIN characters before that point), no more entries are copied: every container being copied
 *   ends there, and a value whose text would be cut anyway costs no more to print than one of about that length. Its text
 *   is then only the start of the full text, which is cut as usual, and ends with `… (more characters)`
 *   (`exhausted`).
 * Shared values are prepared again wherever they are printed (util.inspect prints them there again, too), so the budget
 * counts what is printed.
 */
type Walk = {
  readonly bounds: PrintBounds
  readonly ancestors: Map<object, unknown>
  budget: number
  exhausted: boolean
}

/** At least how many characters util.inspect prints for a value (for a container: before its entries). */
const leastLength = (value: unknown, level: number, walk: Walk): number => {
  switch (typeof value) {
    case 'string': return Math.min(value.length, walk.bounds.maxStringLength) + 2
    case 'number':
    case 'bigint':
    case 'boolean': return String(value).length
    case 'undefined': return 9
    case 'symbol': return value.toString().length
    case 'object':
      if (value === null) return 4
      // deeper than util.inspect looks: `[Object]`, `[Array]` (other objects may print themselves, or `[Foo]`)
      if (level > walk.bounds.depth && !types.isProxy(value) && !hasOwnProperty.call(value, inspectCustom) && !matcherHolders.has(value)) {
        if (Array.isArray(value)) return 7
        if (Object.getPrototypeOf(value) === Object.prototype) return 8
      }
      return 0
    default: return 0 // a function: a substitute prints its path
  }
}

/** At least how many characters util.inspect prints for a key: `name`, `'content-type'`, `[Symbol(id)]`. */
const keyLength = (key: PropertyKey): number => typeof key === 'symbol' ? key.toString().length + 2 : String(key).length

/**
 * Takes an entry off the budget (see Walk): `characters` (the separator before it, its key, at least the start of its
 * value). False when the budget has run out before it, and the entry is not copied.
 */
const spend = (walk: Walk, characters: number): boolean => {
  if (walk.budget <= 0) {
    walk.exhausted = true
    return false
  }
  walk.budget -= characters
  return true
}

/** The separator before an entry, or the opening bracket and space before the first one. */
const SEPARATOR = 2

/**
 * E44, E45, E54: what util.inspect is given to print a value within the bounds: the value itself, or, where it holds an
 * error (at any depth util.inspect shows, and one level below), an object with more keys than the bounds allow, a
 * container that holds a matcher deeper than util.inspect looks, or more entries than show before the cut (see Walk), a
 * copy in which errors are their compact stand-ins, wide objects show their first keys, such containers show what they
 * hold, and only the entries that show are copied. Only the levels that util.inspect shows are looked at, so preparing a
 * value costs as little as printing it. Getters are not run.
 */
const prepared = (value: unknown, level: number, walk: Walk): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const ancestor = walk.ancestors.get(value)
  if (ancestor !== undefined) return ancestor // a cycle
  if (isError(value)) {
    const text = errorText(value)
    walk.budget -= text.length
    return errorStandIn(text)
  }
  if (level > walk.bounds.depth) {
    // deeper than util.inspect looks (it shows `[Object]`): only errors are replaced, as their stand-in shows more, and
    // containers that hold a matcher are shown
    if (!matcherHolders.has(value) || types.isProxy(value)) return value
    const copy = Array.isArray(value) ? preparedArray(value, level, walk) : preparedKeyed(value, level, walk)
    return printsAs((_, options) => inspect(copy, { ...options, depth: 0 }))
  }
  if (Array.isArray(value)) return types.isProxy(value) ? value : preparedArray(value, level, walk)
  if ((types.isMap(value) || types.isSet(value)) && !types.isProxy(value) && typeof (value as any)[inspectCustom] !== 'function')
    return preparedCollection(value as Map<unknown, unknown> | Set<unknown>, types.isMap(value), level, walk)
  return printsByKeys(value) ? preparedKeyed(value, level, walk) : value
}

/** An array: its first maxArrayLength items (util.inspect shows how many more there are, as the copy has the same length). */
const preparedArray = (array: unknown[], level: number, walk: Walk): unknown => {
  const length = array.length
  const count = Math.min(length, walk.bounds.maxArrayLength)
  const copy: unknown[] = new Array(length)
  const prototype = Object.getPrototypeOf(array)
  if (prototype !== Array.prototype) Object.setPrototypeOf(copy, prototype)
  walk.ancestors.set(array, copy)
  let changed = false
  try {
    for (let index = 0; index < count; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(array, index)
      if (descriptor === undefined) continue // a hole
      if ('value' in descriptor) {
        if (!spend(walk, SEPARATOR + leastLength(descriptor.value, level + 1, walk))) {
          changed = true
          break
        }
        const item = prepared(descriptor.value, level + 1, walk)
        if (item !== descriptor.value) changed = true
        copy[index] = item
      } else {
        if (!spend(walk, SEPARATOR + 8)) { // `[Getter]`
          changed = true
          break
        }
        Object.defineProperty(copy, index, { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true })
      }
    }
  } finally {
    walk.ancestors.delete(array)
  }
  return changed ? copy : array
}

/** An object shown by its keys: its first `keys` own enumerable keys, data properties prepared, accessors as they are. */
const preparedKeyed = (object: object, level: number, walk: Walk): unknown => {
  const keys = ownEnumerableKeys(object)
  const count = Math.min(keys.length, walk.bounds.keys)
  const more: More = { hidden: keys.length - count, unit: 'keys' }
  const copy = Object.create(Object.getPrototypeOf(object))
  const result = more.hidden > 0 ? withMore(copy, more) : copy
  walk.ancestors.set(object, result)
  let changed = more.hidden > 0
  try {
    for (let index = 0; index < count; index++) {
      const key = keys[index]
      const descriptor = Object.getOwnPropertyDescriptor(object, key)
      if (descriptor === undefined) continue
      const isData = 'value' in descriptor
      if (!spend(walk, SEPARATOR + keyLength(key) + 2 + (isData ? leastLength(descriptor.value, level + 1, walk) : 8))) {
        changed = true
        break
      }
      if (isData) {
        const item = prepared(descriptor.value, level + 1, walk)
        if (item !== descriptor.value) changed = true
        Object.defineProperty(copy, key, { value: item, writable: true, enumerable: true, configurable: true })
      } else Object.defineProperty(copy, key, { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true })
    }
  } finally {
    walk.ancestors.delete(object)
  }
  return changed ? result : object
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
  const more: More = { hidden: size - count, unit: 'items' }
  const sized = more.hidden > 0 ? withMore(copy, more, size) : undefined
  walk.ancestors.set(collection, sized ?? copy)
  let changed = false
  let truncated = false
  try {
    const iterator: Iterator<unknown> = (isMap ? mapEntries : setValues).call(collection)
    for (let index = 0; index < count; index++) {
      const step = iterator.next()
      if (step.done === true) break
      if (isMap) {
        const [key, value] = step.value as [unknown, unknown]
        if (!spend(walk, SEPARATOR + leastLength(key, level + 1, walk) + 4 + leastLength(value, level + 1, walk))) {
          truncated = true
          break
        }
        const preparedKey = prepared(key, level + 1, walk)
        const preparedValue = prepared(value, level + 1, walk)
        if (preparedKey !== key || preparedValue !== value) changed = true
        mapSet.call(copy, preparedKey, preparedValue)
      } else {
        if (!spend(walk, SEPARATOR + leastLength(step.value, level + 1, walk))) {
          truncated = true
          break
        }
        const member = prepared(step.value, level + 1, walk)
        if (member !== step.value) changed = true
        setAdd.call(copy, member)
      }
    }
  } finally {
    walk.ancestors.delete(collection)
  }
  // the budget ran out: the copy has fewer entries, and shows the real size
  if (truncated) return sized ?? withMore(copy, { hidden: 0, unit: 'items' }, size)
  return sized ?? (changed ? copy : collection)
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
  const walk: Walk = { bounds, ancestors: new Map(), budget: printSettings.budget ? bounds.characters + BUDGET_MARGIN : Infinity, exhausted: false }
  let printable: unknown
  try {
    printable = prepared(value, 0, walk)
  } catch {
    printable = value // a value that cannot be looked at: util.inspect shows what it can, within the bounds above
    walk.exhausted = false
  }
  const text = inspect(printable, options)
  if (text.length <= bounds.characters && !walk.exhausted) return text
  // cut without the colours, so that no escape sequence is cut in two
  return truncateText(colors ? inspect(printable, { ...options, colors: false }) : text, bounds.characters, walk.exhausted)
}

export const formatValue = (value: unknown, colors: boolean, bounds: PrintBounds = MESSAGE_BOUNDS): string => {
  try {
    return withPrintGuard(() => formatBounded(value, bounds, colors))
  } catch {
    return `<${typeof value}>`
  }
}

/**
 * The arguments of a call: `(1, 'a')`, at most MAX_PRINTED_ARGUMENTS of them, each one bounded (E44). `format`: prints
 * one argument (formatValue by default).
 */
export const formatArguments = (
  args: readonly unknown[] | undefined,
  colors: boolean,
  bounds: PrintBounds = MESSAGE_BOUNDS,
  format: (value: unknown) => string = value => formatValue(value, colors, bounds)
): string => {
  if (args === undefined) return ''
  const shown = args.length > MAX_PRINTED_ARGUMENTS ? args.slice(0, MAX_PRINTED_ARGUMENTS) : args
  const texts = shown.map(arg => format(arg))
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
