type ValueToMap<T extends string> = { [key in T as Uncapitalize<key>]: key }

export type AssertionMethodRaw = 'received' | 'didNotReceive'
export type ConfigurationMethodRaw = 'clearReceivedCalls' | 'mimick' | 'configure'
export type SubstitutionMethodRaw = 'mimicks' | 'throws' | 'returns' | 'resolves' | 'rejects'

const contextMethodTypes: ValueToMap<AssertionMethodRaw | ConfigurationMethodRaw | SubstitutionMethodRaw> = {
  received: 'received',
  didNotReceive: 'didNotReceive',
  clearReceivedCalls: 'clearReceivedCalls',
  mimick: 'mimick',
  configure: 'configure',
  mimicks: 'mimicks',
  throws: 'throws',
  returns: 'returns',
  resolves: 'resolves',
  rejects: 'rejects'
}

// Registered symbols (Symbol.for) so that duplicate copies of the package interoperate.
const symbolFor = (name: string) => `@fluffy-spoon/substitute:${name}`
const received: unique symbol = Symbol.for(symbolFor(contextMethodTypes.received))
const didNotReceive: unique symbol = Symbol.for(symbolFor(contextMethodTypes.didNotReceive))
const clearReceivedCalls: unique symbol = Symbol.for(symbolFor(contextMethodTypes.clearReceivedCalls))
const mimick: unique symbol = Symbol.for(symbolFor(contextMethodTypes.mimick))
const configure: unique symbol = Symbol.for(symbolFor(contextMethodTypes.configure))
const mimicks: unique symbol = Symbol.for(symbolFor(contextMethodTypes.mimicks))
const throws: unique symbol = Symbol.for(symbolFor(contextMethodTypes.throws))
const returns: unique symbol = Symbol.for(symbolFor(contextMethodTypes.returns))
const resolves: unique symbol = Symbol.for(symbolFor(contextMethodTypes.resolves))
const rejects: unique symbol = Symbol.for(symbolFor(contextMethodTypes.rejects))
const none: unique symbol = Symbol.for(symbolFor('none'))

const contextTypes = {
  none: {
    raw: 'none',
    symbol: none
  },
  received: {
    raw: contextMethodTypes.received,
    symbol: received
  },
  didNotReceive: {
    raw: contextMethodTypes.didNotReceive,
    symbol: didNotReceive
  },
  clearReceivedCalls: {
    raw: contextMethodTypes.clearReceivedCalls,
    symbol: clearReceivedCalls
  },
  mimick: {
    raw: contextMethodTypes.mimick,
    symbol: mimick
  },
  configure: {
    raw: contextMethodTypes.configure,
    symbol: configure
  },
  mimicks: {
    raw: contextMethodTypes.mimicks,
    symbol: mimicks
  },
  throws: {
    raw: contextMethodTypes.throws,
    symbol: throws
  },
  returns: {
    raw: contextMethodTypes.returns,
    symbol: returns
  },
  resolves: {
    raw: contextMethodTypes.resolves,
    symbol: resolves
  },
  rejects: {
    raw: contextMethodTypes.rejects,
    symbol: rejects
  }
} as const

export const constants = {
  CONTEXT: contextTypes
}
