import { constants as sharedConstants } from '../shared'

const received: typeof sharedConstants.CONTEXT.received.symbol = sharedConstants.CONTEXT.received.symbol
const didNotReceive: typeof sharedConstants.CONTEXT.didNotReceive.symbol = sharedConstants.CONTEXT.didNotReceive.symbol
const clearReceivedCalls: typeof sharedConstants.CONTEXT.clearReceivedCalls.symbol = sharedConstants.CONTEXT.clearReceivedCalls.symbol
const mimick: typeof sharedConstants.CONTEXT.mimick.symbol = sharedConstants.CONTEXT.mimick.symbol
const mimicks: typeof sharedConstants.CONTEXT.mimicks.symbol = sharedConstants.CONTEXT.mimicks.symbol
const throws: typeof sharedConstants.CONTEXT.throws.symbol = sharedConstants.CONTEXT.throws.symbol
const returns: typeof sharedConstants.CONTEXT.returns.symbol = sharedConstants.CONTEXT.returns.symbol
const resolves: typeof sharedConstants.CONTEXT.resolves.symbol = sharedConstants.CONTEXT.resolves.symbol
const rejects: typeof sharedConstants.CONTEXT.rejects.symbol = sharedConstants.CONTEXT.rejects.symbol

export { received, didNotReceive, clearReceivedCalls, mimick, mimicks, throws, returns, resolves, rejects }
