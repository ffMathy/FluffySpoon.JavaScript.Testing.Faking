import { RecordedArguments } from './RecordedArguments'

export type PropertyType = 'method' | 'property'
export type AccessorType = 'get' | 'set'
export type AssertionMethod = 'received' | 'didNotReceive'
export type ConfigurationMethod = 'clearSubstitute' | 'mimick'
export type SubstitutionMethod = 'mimicks' | 'throws' | 'returns' | 'resolves' | 'rejects'

export type FirstLevelMethod = AssertionMethod | ConfigurationMethod
export type SubstituteMethod = FirstLevelMethod | SubstitutionMethod
export type SubstituteContext = SubstituteMethod | 'none'

export type ClearType = 'all' | 'receivedCalls' | 'substituteValues'

export type SubstituteExceptionType = 'CallCountMismatch' | 'PropertyNotMocked'

export type FilterFunction<T> = (item: T) => boolean

export type SubstituteNodeModel = {
  propertyType: PropertyType
  property: PropertyKey
  context: SubstituteContext
  recordedArguments: RecordedArguments
  stack?: string
}