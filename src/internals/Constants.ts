import { inspect, promisify } from 'util'
import { constants as sharedConstants, substituteMarker } from '../shared'

const CONTEXT = sharedConstants.CONTEXT

/** Member key used for invoking a substitute (or an auto-substitute) itself: `fn(1, 2)`. */
export const SELF: unique symbol = Symbol('@fluffy-spoon/substitute:self')
/** Per-copy key that gives the engine access to the internals behind a proxy. Never recorded. */
export const INTERNAL: unique symbol = Symbol('@fluffy-spoon/substitute:internal')

export type SubstitutionMethod = 'returns' | 'throws' | 'resolves' | 'rejects' | 'mimicks'
export type ContextMethod = 'received' | 'didNotReceive' | 'clearReceivedCalls' | 'mimick' | 'configure'
export type StringAssertionKey = 'received' | 'didNotReceive'
export type FunctionHelperKey = 'call' | 'apply' | 'bind'

const substitutionMethods = new Map<PropertyKey, SubstitutionMethod>([
  ['returns', 'returns'], [CONTEXT.returns.symbol, 'returns'],
  ['throws', 'throws'], [CONTEXT.throws.symbol, 'throws'],
  ['resolves', 'resolves'], [CONTEXT.resolves.symbol, 'resolves'],
  ['rejects', 'rejects'], [CONTEXT.rejects.symbol, 'rejects'],
  ['mimicks', 'mimicks'], [CONTEXT.mimicks.symbol, 'mimicks']
])

// The context methods are only reachable through their (registered) symbols. Their string names are ordinary members.
const contextMethods = new Map<PropertyKey, ContextMethod>([
  [CONTEXT.received.symbol, 'received'],
  [CONTEXT.didNotReceive.symbol, 'didNotReceive'],
  [CONTEXT.clearReceivedCalls.symbol, 'clearReceivedCalls'],
  [CONTEXT.mimick.symbol, 'mimick'],
  [CONTEXT.configure.symbol, 'configure']
])

/** `returns`, `throws`, ... (string or symbol) when the key names a substitution method. */
export const substitutionMethodOf = (property: PropertyKey): SubstitutionMethod | undefined => substitutionMethods.get(property)
/** `received`, `didNotReceive`, ... when the key is one of the exported context symbols. */
export const contextMethodOf = (property: PropertyKey): ContextMethod | undefined => contextMethods.get(property)

export const isStringAssertionKey = (property: PropertyKey): property is StringAssertionKey =>
  property === 'received' || property === 'didNotReceive'

export const isFunctionHelperKey = (property: PropertyKey): property is FunctionHelperKey =>
  property === 'call' || property === 'apply' || property === 'bind'

export type SpecialProperty = 'then' | 'toJSON' | typeof inspect.custom | typeof Symbol.toPrimitive | typeof INTERNAL | typeof substituteMarker

/**
 * Properties that are never recorded and never configurable: `then` (substitutes are not thenables),
 * printing hooks, and the library's own markers.
 */
export const isSpecialProperty = (property: PropertyKey): property is SpecialProperty =>
  property === 'then' ||
  property === 'toJSON' ||
  property === inspect.custom ||
  property === Symbol.toPrimitive ||
  property === INTERNAL ||
  property === substituteMarker

/**
 * D28: keys that built-in algorithms, Node and test runners read to probe what kind of value they are looking at
 * (is it iterable, a RegExp, a promisify-able function, a jest asymmetric matcher, an ES module namespace, ...). An
 * unconfigured read of one of them answers undefined and is not recorded, the same way `then` is handled, so that a
 * substitute behaves like a plain function or object to those algorithms. Configuring the key (through sub[configure]()) or mimicking
 * an instance that has it makes the read answer as usual.
 */
