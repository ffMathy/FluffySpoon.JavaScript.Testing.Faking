import { inspect } from 'util'
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
 * (is it iterable, a RegExp, a promisify-able function, a jest asymmetric matcher, ...). An unconfigured read of
 * one of them answers undefined and is not recorded, the same way `then` is handled, so that a substitute behaves
 * like a plain function or object to those algorithms. Configuring the key (through sub[configure]()) or mimicking
 * an instance that has it makes the read answer as usual.
 */
const wellKnownSymbols = Symbol as unknown as Record<string, symbol | undefined>
const protocolKeys = new Set<PropertyKey>([
  // every well-known symbol except Symbol.toPrimitive, which is a special property (see isSpecialProperty);
  // asyncIterator and matchAll are looked up by name because older runtimes do not have them
  ...['iterator', 'asyncIterator', 'hasInstance', 'isConcatSpreadable', 'match', 'matchAll', 'replace', 'search',
    'split', 'species', 'toStringTag', 'unscopables'].map(name => wellKnownSymbols[name]),
  Symbol.for('nodejs.util.promisify.custom'),
  'asymmetricMatch'
].filter(key => key !== undefined) as PropertyKey[])

export const isProtocolKey = (property: PropertyKey): boolean => protocolKeys.has(property)

export const keyToString =(key: PropertyKey): string => typeof key === 'symbol' ? key.toString() : String(key)

export const EXCEPTION = {
  callCountMismatch: 'CallCountMismatch',
  propertyNotMocked: 'PropertyNotMocked'
} as const
export type SubstituteExceptionType = typeof EXCEPTION[keyof typeof EXCEPTION]
