import { AssertionMethod, ClearType, ConfigurationMethod, PropertyType, SubstituteMethod, SubstitutionMethod } from '../Types'
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