const wellKnownSymbols = Symbol as unknown as Record<string, symbol | undefined>
const protocolKeys = new Set<PropertyKey>([
  // every well-known symbol except Symbol.toPrimitive, which is a special property (see isSpecialProperty);
  // asyncIterator and matchAll are looked up by name because older runtimes do not have them
  ...['iterator', 'asyncIterator', 'hasInstance', 'isConcatSpreadable', 'match', 'matchAll', 'replace', 'search',
    'split', 'species', 'toStringTag', 'unscopables'].map(name => wellKnownSymbols[name]),
  // E7: the registered form, and the running runtime's own key, which is another symbol on Node.js 10.0 to 12.16.1
  // and 13.0 to 13.11 (util.promisify reads that one there)
  Symbol.for('nodejs.util.promisify.custom'),
  (promisify as { custom?: symbol }).custom,
  'asymmetricMatch',
  // E33: the probe of the jest and vitest mock serializers (snapshots, pretty-format). Answered truthy, a substitute was
  // printed as a jest mock function from its `getMockName()` and `mock.calls`, which vitest followed without end.
  '_isMockFunction',
  // E38: DOM event targets call `listener.handleEvent(event)` when it is there (happy-dom checks it first), so a function
  // substitute added as an event listener records the event as a call of itself in happy-dom, jsdom and Node.js
  'handleEvent',
  // E46: the brand that tells the library's matchers apart (shared/Arguments), which a substitute never is, so that a
  // copy of the library that looks for it on a substitute records nothing
  Symbol.for('@fluffy-spoon/substitute:argument')
  // E34: '__esModule' is NOT a protocol key (E27 is reverted). Code compiled from ES modules reads it to decide how to
  // import a CommonJS module, and a substitute that stands in for a whole module (a jest.mock factory) must answer it
  // truthy, so that namespace imports (`import * as m`), named imports and Babel's mixed imports
  // (`import m, { named }`) reach its members. Its default import is then the auto-substitute `sub.default`; a factory
  // that returns `{ __esModule: true, default: sub }` makes it the substitute itself.
].filter(key => key !== undefined) as PropertyKey[])

export const isProtocolKey = (property: PropertyKey): boolean => protocolKeys.has(property)

const LIBRARY_SYMBOL_PREFIX = '@fluffy-spoon/substitute:'
const registeredInspectCustom = Symbol.for('nodejs.util.inspect.custom')

/**
 * E46: the library's own symbols: the registered ones of every copy of the package (the exported symbols, the
 * substitute marker, the matcher brand, ...) and INTERNAL.
 */
export const isLibrarySymbol = (property: symbol): boolean => {
  if (property === INTERNAL) return true
  const key = Symbol.keyFor(property)
  return key !== undefined && key.startsWith(LIBRARY_SYMBOL_PREFIX)
}

/**
 * E46: the members that a substitute answers in its own way only for itself, not for an object that inherits from it (an
 * instance of `class Plugin extends sdk.Base`, `Object.create(sub)`): the library's own symbols and the printing and
 * conversion members (then, toJSON, Symbol.toPrimitive, util.inspect.custom, toString, valueOf). See the get trap in
 * Engine.
 */
export const answersOnlyItself = (property: PropertyKey): boolean => typeof property === 'symbol'
  ? property === Symbol.toPrimitive || property === inspect.custom || property === registeredInspectCustom || isLibrarySymbol(property)
  : property === 'toString' || property === 'valueOf' || property === 'toJSON' || property === 'then' ||
    (property === 'inspect' && callsInspectMethod)

/**
 * E57: a symbol that is neither the library's own nor registered (Symbol.for), nor one of the printing and conversion
 * symbols of answersOnlyItself: a private symbol of the code under test or of the runtime (Node.js's kKeyType), or a
 * well-known symbol. Read through an object that inherits from a substitute, it reads undefined unless configured (see
 * the get trap in Engine).
 */
export const isForeignSymbol = (property: PropertyKey): boolean => typeof property === 'symbol' &&
  property !== Symbol.toPrimitive && property !== inspect.custom && property !== INTERNAL && Symbol.keyFor(property) === undefined

/** Node.js 10 still calls an object's own `inspect` method in util.inspect (DEP0079, removed in Node.js 11). */
const callsInspectMethod = typeof process === 'object' && process !== null && typeof process.version === 'string' &&
  /^v10\./.test(process.version)

export const keyToString =(key: PropertyKey): string => typeof key === 'symbol' ? key.toString() : String(key)

export const EXCEPTION = {
  callCountMismatch: 'CallCountMismatch',
  propertyNotMocked: 'PropertyNotMocked'
} as const
export type SubstituteExceptionType = typeof EXCEPTION[keyof typeof EXCEPTION]
