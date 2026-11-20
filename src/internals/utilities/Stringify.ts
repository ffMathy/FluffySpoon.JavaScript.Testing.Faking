import { inspect, InspectOptions, types } from 'util'
import { foreignMatcherLabel, isAllArguments, isArgumentMatcher } from '../../shared'
import { libraryGuard } from './Guard'

/**
 * Runs `print` while marking that the library is printing. Substitutes met while printing (for example a
 * substitute recorded as an argument of another substitute) are printed in their short form, so
 * printing never recurses through substitutes, even when they reference each other.
 * E63: the mark is shared by every copy of the package (see Guard), so that a substitute of another copy met while
 * printing is printed in its short form, and records nothing, too.
 */
export const withPrintGuard = <T>(print: () => T): T => {
  libraryGuard.printing++
  try {
    return print()
  } finally {
    libraryGuard.printing--
  }
}

export const isPrinting = (): boolean => libraryGuard.printing > 0

/*
 * E44: bounded printing. Every value that a failure message, a printout of a substitute (String(), util.inspect) or a
 * path shows (an argument, an assigned value, a configured value) is printed within bounds, whatever its size: a DOM
 * event that holds its element, document and window, or an object with 5,000 keys, gives a few lines.
 * - util.inspect goes `depth` levels deep, shows `maxArrayLength` items of an array, Map or Set and `maxStringLength`
 *   characters of a string (a string that is the value itself: up to about `characters`);
 * - an object shows its first `keys` own enumerable keys, then `... N more keys`;
 * - the text of one value is cut after `characters` characters: `… (N more characters)`;
 * - a call shows its first MAX_PRINTED_ARGUMENTS arguments, then `... N more arguments`.
 * A failure message also lists received calls only up to a number of characters (see SubstituteException).
 * The keys are capped by printing a copy of the object (see prepared): util.inspect has no such option.
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

/** The bounds of values in failure messages, `depth` levels deep. */
export const messageBounds = (depth: number): PrintBounds => ({ ...MESSAGE_BOUNDS, depth })

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
const compactError = (error: Error, sorted = false): string => {
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
        : 'value' in descriptor ? formatBounded(descriptor.value, ERROR_PROPERTY_BOUNDS, false, sorted)
          : descriptor.get !== undefined ? (descriptor.set !== undefined ? '[Getter/Setter]' : '[Getter]') : '[Setter]'
      parts.push(`${keyText(key)}: ${value}`)
    }
    // E78: in a fixed order, and so are the keys and entries in them (see leastDifference)
    if (sorted) parts.sort()
    if (keys.length > shown) parts.push(`... ${keys.length - shown} more ${keys.length - shown === 1 ? 'key' : 'keys'}`)
    if (hasOwnProperty.call(error, 'cause')) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'cause')
      const cause = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
      parts.push(`[cause]: ${descriptor !== undefined && !('value' in descriptor) ? '[Getter]' : formatBounded(cause, ERROR_PROPERTY_BOUNDS, false, sorted)}`)
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

