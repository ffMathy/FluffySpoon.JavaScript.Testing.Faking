import { inspect, InspectOptions, types } from 'util'
import { isAllArguments, isArgumentMatcher } from '../../shared'
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
        : 'value' in descriptor ? formatBounded(descriptor.value, ERROR_PROPERTY_BOUNDS, false)
          : descriptor.get !== undefined ? (descriptor.set !== undefined ? '[Getter/Setter]' : '[Getter]') : '[Setter]'
      parts.push(`${keyText(key)}: ${value}`)
    }
    // E78: in a fixed order (see sortedErrorText)
    if (sorted) parts.sort()
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

/**
 * E78: the compact form of an error with its own properties in a fixed order (sorted by their texts), so that two
 * errors whose compact forms differ only in the order of their properties give the same text.
 */
const sortedErrorText = (error: Error): string => {
  try {
    return compactError(error, true)
  } catch {
    return errorText(error)
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

/*
 * E59, E60: how deep an expected call and a received call that it does not match must be printed to print differently.
 * A failure message prints such lines deeper when they print alike (see SubstituteException.deeperLines). Printing every
 * such line at each depth to find out is what made messages slow (R10V-1), and a matcher in the expected call (it prints
 * by its label) made every line print differently, wherever else they differed (R10-ADV-1). So the values themselves
 * are compared, the way printing shows them, to find the least depth at which the lines can print differently, with
 * the matchers of the expected call left out (a matcher stands where the received value it was given stands):
 * - a value at level L (an argument is at level 0, a value inside it at 1, ...) shows once its container shows its
 *   entries, at depth L - 1 (an argument at any depth), and an object there shows as `[Object]`, `[Array]`, `[Foo]`
 *   (`{}`, `[]`, `Foo {}` when it is empty);
 * - the entries of a container at level L show from depth L on: the keys of an object (the first PrintBounds.keys of
 *   them, and how many there are); the length, the first maxArrayLength items and the other own enumerable keys of an
 *   array (E67: the `total` of paginated rows, the `index` and `input` of a RegExp match); the size, the first
 *   maxArrayLength entries (keys and values, in their order) and the own enumerable keys of a Map or a Set (E69);
 * - E72: keys in another order do not count as a difference (matching does not see it either): the values of the same
 *   keys are compared, so that a DTO built as `{ ...input, id }` is printed as deep as a difference further down needs;
 * - E78: nor does any other order that matching ignores: the entries of a Map or a Set that print in another order
 *   (a Set of tags or a Map of headers built in another order) are compared by key (the values of the same key of a
 *   Map, one level down) and, where the keys are not the same values (objects), as a multiset of their texts at each
 *   depth; the own properties of errors and functions are compared by key, too. (Each line prints in its own order.)
 *   Where the entries in their order already print alike, they are not compared again;
 * - two strings longer than util.inspect shows of them print alike if what shows is the same, and so do two symbols with
 *   the same description;
 * - a matcher stands for the received value only where matching takes it as a matcher, in plain objects and arrays
 *   (D27); inside a class instance, a Map or a Set it is a value like any other, shown by its label;
 * - any other value (a substitute, a function, an error, a Date, a typed array, a proxy, an object that prints itself,
 *   two containers of different kinds or prototypes, an array too long to list its keys cheaply) is compared by its
 *   printed text (textOf, which the caller keeps per value and depth), at the depths at which it shows in turn, from
 *   the one at which it starts to show (where a function with properties shows as `[Function]` and a typed array as
 *   `[Uint8Array]`) to the one at which the texts differ (E69).
 * Only the entries that printing shows are looked at, no deeper than a message prints, and at most
 * DifferenceSearch.entries of them for all the lines of a message. The comparison of a line stops as soon as it knows
 * what its caller asks (see firstVisibleDifference). Getters are not run.
 */

/**
 * E60: how many entries firstVisibleDifference looks at for one failure message, at most (for all its lines: about as
 * many as a few of them show four levels deep). The lines of a message are mostly alike in shape, so the first ones
 * decide how deep the message prints them all; the lines after the budget is spent are printed as deep as those.
 */
export const DIFFERENCE_ENTRIES = 2000

export type DifferenceSearch = {
  /** The bounds the values are printed with (their depth aside). */
  readonly bounds: PrintBounds
  /** How deep the lines can be printed at most: a difference that shows only deeper does not count. */
  readonly maxDepth: number
  /** The text of a value printed `depth` levels deep (-1: as it shows one level deeper than the lines are printed). */
  readonly textOf: (value: unknown, depth: number) => string
  /** The own enumerable keys of the objects looked at (for all the lines of one message). */
  readonly keys: Map<object, PropertyKey[]>
  /** How many more entries may be looked at (see DIFFERENCE_ENTRIES). */
  entries: number
  /**
   * Set by firstVisibleDifference: whether it looked at every entry it had to (false when the budget ran out during the
   * comparison, or a value could not be read; it then gives what it found up to there).
   */
  complete?: boolean
}

/**
 * `best`: the least depth found so far at which the lines print differently. The comparison wants to know whether they
 * print differently at `base` or less; if not, whether they do at `floor` or less; if not, the least depth at which they
 * do. So it is decided once `best` is `base` or less, and while `best` is `floor` or less, only a difference at `base` or
 * less tells it something new (see wanted). `stopped`: not every entry that shows was looked at (the budget is spent,
 * or a value cannot be read).
 */
type Comparison = { best: number, stopped: boolean, readonly floor: number, readonly base: number }

const isObjectLike = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function'

/** A difference that shows from `depth` on. */
const differs = (comparison: Comparison, depth: number): void => {
  if (depth < comparison.best) comparison.best = depth
}

/** Whether the comparison knows what it wants: the lines print differently at `base` or less. */
const decided = (comparison: Comparison): boolean => comparison.best <= comparison.base

/** The greatest depth at which a difference still tells the comparison something new. */
const wanted = (comparison: Comparison): number => comparison.best > comparison.floor ? comparison.best - 1 : comparison.base

/** Whether two different primitives print alike at `level` (see above). */
const primitivesPrintAlike = (expected: unknown, actual: unknown, level: number, bounds: PrintBounds): boolean => {
  if (typeof expected === 'string' && typeof actual === 'string') {
    const shown = level === 0 ? stringLimit(expected, bounds) : bounds.maxStringLength
    return expected.length === actual.length && expected.length > shown && expected.slice(0, shown) === actual.slice(0, shown)
  }
  return typeof expected === 'symbol' && typeof actual === 'symbol' && expected.toString() === actual.toString()
}

const keysOf = (search: DifferenceSearch, object: object): PropertyKey[] => {
  let keys = search.keys.get(object)
  if (keys === undefined) search.keys.set(object, keys = ownEnumerableKeys(object))
  return keys
}

/** Whether an object has no own enumerable keys (without listing them, unless they are listed already). */
const hasNoKeys = (search: DifferenceSearch, object: object): boolean => {
  const keys = search.keys.get(object)
  if (keys !== undefined) return keys.length === 0
  for (const key in object) if (hasOwnProperty.call(object, key)) return false
  const symbols = Object.getOwnPropertySymbols(object)
  for (let index = 0; index < symbols.length; index++) if (propertyIsEnumerable.call(object, symbols[index])) return false
  return true
}

/** E67: up to how long an array has its keys listed to find its keys other than the indices (a listing lists each index). */
const ARRAY_KEYS_LIMIT = 1000

const isArrayIndex = (key: string): boolean => /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295

/**
 * E67: the own enumerable keys of an array other than its indices, which util.inspect shows after the items (`total` of
 * paginated rows, `index`, `input` and `groups` of a RegExp match), in their order (a listing gives the indices first);
 * undefined for an array longer than `limit`.
 */
const arrayExtraKeys = (array: readonly unknown[], limit: number): PropertyKey[] | undefined => {
  if (array.length > limit) return undefined
  const keys = Object.keys(array)
  let start = keys.length
  while (start > 0 && !isArrayIndex(keys[start - 1])) start--
  const extra: PropertyKey[] = start === keys.length ? [] : keys.slice(start)
  const symbols = Object.getOwnPropertySymbols(array)
  for (let index = 0; index < symbols.length; index++) if (propertyIsEnumerable.call(array, symbols[index])) extra.push(symbols[index])
  return extra
}

/** How the comparison looks at a value (see above). */
type Shape = 'array' | 'collection' | 'keyed' | 'text'

/** The shape of an object (not a function or a proxy) whose prototype is `prototype`. */
const shapeOf = (value: object, prototype: object | null): Shape => {
  if (typeof (value as any)[inspectCustom] === 'function') return 'text'
  if (Array.isArray(value)) return 'array'
  if (prototype === Object.prototype || prototype === null) return 'keyed'
  if (isError(value)) return 'text'
  if (types.isMap(value) || types.isSet(value)) return 'collection'
  return printsByKeys(value) ? 'keyed' : 'text'
}

/** Two own properties at `level` (data properties compare their values; accessors show as `[Getter]`, ...). */
const compareProperties = (
  search: DifferenceSearch, comparison: Comparison, expected: PropertyDescriptor, actual: PropertyDescriptor, level: number, literal: boolean
): void => {
  const expectedData = 'value' in expected
  if (expectedData && !literal && isArgumentMatcher(expected.value)) return
  if (expectedData && 'value' in actual) return compareValues(search, comparison, expected.value, actual.value, level, literal)
  if (expectedData || 'value' in actual || (expected.get === undefined) !== (actual.get === undefined) || (expected.set === undefined) !== (actual.set === undefined))
    differs(comparison, level - 1)
}

/**
 * Two values at `level`. `literal`: they are inside a class instance, a Map or a Set, where a matcher of the expected
 * call is a value like any other (D27).
 */
const compareValues = (search: DifferenceSearch, comparison: Comparison, expected: unknown, actual: unknown, level: number, literal: boolean): void => {
  const shows = level > 0 ? level - 1 : 0
  if (comparison.stopped || decided(comparison) || shows > wanted(comparison) || shows > search.maxDepth) return
  // a matcher prints by its label wherever the received value stands
  if ((!literal && isArgumentMatcher(expected)) || Object.is(expected, actual)) return
  if (!isObjectLike(expected) || !isObjectLike(actual)) {
    if (!isObjectLike(expected) && !isObjectLike(actual) && primitivesPrintAlike(expected, actual, level, search.bounds)) return
    return differs(comparison, shows)
  }
  if (--search.entries < 0) {
    comparison.stopped = true
    return
  }
  if (typeof expected === 'function' || typeof actual === 'function' || types.isProxy(expected) || types.isProxy(actual)) {
    // E78: two functions (not substitutes or other proxies) whose properties print in another order
    if (typeof expected === 'function' && typeof actual === 'function' && !types.isProxy(expected) && !types.isProxy(actual))
      return inAnyOrder(comparison,
        inOrder => compareTexts(search, inOrder, expected, actual, level),
        anyOrder => compareFunctions(search, anyOrder, expected, actual, level))
    return compareTexts(search, comparison, expected, actual, level)
  }
  const prototype = Object.getPrototypeOf(expected)
  const shape = prototype === Object.getPrototypeOf(actual) ? shapeOf(expected, prototype) : 'text'
  if (shape === 'text' || shape !== shapeOf(actual, prototype)) {
    // E78: two errors whose properties print in another order (an error prints alike at any depth at which it shows)
    if (isError(expected) && isError(actual))
      return inAnyOrder(comparison,
        inOrder => compareTexts(search, inOrder, expected, actual, level),
        anyOrder => {
          if (sortedErrorText(expected) !== sortedErrorText(actual)) differs(anyOrder, shows)
        })
    return compareTexts(search, comparison, expected, actual, level)
  }
  if (shape === 'array') return compareArrays(search, comparison, expected as unknown[], actual as unknown[], level, literal)
  if (shape === 'collection')
    return compareCollections(search, comparison, expected as Map<unknown, unknown> | Set<unknown>, actual as Map<unknown, unknown> | Set<unknown>, level)
  // deeper than the lines are printed, both show as `[Object]` or `[Foo]` (`{}` or `Foo {}` when empty); the expected
  // call shows a container that holds a matcher in full, though (see matcherHolders)
  if (level > search.maxDepth) {
    if (hasNoKeys(search, expected) !== hasNoKeys(search, actual) || (!literal && matcherHolders.has(expected))) differs(comparison, shows)
    return
  }
  const expectedKeys = keysOf(search, expected)
  const actualKeys = keysOf(search, actual)
  // an empty object shows as `{}` or `Foo {}` at any depth
  if ((expectedKeys.length === 0) !== (actualKeys.length === 0)) return differs(comparison, shows)
  const instance = prototype !== Object.prototype && prototype !== null
  compareKeys(search, comparison, expected, actual, expectedKeys, actualKeys, search.bounds.keys, level, literal || instance)
}

/**
 * E68, E69: two values compared by their printed texts, at the depths at which they show, in turn, from the one at which
 * they start to show, as long as a difference tells the comparison something new (see wanted). A difference anywhere up
 * to `base` tells as much as one at `base`, and one up to `floor` (when there is none up to `base`) as much as one at
 * `floor`: those depths are tried before deeper ones, so that the lines of a message are printed at the least depth that
 * tells them apart. (Two values that print alike at a depth print alike at the depths before it.)
 */
const compareTexts = (search: DifferenceSearch, comparison: Comparison, expected: object, actual: object, level: number): void =>
  compareAtDepths(search, comparison, level > 0 ? level - 1 : 0, depth => search.textOf(expected, depth - level) !== search.textOf(actual, depth - level))

/**
 * The depths from `from` on, tried as compareTexts tries them (see above), until `differ` says that the values print
 * differently at the depth tried: a difference there.
 */
const compareAtDepths = (search: DifferenceSearch, comparison: Comparison, from: number, differ: (depth: number) => boolean): void => {
  let depth = from
  for (;;) {
    const limit = Math.min(wanted(comparison), search.maxDepth)
    if (depth > limit) return
    const tried = depth <= comparison.base ? Math.min(comparison.base, limit) : depth <= comparison.floor ? Math.min(comparison.floor, limit) : depth
    if (differ(tried)) return differs(comparison, tried)
    depth = tried + 1
  }
}

/**
 * E78: two values compared in their order (`inOrder`, as they print) and, where that finds a difference, in any order
 * that matching ignores (`anyOrder`). Each of the two finds a depth at which the values print differently, at most the
 * least depth at which they print differently in more than such an order; the greater of the two counts. (A comparison
 * in any order that the budget cuts short does not count: the one in their order does then.)
 */
const inAnyOrder = (comparison: Comparison, inOrder: (comparison: Comparison) => void, anyOrder: (comparison: Comparison) => void): void => {
  const first: Comparison = { ...comparison }
  inOrder(first)
  if (first.best < comparison.best && !first.stopped) {
    const second: Comparison = { ...comparison }
    anyOrder(second)
    if (!second.stopped) {
      comparison.best = Math.max(first.best, second.best)
      return
    }
  }
  comparison.best = first.best
  comparison.stopped = first.stopped
}

const functionToString = Function.prototype.toString

/**
 * E78: two functions (not proxies) by their own properties, compared by key as the keys of an object, if they print
 * alike apart from them (`[Function: name]`, `[class Name]`: the same prototype, name and source); otherwise they
 * differ where they show.
 */
const compareFunctions = (search: DifferenceSearch, comparison: Comparison, expected: Function, actual: Function, level: number): void => {
  const shows = level > 0 ? level - 1 : 0
  const expectedName = Object.getOwnPropertyDescriptor(expected, 'name')
  const actualName = Object.getOwnPropertyDescriptor(actual, 'name')
  // (a name that is not a data property is not read: getters are not run)
  if (Object.getPrototypeOf(expected) !== Object.getPrototypeOf(actual) || expectedName === undefined || actualName === undefined ||
    !('value' in expectedName) || !('value' in actualName) || !Object.is(expectedName.value, actualName.value) ||
    functionToString.call(expected) !== functionToString.call(actual)) return differs(comparison, shows)
  // a function with properties shows as `[Function]` where they do not show
  if (hasNoKeys(search, expected) !== hasNoKeys(search, actual)) return differs(comparison, shows)
  if (level > search.maxDepth) return
  compareKeys(search, comparison, expected, actual, keysOf(search, expected), keysOf(search, actual), Infinity, level, true)
}

/** E72: whether the first `count` keys of two lists are the same keys, in any order. */
const sameKeys = (expected: readonly PropertyKey[], actual: readonly PropertyKey[], count: number): boolean => {
  let index = 0
  while (index < count && expected[index] === actual[index]) index++
  if (index === count) return true
  const shown = new Set<PropertyKey>()
  for (let other = index; other < count; other++) shown.add(actual[other])
  for (let other = index; other < count; other++) if (!shown.has(expected[other])) return false
  return true
}

/** The own enumerable keys of two containers at `level` that show (the first `cap` of them, see sameKeys), and their values. */
const compareKeys = (
  search: DifferenceSearch, comparison: Comparison, expected: object, actual: object,
  expectedKeys: readonly PropertyKey[], actualKeys: readonly PropertyKey[], cap: number, level: number, literal: boolean
): void => {
  if (expectedKeys.length !== actualKeys.length) return differs(comparison, level)
  const count = Math.min(expectedKeys.length, cap)
  if (!sameKeys(expectedKeys, actualKeys, count)) return differs(comparison, level)
  search.entries -= count
  for (let index = 0; index < count && !decided(comparison) && !comparison.stopped; index++) {
    const key = expectedKeys[index]
    compareProperties(search, comparison, Object.getOwnPropertyDescriptor(expected, key)!, Object.getOwnPropertyDescriptor(actual, key)!, level + 1, literal)
  }
}

/** Two arrays at `level` with the same prototype: their length, first items and (E67) other keys. */
const compareArrays = (search: DifferenceSearch, comparison: Comparison, expected: unknown[], actual: unknown[], level: number, literal: boolean): void => {
  const length = expected.length
  // an empty array shows as `[]` at any depth (one with other keys does not), others as `[Array]` where it is deeper
  // than the lines are printed
  const isEmpty = (array: unknown[]) => array.length === 0 && arrayExtraKeys(array, 0)!.length === 0
  if (level > search.maxDepth) {
    if ((length === 0 || actual.length === 0) && isEmpty(expected) !== isEmpty(actual)) differs(comparison, level - 1)
    else if (!literal && matcherHolders.has(expected)) differs(comparison, level - 1)
    return
  }
  const expectedExtra = arrayExtraKeys(expected, ARRAY_KEYS_LIMIT)
  const actualExtra = arrayExtraKeys(actual, ARRAY_KEYS_LIMIT)
  if (expectedExtra === undefined || actualExtra === undefined) return compareTexts(search, comparison, expected, actual, level)
  if ((length === 0 && expectedExtra.length === 0) !== (actual.length === 0 && actualExtra.length === 0))
    return differs(comparison, level > 0 ? level - 1 : 0)
  if (length !== actual.length) return differs(comparison, level)
  const count = Math.min(length, search.bounds.maxArrayLength)
  search.entries -= count
  for (let index = 0; index < count && !decided(comparison) && !comparison.stopped; index++) {
    const expectedItem = Object.getOwnPropertyDescriptor(expected, index)
    const actualItem = Object.getOwnPropertyDescriptor(actual, index)
    if (expectedItem === undefined || actualItem === undefined) {
      if (expectedItem !== actualItem) differs(comparison, level) // a hole
    } else compareProperties(search, comparison, expectedItem, actualItem, level + 1, literal)
  }
  // (util.inspect shows all of them)
  compareKeys(search, comparison, expected, actual, expectedExtra, actualExtra, Infinity, level, literal)
}

/** E69: two Maps or two Sets at `level` with the same prototype: their size, first entries (E78: in any order) and own keys. */
const compareCollections = (
  search: DifferenceSearch, comparison: Comparison, expected: Map<unknown, unknown> | Set<unknown>, actual: Map<unknown, unknown> | Set<unknown>, level: number
): void => {
  const isMap = types.isMap(expected)
  const size: number = (isMap ? mapSize : setSize).call(expected)
  const actualSize: number = (isMap ? mapSize : setSize).call(actual)
  // an empty one shows as `Map(0) {}` at any depth, others as `[Map]` where it is deeper than the lines are printed
  if ((size === 0 && hasNoKeys(search, expected)) !== (actualSize === 0 && hasNoKeys(search, actual)))
    return differs(comparison, level > 0 ? level - 1 : 0)
  if (level > search.maxDepth) return
  const expectedKeys = keysOf(search, expected)
  const actualKeys = keysOf(search, actual)
  if (size !== actualSize) return differs(comparison, level)
  const count = Math.min(size, search.bounds.maxArrayLength)
  search.entries -= count
  const expectedEntries = firstEntries(expected, isMap, count)
  const actualEntries = firstEntries(actual, isMap, count)
  inAnyOrder(comparison,
    inOrder => compareEntries(search, inOrder, expectedEntries, actualEntries, isMap, level),
    anyOrder => compareEntriesInAnyOrder(search, anyOrder, expectedEntries, actualEntries, isMap, level))
  compareKeys(search, comparison, expected, actual, expectedKeys, actualKeys, Infinity, level, true)
}

/** Entries of two Maps (`[key, value]`) or two Sets (members) at `level`, in their order. */
const compareEntries = (
  search: DifferenceSearch, comparison: Comparison, expected: readonly unknown[], actual: readonly unknown[], isMap: boolean, level: number
): void => {
  for (let index = 0; index < expected.length && index < actual.length && !decided(comparison) && !comparison.stopped; index++) {
    if (isMap) {
      const [expectedKey, expectedValue] = expected[index] as [unknown, unknown]
      const [actualKey, actualValue] = actual[index] as [unknown, unknown]
      compareValues(search, comparison, expectedKey, actualKey, level + 1, true)
      compareValues(search, comparison, expectedValue, actualValue, level + 1, true)
    } else compareValues(search, comparison, expected[index], actual[index], level + 1, true)
  }
}

/** The first `count` entries of a Map (`[key, value]`) or a Set (its members), in their order. */
const firstEntries = (collection: Map<unknown, unknown> | Set<unknown>, isMap: boolean, count: number): unknown[] => {
  const iterator: Iterator<unknown> = (isMap ? mapEntries : setValues).call(collection)
  const entries: unknown[] = []
  for (let index = 0; index < count; index++) {
    const step = iterator.next()
    if (step.done === true) break
    entries.push(step.value)
  }
  return entries
}

/**
 * E78: the first entries of two Maps or two Sets at `level` in any order (see inAnyOrder): the entries of the same key
 * of a Map compare their values; the members of a Set that are the same value print alike. The other entries (keys or
 * members that are not the same value: objects, or values that print alike) are compared in their order and, where
 * that finds a difference between more than one of them, as a multiset of their texts, at the depths at which they
 * show (so that only those are printed).
 */
const compareEntriesInAnyOrder = (
  search: DifferenceSearch, comparison: Comparison, expected: readonly unknown[], actual: readonly unknown[], isMap: boolean, level: number
): void => {
  const keyOf = (entry: unknown): unknown => isMap ? (entry as [unknown, unknown])[0] : entry
  // (as a Map or a Set finds them: -0 and 0 are one key there, but print differently)
  const positions = new Map<unknown, number>()
  for (let index = 0; index < actual.length; index++) positions.set(keyOf(actual[index]), index)
  const paired = new Set<number>()
  const unpaired: unknown[] = []
  for (let index = 0; index < expected.length && !decided(comparison) && !comparison.stopped; index++) {
    const key = keyOf(expected[index])
    const position = positions.get(key)
    if (position === undefined || !Object.is(key, keyOf(actual[position]))) {
      unpaired.push(expected[index])
      continue
    }
    paired.add(position)
    if (isMap) compareValues(search, comparison, (expected[index] as [unknown, unknown])[1], (actual[position] as [unknown, unknown])[1], level + 1, true)
  }
  if (unpaired.length === 0 || decided(comparison) || comparison.stopped) return
  const others = actual.filter((_, index) => !paired.has(index))
  // (one of each can only be paired so)
  if (unpaired.length === 1) return compareEntries(search, comparison, unpaired, others, isMap, level)
  const textsAt = (entries: readonly unknown[], depth: number): string[] => entries.map(entry => isMap
    ? `${entryText(search, (entry as [unknown, unknown])[0], depth)} => ${entryText(search, (entry as [unknown, unknown])[1], depth)}`
    : entryText(search, entry, depth)).sort()
  inAnyOrder(comparison,
    inOrder => compareEntries(search, inOrder, unpaired, others, isMap, level),
    // the entries show from depth `level` on (their values one level deeper)
    anyOrder => compareAtDepths(search, anyOrder, level, depth => {
      const expectedTexts = textsAt(unpaired, depth - level - 1)
      const actualTexts = textsAt(others, depth - level - 1)
      return expectedTexts.length !== actualTexts.length || expectedTexts.some((text, index) => text !== actualTexts[index])
    }))
}

/**
 * E78: the text of a key, value or member of a Map or a Set at level L, printed `depth` levels deeper than L, for
 * compareEntriesInAnyOrder: two of them print alike exactly when their texts are the same (two primitives as
 * primitivesPrintAlike decides it at a level inside a container).
 */
const entryText = (search: DifferenceSearch, value: unknown, depth: number): string => {
  if (isObjectLike(value)) return `o${search.textOf(value, depth)}`
  if (typeof value === 'string') {
    const shown = search.bounds.maxStringLength
    return value.length > shown ? `S${value.length}:${value.slice(0, shown)}` : `s${value}`
  }
  if (typeof value === 'symbol') return `y${value.toString()}`
  if (typeof value === 'number') return Object.is(value, -0) ? 'n-0' : `n${value}`
  return `${typeof value}:${String(value)}`
}

/**
 * E59, E60: the least depth at which the arguments of an expected call and of a received call print differently, with
 * the matchers of the expected call left out (see above), as far as they are looked at; Infinity when they print alike
 * up to maxDepth. The comparison stops once it knows what its caller asks: a depth of `base` or less, if they print
 * differently there; otherwise a depth up to `floor`, if they do there (`base` is `floor` unless given); otherwise the
 * least depth. It also stops when the budget is spent (search.complete is then false), with what it found so far.
 */
export const firstVisibleDifference = (
  search: DifferenceSearch, expected: readonly unknown[], actual: readonly unknown[], floor: number, base: number = floor
): number => {
  search.complete = true
  let count = expected.length
  const all = expected.findIndex(isAllArguments)
  // Arg.all() takes the place of the rest of the received arguments
  if (all >= 0) count = all
  else if (expected.length !== actual.length) return 0
  count = Math.min(count, MAX_PRINTED_ARGUMENTS)
  const comparison: Comparison = { best: Infinity, stopped: false, floor, base: Math.min(base, floor) }
  for (let index = 0; index < count && !decided(comparison) && !comparison.stopped; index++) {
    try {
      compareValues(search, comparison, expected[index], actual[index], 0, false)
    } catch {
      comparison.stopped = true // a value that cannot be read
    }
  }
  if (comparison.stopped) search.complete = false
  return comparison.best
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
 * - `keys`: E73, the own enumerable keys of the objects listed so far, when the caller keeps them (a failure message
 *   prints its values at several depths and compares them, see DifferenceSearch.keys): an object with 5,000 keys is
 *   listed once per message.
 */
type Walk = {
  readonly bounds: PrintBounds
  readonly ancestors: Map<object, unknown>
  budget: number
  exhausted: boolean
  readonly keys?: Map<object, PropertyKey[]>
}

/** The own enumerable keys of an object (see Walk.keys). */
const listedKeys = (walk: Walk, object: object): PropertyKey[] => {
  if (walk.keys === undefined) return ownEnumerableKeys(object)
  let keys = walk.keys.get(object)
  if (keys === undefined) walk.keys.set(object, keys = ownEnumerableKeys(object))
  return keys
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

/**
 * E74 (R12-ADV-1): an array of `length` holes, for a copy of an array. A long one is made the way V8 makes a sparse
 * array (by its last index), so that it takes no room for its holes: `new Array(length)` fills a million slots, which
 * takes milliseconds for every print of an array of a million items. util.inspect shows both alike.
 */
const holes = (length: number): unknown[] => {
  if (length <= ARRAY_KEYS_LIMIT) return new Array(length)
  const array: unknown[] = []
  array[length - 1] = undefined
  delete array[length - 1]
  return array
}

/** An array: its first maxArrayLength items (util.inspect shows how many more there are, as the copy has the same length). */
const preparedArray = (array: unknown[], level: number, walk: Walk): unknown => {
  const length = array.length
  const count = Math.min(length, walk.bounds.maxArrayLength)
  const copy: unknown[] = holes(length)
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
    // E67: and its other keys, which util.inspect shows after the items (`total` of paginated rows). E74 (R12-ADV-1):
    // they are listed only for an array of at most ARRAY_KEYS_LIMIT items, as listing them lists every index, also when
    // the array is copied (an array of a million errors would otherwise cost a listing of a million keys at each print);
    // a longer copy shows its first items and how many more there are, without its other keys
    if (!walk.exhausted) {
      const extra = arrayExtraKeys(array, ARRAY_KEYS_LIMIT)
      if (extra !== undefined && extra.length > 0 && copyKeys(array, copy, extra, Infinity, level, walk)) changed = true
    }
  } finally {
    walk.ancestors.delete(array)
  }
  return changed ? copy : array
}

/**
 * Copies the first `count` of the own enumerable keys `keys` of `object` to `copy`, data properties prepared, accessors
 * as they are, as far as the budget goes. Whether the copy prints differently from the object: a value was prepared,
 * or the budget ran out.
 */
const copyKeys = (object: object, copy: object, keys: readonly PropertyKey[], count: number, level: number, walk: Walk): boolean => {
  let changed = false
  const shown = Math.min(keys.length, count)
  for (let index = 0; index < shown; index++) {
    const key = keys[index]
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (descriptor === undefined) continue
    const isData = 'value' in descriptor
    if (!spend(walk, SEPARATOR + keyLength(key) + 2 + (isData ? leastLength(descriptor.value, level + 1, walk) : 8))) return true
    if (isData) {
      const item = prepared(descriptor.value, level + 1, walk)
      if (item !== descriptor.value) changed = true
      Object.defineProperty(copy, key, { value: item, writable: true, enumerable: true, configurable: true })
    } else Object.defineProperty(copy, key, { get: descriptor.get, set: descriptor.set, enumerable: true, configurable: true })
  }
  return changed
}

/** An object shown by its keys: its first `keys` own enumerable keys, data properties prepared, accessors as they are. */
const preparedKeyed = (object: object, level: number, walk: Walk): unknown => {
  const keys = listedKeys(walk, object)
  const count = Math.min(keys.length, walk.bounds.keys)
  const more: More = { hidden: keys.length - count, unit: 'keys' }
  const copy = Object.create(Object.getPrototypeOf(object))
  const result = more.hidden > 0 ? withMore(copy, more) : copy
  walk.ancestors.set(object, result)
  let changed = more.hidden > 0
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
    // E69: and its own keys, which util.inspect shows after the entries (in a copy that leaves entries out, before the
    // `... N more items` that the copy shows at its end)
    if (!truncated) {
      const keys = listedKeys(walk, collection)
      if (keys.length > 0 && copyKeys(collection, copy, keys, Infinity, level, walk)) {
        if (walk.exhausted) truncated = true
        else changed = true
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
 * anything else with a bounded util.inspect, cut after `bounds.characters` characters. `keys`: see Walk.keys.
 */
export const formatBounded = (value: unknown, bounds: PrintBounds, colors: boolean, keys?: Map<object, PropertyKey[]>): string => {
  const options: InspectOptions = {
    depth: bounds.depth,
    maxArrayLength: bounds.maxArrayLength,
    maxStringLength: stringLimit(value, bounds),
    colors
  }
  if (bounds.breakLength !== undefined) options.breakLength = bounds.breakLength
  const walk: Walk = { bounds, ancestors: new Map(), budget: printSettings.budget ? bounds.characters + BUDGET_MARGIN : Infinity, exhausted: false, keys }
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

export const formatValue = (value: unknown, colors: boolean, bounds: PrintBounds = MESSAGE_BOUNDS, keys?: Map<object, PropertyKey[]>): string => {
  try {
    return withPrintGuard(() => formatBounded(value, bounds, colors, keys))
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
