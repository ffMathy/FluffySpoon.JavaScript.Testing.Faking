type ValueToMap<T extends string> = { [key in T as Uncapitalize<key>]: key }

export type AssertionMethodRaw = 'received' | 'didNotReceive'
export type ConfigurationMethodRaw = 'clearReceivedCalls' | 'mimick'
export type SubstitutionMethodRaw = 'mimicks' | 'throws' | 'returns' | 'resolves' | 'rejects'

const contextMethodTypes: ValueToMap<AssertionMethodRaw | ConfigurationMethodRaw | SubstitutionMethodRaw> = {
  received: 'received',
  didNotReceive: 'didNotReceive',
  clearReceivedCalls: 'clearReceivedCalls',
  mimick: 'mimick',
  mimicks: 'mimicks',
  throws: 'throws',
  returns: 'returns',
  resolves: 'resolves',
  rejects: 'rejects'
}

const received = Symbol(contextMethodTypes.received)
const didNotReceive = Symbol(contextMethodTypes.didNotReceive)
const clearReceivedCalls = Symbol(contextMethodTypes.clearReceivedCalls)
const mimick = Symbol(contextMethodTypes.mimick)
const mimicks = Symbol(contextMethodTypes.mimicks)
const throws = Symbol(contextMethodTypes.throws)
const returns = Symbol(contextMethodTypes.returns)
const resolves = Symbol(contextMethodTypes.resolves)
const rejects = Symbol(contextMethodTypes.rejects)
const none = Symbol('none')

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