/** The compact form of an error (E45). `sorted`: see compactError. */
const errorText = (error: Error, sorted = false): string => {
  try {
    return compactError(error, sorted)
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

/**
 * The text of a copy of a container that shows only some of its entries, with `... N more <unit>` added at its end (and,
 * for a Map or a Set, its real size `size`): `{ k0: 0, k1: 1, ... 4998 more keys }`, `Map(5000) { 0 => 0, ... 4999 more
 * items }`.
 */
const withMore = (copy: object, hidden: number, unit: string, size?: number) => printsAs((depth, options) => {
  let text = inspect(copy, { ...options, depth })
  if (depth < 0) return text // `[Object]`, `[Map]`: nothing more to say
  if (size !== undefined) text = text.replace(`(${(types.isMap(copy) ? mapSize : setSize).call(copy)})`, `(${size})`)
  const marker = `... ${hidden} more ${hidden === 1 ? unit.slice(0, -1) : unit}`
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

/**
 * E54: how deep the deepest matcher in the arguments of a setup or a check is (an argument itself: 0, a value inside an
 * argument: 1, ...), looking through the containers noted as holding one, at most `limit` levels deep; -1 for none.
 */
export const deepestMatcher = (args: readonly unknown[], limit: number): number => {
  let deepest = -1
  const seen = new Set<object>()
  const visit = (value: unknown, level: number): void => {
    if (isArgumentMatcher(value)) {
      if (level > deepest) deepest = level
      return
    }
    if (level >= limit || typeof value !== 'object' || value === null || !matcherHolders.has(value) || seen.has(value) || types.isProxy(value)) return
    seen.add(value)
    for (const key of ownEnumerableKeys(value)) {
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

/*
 * E59, E72, E78: whether an expected call and a received call that it does not match print alike `depth` levels deep, in
 * what matching sees. A failure message prints such lines deeper (see SubstituteException.deeperLines), and numbers their
 * substitutes when that tells them apart (E79, see SubstituteException.printsAlike).
 * - A matcher in the expected call prints by its label, so that alone does not tell the lines apart (R10-ADV-1): it
 *   stands for the received value at its place where matching takes it as a matcher, at the top level and in plain
 *   objects and arrays (D27); inside a class instance, a Map or a Set it is a value like any other, shown by its label.
 *   Arg.all() stands for the rest of the received arguments.
 * - Orders that matching ignores do not count: the keys of objects (E72: a DTO built as `{ ...input, id }` is printed as
 *   deep as a difference further down needs), the entries of Maps and Sets (a Set of tags or a Map of headers built in
 *   another order), and the own properties of errors and functions (E78). (Each line prints in its own order.)
 * So the expected arguments are printed with their matchers replaced by the received values at their places, both calls
 * with the keys and entries of their values in a fixed order (util.inspect's `sorted` option, and compactError's; Node.js
 * 10.0 to 10.11 do not know the option: there, keys and entries are in the order in which they print), and the texts
 * are compared. Getters are not run.
 */

/** The expected arguments with their matchers replaced by the received values at their places (see above). */
const withReceivedValues = (expected: readonly unknown[], actual: readonly unknown[]): unknown[] => {
  const ancestors = new Map<object, unknown>()
  const replaced = (value: unknown, received: { value: unknown } | undefined): unknown => {
    if (isArgumentMatcher(value)) return received === undefined ? value : received.value
    if (typeof value !== 'object' || value === null || types.isProxy(value) || received === undefined) return value
    // a plain object or an array, where the received call has a container of the same kind
    const other = received.value
    const prototype = Object.getPrototypeOf(value)
    if (!(Array.isArray(value) || prototype === Object.prototype || prototype === null) || typeof other !== 'object' || other === null ||
      types.isProxy(other) || Array.isArray(value) !== Array.isArray(other) || prototype !== Object.getPrototypeOf(other)) return value
    const ancestor = ancestors.get(value)
    if (ancestor !== undefined) return ancestor // a cycle
    const copy = Array.isArray(value) ? Object.setPrototypeOf([], prototype) : Object.create(prototype)
    ancestors.set(value, copy)
    try {
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if ('value' in descriptor) {
          const at = Object.getOwnPropertyDescriptor(other, key)
          descriptor.value = replaced(descriptor.value, at !== undefined && 'value' in at ? { value: at.value } : undefined)
        }
        Object.defineProperty(copy, key, descriptor)
      }
    } finally {
      ancestors.delete(value)
    }
    return copy
  }
  const all = expected.findIndex(isAllArguments)
  const count = all >= 0 ? all : expected.length
  const result: unknown[] = []
  for (let index = 0; index < count; index++) result.push(replaced(expected[index], index < actual.length ? { value: actual[index] } : undefined))
  if (all >= 0) result.push(...actual.slice(all))
  return result
}

/** The text of arguments as the comparison prints them (see above), `depth` levels deep. */
const comparisonText = (args: readonly unknown[], depth: number): string => {
  const bounds = messageBounds(depth)
  return formatArguments(args, false, bounds, value => formatValue(value, false, bounds, true))
}

/**
 * E59, E68: the least depth from `from` up to `to` at which the arguments of an expected call and of a received call
 * print differently in what matching sees (see above); Infinity when they print alike at all those depths, `from` when
 * a value cannot be read.
 */
export const leastDifference = (expected: readonly unknown[], actual: readonly unknown[], from: number, to: number): number => {
  try {
    const compared = withReceivedValues(expected, actual)
    for (let depth = from; depth <= to; depth++) if (comparisonText(compared, depth) !== comparisonText(actual, depth)) return depth
  } catch {
    return from
  }
  return Infinity
}

/**
 * One preparation of a value for printing (see prepared). `ancestors`: the containers being prepared, with what an entry
 * that refers back to one of them (a cycle) is given.
 */
type Walk = {
  readonly bounds: PrintBounds
  readonly ancestors: Map<object, unknown>
  /** E78: whether keys and entries are printed sorted, and errors with their properties sorted (see leastDifference). */
  readonly sorted: boolean
  /** E86: the containers in the samples of matchers of test runners that hold a matcher (see preparedSample). */
  holders?: Set<object>
}

/**
 * E44, E45, E54: what util.inspect is given to print a value within the bounds: the value itself, or, where it holds an
 * error (at any depth util.inspect shows, and one level below), an object with more keys than the bounds allow, or a
 * container that holds a matcher deeper than util.inspect looks, a copy in which errors are their compact stand-ins,
 * wide objects show their first keys and such containers show what they hold. Only the levels that util.inspect shows
 * are looked at. Getters are not run.
 */
const prepared = (value: unknown, level: number, walk: Walk): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const ancestor = walk.ancestors.get(value)
  if (ancestor !== undefined) return ancestor // a cycle
  // a revoked proxy, of which nothing can be read (util.inspect shows `<Revoked Proxy>`)
  if (isRevokedProxy(value)) return value
  // E75: a matcher of a test runner prints as the runner shows it (`Any<String>`, `StringContaining '@'`, `has("err")`)
  const foreign = foreignMatcherLabel(value)
  if (foreign !== undefined) {
    const text = foreign.text
    // E86 (R13FE-1): and with its sample (`ObjectContaining { input: ... }`), which is part of its text: at its level,
    // with at least its first level shown (when the matcher is deeper than util.inspect looks); deeper than
    // SAMPLE_LEVELS, by its text alone
    if (foreign.sample === undefined || level > SAMPLE_LEVELS) return printsAs(() => text)
    const sample = preparedSample(foreign.sample.value, level, walk)
    return printsAs((depth, options) => `${text} ${inspect(sample, { ...options, depth: Math.max(depth, 0) })}`)
  }
  if (isError(value)) return errorStandIn(errorText(value, walk.sorted))
  if (level > walk.bounds.depth) {
    // deeper than util.inspect looks (it shows `[Object]`): only errors are replaced, as their stand-in shows more, and
    // containers that hold a matcher are shown
    if (!holdsMatcher(value, walk) || types.isProxy(value)) return value
    const copy = Array.isArray(value) ? preparedArray(value, level, walk) : preparedKeyed(value, level, walk)
    return printsAs((_, options) => inspect(copy, { ...options, depth: 0 }))
  }
  if (Array.isArray(value)) return types.isProxy(value) ? value : preparedArray(value, level, walk)
  if ((types.isMap(value) || types.isSet(value)) && !types.isProxy(value) && typeof (value as any)[inspectCustom] !== 'function')
    return preparedCollection(value as Map<unknown, unknown> | Set<unknown>, types.isMap(value), level, walk)
  return printsByKeys(value) ? preparedKeyed(value, level, walk) : value
}

/** Whether a value is a revoked proxy (Array.isArray throws for one, and any other read). */
const isRevokedProxy = (value: object): boolean => {
  if (!types.isProxy(value)) return false
  try {
    Array.isArray(value)
    return false
  } catch {
    return true
  }
}

/** Whether an object is a container that holds a matcher: in the arguments of a setup or a check, or (E86) in a sample. */
const holdsMatcher = (value: object, walk: Walk): boolean => matcherHolders.has(value) || walk.holders?.has(value) === true

/**
 * E86: how many levels deep the samples of matchers of test runners are looked into: a matcher nested deeper prints by
 * its text alone, and the search for matchers in a sample stops there (so that deeply nested ones cannot overflow the
 * stack).
 */
const SAMPLE_LEVELS = 32

/**
 * E86 (R13FE-1): the sample of a matcher of a test runner (`expect.objectContaining({ input: expect.objectContaining({
 * items: expect.arrayContaining([3]) }) })`), prepared at the matcher's level (it prints as part of the matcher's
 * text). The matchers in it, at any depth, are shown by their own text, as those of the expected call are (see
 * matcherHolders): the containers in it that hold one are noted (Walk.holders), looking at the entries that print, at
 * most SAMPLE_LEVELS levels deep, and not into the samples of the matchers (they are noted when those print).
 * Deeper than util.inspect looks, the sample shows its first level, as a container that holds a matcher does.
 */
const preparedSample = (sample: unknown, level: number, walk: Walk): unknown => {
  if (typeof sample !== 'object' || sample === null || types.isProxy(sample)) return sample
  const holders = walk.holders ??= new Set()
  const visiting = new Set<object>()
  /** Whether a value is a matcher or a container that holds one (`depth` levels into the sample). */
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || types.isProxy(value)) return false
    if (holders.has(value) || isArgumentMatcher(value)) return true
    const isArray = Array.isArray(value)
    if (depth > SAMPLE_LEVELS || visiting.has(value) || !(isArray || printsByKeys(value))) return false
    visiting.add(value)
    let holds = false
    if (isArray) {
      const count = Math.min((value as unknown[]).length, walk.bounds.maxArrayLength)
      for (let index = 0; index < count; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index)
        if (descriptor !== undefined && 'value' in descriptor && visit(descriptor.value, depth + 1)) holds = true
      }
    } else {
      const keys = ownEnumerableKeys(value)
      const count = Math.min(keys.length, walk.bounds.keys)
      for (let index = 0; index < count; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, keys[index])
        if (descriptor !== undefined && 'value' in descriptor && visit(descriptor.value, depth + 1)) holds = true
      }
    }
    if (holds) holders.add(value)
    return holds
  }
  try {
    visit(sample, 0)
  } catch {
    // a value that cannot be read
  }
  if (level <= walk.bounds.depth) return prepared(sample, level, walk)
  if (walk.ancestors.has(sample)) return walk.ancestors.get(sample) // a cycle
  return Array.isArray(sample) ? preparedArray(sample, level, walk) : printsByKeys(sample) ? preparedKeyed(sample, level, walk) : prepared(sample, level, walk)
}

const isArrayIndex = (key: PropertyKey): boolean => typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295

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
        const item = prepared(descriptor.value, level + 1, walk)
        if (item !== descriptor.value) changed = true
        copy[index] = item
      } else Object.defineProperty(copy, index, { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true })
    }
    // E67: and its other keys, which util.inspect shows after the items (`total` of paginated rows, `index`, `input` and
    // `groups` of a RegExp match)
    const extra = ownEnumerableKeys(array).filter(key => !isArrayIndex(key))
    if (copyKeys(array, copy, extra, Infinity, level, walk)) changed = true
  } finally {
    walk.ancestors.delete(array)
  }
  return changed ? copy : array
}

