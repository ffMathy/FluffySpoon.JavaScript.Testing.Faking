import { AssertionMethod, ClearType, ConfigurationMethod, PropertyType, SubstituteMethod, SubstitutionMethod, SubstituteContext } from '../Types'
import { constants } from './Constants'

const isAssertionMethod = (property: PropertyKey): property is AssertionMethod =>
  property === 'received' || property === 'didNotReceive'
const isConfigurationMethod = (property: PropertyKey): property is ConfigurationMethod => property === 'clearSubstitute' || property === 'mimick'
const isSubstitutionMethod = (property: PropertyKey): property is SubstitutionMethod =>
  property === 'mimicks' || property === 'returns' || property === 'throws' || property === 'resolves' || property === 'rejects'
const isSubstituteMethod = (property: PropertyKey): property is SubstituteMethod =>
  isSubstitutionMethod(property) || isConfigurationMethod(property) || isAssertionMethod(property)

const isPropertyProperty = (value: PropertyType): value is (typeof constants['PROPERTY']['property']) => value === constants.PROPERTY.property
const isPropertyMethod = (value: PropertyType): value is (typeof constants['PROPERTY']['method']) => value === constants.PROPERTY.method

const isClearAll = (value: ClearType): value is (typeof constants['CLEAR']['all']) => value === constants.CLEAR.all
const isClearReceivedCalls = (value: ClearType): value is (typeof constants['CLEAR']['receivedCalls']) => value === constants.CLEAR.receivedCalls
const isClearSubstituteValues = (value: ClearType): value is (typeof constants['CLEAR']['substituteValues']) => value === constants.CLEAR.substituteValues

const isContextNone = (value: SubstituteContext): value is (typeof constants['CONTEXT']['none']) => value === constants.CONTEXT.none
const isContextReceived = (value: SubstituteContext): value is (typeof constants['CONTEXT']['received']) => value === constants.CONTEXT.received
const isContextDidNotReceive = (value: SubstituteContext): value is (typeof constants['CONTEXT']['didNotReceive']) => value === constants.CONTEXT.didNotReceive
const isContextClearSubstitute = (value: SubstituteContext): value is (typeof constants['CONTEXT']['clearSubstitute']) => value === constants.CONTEXT.clearSubstitute
const isContextMimick = (value: SubstituteContext): value is (typeof constants['CONTEXT']['mimick']) => value === constants.CONTEXT.mimick
const isContextMimicks = (value: SubstituteContext): value is (typeof constants['CONTEXT']['mimicks']) => value === constants.CONTEXT.mimicks
const isContextThrows = (value: SubstituteContext): value is (typeof constants['CONTEXT']['throws']) => value === constants.CONTEXT.throws
const isContextReturns = (value: SubstituteContext): value is (typeof constants['CONTEXT']['returns']) => value === constants.CONTEXT.returns
const isContextResolves = (value: SubstituteContext): value is (typeof constants['CONTEXT']['resolves']) => value === constants.CONTEXT.resolves
const isContextRejects = (value: SubstituteContext): value is (typeof constants['CONTEXT']['rejects']) => value === constants.CONTEXT.rejects
const isContextSubstitution = (value: SubstituteContext): value is SubstitutionMethod => isSubstitutionMethod(value)
const isContextAssertion = (value: SubstituteContext): value is AssertionMethod => isAssertionMethod(value)

export const method = {
  assertion: isAssertionMethod,
  configuration: isConfigurationMethod,
  substitution: isSubstitutionMethod,
  substitute: isSubstituteMethod,
}

export const PROPERTY = {
  property: isPropertyProperty,
  method: isPropertyMethod
}

export const CLEAR = {
  all: isClearAll,
  receivedCalls: isClearReceivedCalls,
  substituteValues: isClearSubstituteValues
}

export const CONTEXT = {
  none: isContextNone,
  received: isContextReceived,
  didNotReceive: isContextDidNotReceive,
  clearSubstitute: isContextClearSubstitute,
  mimick: isContextMimick,
  mimicks: isContextMimicks,
  throws: isContextThrows,
  returns: isContextReturns,
  resolves: isContextResolves,
  rejects: isContextRejects,
  substitution: isContextSubstitution,
  assertion: isContextAssertion
}

