import { constants as sharedConstants } from '../../shared'

type A = typeof sharedConstants.CONTEXT[Exclude<keyof typeof sharedConstants.CONTEXT, 'none'>]
type B = A['raw']
type C = A['symbol']

export const rawSymbolContextMap: Record<B, C> = {
  [sharedConstants.CONTEXT.received.raw]: sharedConstants.CONTEXT.received.symbol,
  [sharedConstants.CONTEXT.didNotReceive.raw]: sharedConstants.CONTEXT.didNotReceive.symbol,
  [sharedConstants.CONTEXT.clearReceivedCalls.raw]: sharedConstants.CONTEXT.clearReceivedCalls.symbol,
  [sharedConstants.CONTEXT.mimick.raw]: sharedConstants.CONTEXT.mimick.symbol,
  [sharedConstants.CONTEXT.mimicks.raw]: sharedConstants.CONTEXT.mimicks.symbol,
  [sharedConstants.CONTEXT.throws.raw]: sharedConstants.CONTEXT.throws.symbol,
  [sharedConstants.CONTEXT.returns.raw]: sharedConstants.CONTEXT.returns.symbol,
  [sharedConstants.CONTEXT.resolves.raw]: sharedConstants.CONTEXT.resolves.symbol,
  [sharedConstants.CONTEXT.rejects.raw]: sharedConstants.CONTEXT.rejects.symbol,
}
