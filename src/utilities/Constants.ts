import { AccessorType, ClearType, PropertyType, SubstituteContext, SubstituteExceptionType } from '../Types'

type ValueToMap<T extends string> = { [key in T as Uncapitalize<key>]: key }
const propertyTypes: ValueToMap<PropertyType> = {
  method: 'method',
  property: 'property'
}
const accessorTypes: ValueToMap<AccessorType> = {
  get: 'get',
  set: 'set'
}
const clearTypes: ValueToMap<ClearType> = {
  all: 'all',
  receivedCalls: 'receivedCalls',
  substituteValues: 'substituteValues'
}
const contextTypes: ValueToMap<SubstituteContext> = {
  none: 'none',
  received: 'received',
  didNotReceive: 'didNotReceive',
  clearSubstitute: 'clearSubstitute',
  mimick: 'mimick',
  mimicks: 'mimicks',
  throws: 'throws',
  returns: 'returns',
  resolves: 'resolves',
  rejects: 'rejects'
}
const SubstituteExceptionTypes: ValueToMap<SubstituteExceptionType> = {
  callCountMismatch: 'CallCountMismatch',
  propertyNotMocked: 'PropertyNotMocked'
}

export const constants = {
  PROPERTY: propertyTypes,
  ACCESSOR: accessorTypes,
  CLEAR: clearTypes,
  CONTEXT: contextTypes,
  EXCEPTION: SubstituteExceptionTypes
}