/**
 * Copies the first `count` of the own enumerable keys `keys` of `object` to `copy`, data properties prepared, accessors
 * as they are. Whether the copy prints differently from the object: a value was prepared.
 */
const copyKeys = (object: object, copy: object, keys: readonly PropertyKey[], count: number, level: number, walk: Walk): boolean => {
  let changed = false
  const shown = Math.min(keys.length, count)
  for (let index = 0; index < shown; index++) {
    const key = keys[index]
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (descriptor === undefined) continue
    if ('value' in descriptor) {
      const item = prepared(descriptor.value, level + 1, walk)
      if (item !== descriptor.value) changed = true
      Object.defineProperty(copy, key, { value: item, writable: true, enumerable: true, configurable: true })
    } else Object.defineProperty(copy, key, { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true })
  }
  return changed
}

/** An object shown by its keys: its first `keys` own enumerable keys, data properties prepared, accessors as they are. */
const preparedKeyed = (object: object, level: number, walk: Walk): unknown => {
  const keys = ownEnumerableKeys(object)
  const count = Math.min(keys.length, walk.bounds.keys)
  const hidden = keys.length - count
  const copy = Object.create(Object.getPrototypeOf(object))
  const result = hidden > 0 ? withMore(copy, hidden, 'keys') : copy
  walk.ancestors.set(object, result)
  let changed = hidden > 0
  try {
    if (copyKeys(object, copy, keys, count, level, walk)) changed = true
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
  const sized = size > count ? withMore(copy, size - count, 'items', size) : undefined
  walk.ancestors.set(collection, sized ?? copy)
  let changed = false
  try {
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
    // E69: and its own keys, which util.inspect shows after the entries (in a copy that leaves entries out, before the
    // `... N more items` that the copy shows at its end)
    if (copyKeys(collection, copy, ownEnumerableKeys(collection), Infinity, level, walk)) changed = true
  } finally {
    walk.ancestors.delete(collection)
  }
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
 * anything else with a bounded util.inspect, cut after `bounds.characters` characters. `sorted`: E78, with keys and
 * entries in a fixed order and errors with their properties sorted (only to compare values, see leastDifference;
 * messages and printouts show them in their order).
 */
export const formatBounded = (value: unknown, bounds: PrintBounds, colors: boolean, sorted = false): string => {
  const options: InspectOptions = {
    depth: bounds.depth,
    maxArrayLength: bounds.maxArrayLength,
    maxStringLength: stringLimit(value, bounds),
    colors
  }
  if (bounds.breakLength !== undefined) options.breakLength = bounds.breakLength
  if (sorted) options.sorted = true
  let printable: unknown
  try {
    printable = prepared(value, 0, { bounds, ancestors: new Map(), sorted })
  } catch {
    printable = value // a value that cannot be looked at: util.inspect shows what it can, within the bounds above
  }
  const text = inspect(printable, options)
  if (text.length <= bounds.characters) return text
  // cut without the colours, so that no escape sequence is cut in two
  return truncateText(colors ? inspect(printable, { ...options, colors: false }) : text, bounds.characters)
}

export const formatValue = (value: unknown, colors: boolean, bounds: PrintBounds = MESSAGE_BOUNDS, sorted = false): string => {
  try {
    return withPrintGuard(() => formatBounded(value, bounds, colors, sorted))
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
