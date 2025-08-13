import { AssertionMethod, ConfigurationMethod, SubstituteMethod, SubstitutionMethod, SubstituteContext, PropertyType, ContextNone, ContextReceived, ContextDidNotReceive, ContextClearReceivedCalls, ContextMimick, ContextMimicks, ContextThrows, ContextReturns, ContextResolves, ContextRejects } from '../Types'
import { constants } from '../Constants'
import { constants as sharedConstants } from '../../shared'

const isAssertionMethod = (property: PropertyKey): property is AssertionMethod =>
  property === sharedConstants.CONTEXT.received.raw ||
  property === sharedConstants.CONTEXT.received.symbol ||
  property === sharedConstants.CONTEXT.didNotReceive.raw ||
  property === sharedConstants.CONTEXT.didNotReceive.symbol
const isConfigurationMethod = (property: PropertyKey): property is ConfigurationMethod =>
  property === sharedConstants.CONTEXT.clearReceivedCalls.raw ||
  property === sharedConstants.CONTEXT.clearReceivedCalls.symbol ||
  property === sharedConstants.CONTEXT.mimick.raw ||
  property === sharedConstants.CONTEXT.mimick.symbol
const isSubstitutionMethod = (property: PropertyKey): property is SubstitutionMethod =>
  property === sharedConstants.CONTEXT.mimicks.raw ||
  property === sharedConstants.CONTEXT.mimicks.symbol ||
  property === sharedConstants.CONTEXT.returns.raw ||
  property === sharedConstants.CONTEXT.returns.symbol ||
  property === sharedConstants.CONTEXT.throws.raw ||
  property === sharedConstants.CONTEXT.throws.symbol ||
  property === sharedConstants.CONTEXT.resolves.raw ||
  property === sharedConstants.CONTEXT.resolves.symbol ||
  property === sharedConstants.CONTEXT.rejects.raw ||
  property === sharedConstants.CONTEXT.rejects.symbol
const isSubstituteMethod = (property: PropertyKey): property is SubstituteMethod =>
  isSubstitutionMethod(property) || isConfigurationMethod(property) || isAssertionMethod(property)

const isPropertyProperty = (value: PropertyType): value is (typeof constants['PROPERTY']['property']) => value === constants.PROPERTY.property
const isPropertyMethod = (value: PropertyType): value is (typeof constants['PROPERTY']['method']) => value === constants.PROPERTY.method

const isContextNone = (value: SubstituteContext): value is Exclude<ContextNone, string> => value === sharedConstants.CONTEXT.none.symbol
const isContextReceived = (value: SubstituteContext): value is Exclude<ContextReceived, string> => value === sharedConstants.CONTEXT.received.symbol
const isContextDidNotReceive = (value: SubstituteContext): value is Exclude<ContextDidNotReceive, string> => value === sharedConstants.CONTEXT.didNotReceive.symbol
const isContextClearSubstitute = (value: SubstituteContext): value is Exclude<ContextClearReceivedCalls, string> => value === sharedConstants.CONTEXT.clearReceivedCalls.symbol
const isContextMimick = (value: SubstituteContext): value is Exclude<ContextMimick, string> => value === sharedConstants.CONTEXT.mimick.symbol
const isContextMimicks = (value: SubstituteContext): value is Exclude<ContextMimicks, string> => value === sharedConstants.CONTEXT.mimicks.symbol
const isContextThrows = (value: SubstituteContext): value is Exclude<ContextThrows, string> => value === sharedConstants.CONTEXT.throws.symbol
const isContextReturns = (value: SubstituteContext): value is Exclude<ContextReturns, string> => value === sharedConstants.CONTEXT.returns.symbol
const isContextResolves = (value: SubstituteContext): value is Exclude<ContextResolves, string> => value === sharedConstants.CONTEXT.resolves.symbol
const isContextRejects = (value: SubstituteContext): value is Exclude<ContextRejects, string> => value === sharedConstants.CONTEXT.rejects.symbol
const isContextSubstitution = (value: SubstituteContext): value is Exclude<SubstitutionMethod, string> => typeof value !== 'string' && isSubstitutionMethod(value)
const isContextAssertion = (value: SubstituteContext): value is Exclude<AssertionMethod, string> => typeof value !== 'string' && isAssertionMethod(value)

const isContextValue = (property: PropertyKey): property is SubstituteContext => typeof property !== 'string' && isSubstituteMethod(property)

export const method = {
  assertion: isAssertionMethod,
  configuration: isConfigurationMethod,
  substitution: isSubstitutionMethod,
  substitute: isSubstituteMethod,
  contextValue: isContextValue
}

export const PROPERTY = {
  property: isPropertyProperty,
  method: isPropertyMethod
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
