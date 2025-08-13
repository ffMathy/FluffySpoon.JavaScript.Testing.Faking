import { constants } from '../../shared'
import {
  TryToExpandNonArgumentedTerminatingFunction,
  TryToExpandArgumentedTerminatingFunction
} from './Substitute'

type TerminatingObject<T> = {
  [P in keyof T]: 
    TryToExpandNonArgumentedTerminatingFunction<T, P> & 
    TryToExpandArgumentedTerminatingFunction<T, P> & 
    T[P]
}

export const received: typeof constants.CONTEXT.received.symbol = constants.CONTEXT.received.symbol
export const didNotReceive: typeof constants.CONTEXT.didNotReceive.symbol = constants.CONTEXT.didNotReceive.symbol
export const mimick: typeof constants.CONTEXT.mimick.symbol = constants.CONTEXT.mimick.symbol
export const clearReceivedCalls: typeof constants.CONTEXT.clearReceivedCalls.symbol = constants.CONTEXT.clearReceivedCalls.symbol

export type ObjectSubstituteMethods<T> = 
  (T extends { received: any } ? 
    { [received](amount?: number): TerminatingObject<T> } :
    { received(amount?: number): TerminatingObject<T> }) &
  (T extends { didNotReceive: any } ? 
    { [didNotReceive](): TerminatingObject<T> } :
    { didNotReceive(): TerminatingObject<T> }) &
  (T extends { mimick: any } ? 
    { [mimick](instance: T): void } :
    { mimick(instance: T): void }) &
  (T extends { clearReceivedCalls: any } ? 
    { [clearReceivedCalls](): void } :
    { clearReceivedCalls(): void })
