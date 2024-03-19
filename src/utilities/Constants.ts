import { ClearType, PropertyType } from '../Types'

type ValueToMap<T extends string> = { [key in T]: key }
const propertyTypes: ValueToMap<PropertyType> = {
  method: 'method',
  property: 'property'
}
const clearTypes: ValueToMap<ClearType> = {
  all: 'all',
  receivedCalls: 'receivedCalls',
  substituteValues: 'substituteValues'
}

export const constants = {
  PROPERTY: propertyTypes,
  CLEAR: clearTypes
}