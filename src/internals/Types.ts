import { RecordedArguments } from './RecordedArguments'
import type { constants } from './Constants'
import type { constants as sharedConstants } from '../shared'

type ContextMap = typeof sharedConstants.CONTEXT
type Unfold<T> = T[keyof T]

export type ContextReceived = Unfold<ContextMap['received']>
export type ContextDidNotReceive = Unfold<ContextMap['didNotReceive']>
export type ContextClearReceivedCalls = Unfold<ContextMap['clearReceivedCalls']>
export type ContextMimick = Unfold<ContextMap['mimick']>
export type ContextMimicks = Unfold<ContextMap['mimicks']>
export type ContextThrows = Unfold<ContextMap['throws']>
export type ContextReturns = Unfold<ContextMap['returns']>
export type ContextResolves = Unfold<ContextMap['resolves']>
export type ContextRejects = Unfold<ContextMap['rejects']>

export type AssertionMethod = ContextReceived | ContextDidNotReceive
export type ConfigurationMethod = ContextClearReceivedCalls | ContextMimick
export type SubstitutionMethod = ContextMimicks | ContextThrows | ContextReturns | ContextResolves | ContextRejects
export type ContextNone = Unfold<ContextMap['none']>

export type SubstituteMethod = AssertionMethod | ConfigurationMethod | SubstitutionMethod
export type SubstituteContext = Exclude<SubstituteMethod | ContextNone, string>
// export type SubstituteContext2 = ContextMap[keyof ContextMap]['symbol']
// export type ClearType = typeof constants.CLEAR[keyof typeof constants.CLEAR]['raw']

// export type ClearType = 'all' | 'receivedCalls' | 'substituteValues'
type PropertyType = typeof constants.PROPERTY.method | typeof constants.PROPERTY.property
type AccessorType = typeof constants.ACCESSOR.get | typeof constants.ACCESSOR.set
type SubstituteExceptionType = typeof constants.EXCEPTION.callCountMismatch | typeof constants.EXCEPTION.propertyNotMocked

export type FilterFunction<T> = (item: T) => boolean

export type { PropertyType, AccessorType, SubstituteExceptionType }
export type SubstituteNodeModel = {
	propertyType: PropertyType
	property: PropertyKey
	context: SubstituteContext
	recordedArguments: RecordedArguments
	stack?: string
}
