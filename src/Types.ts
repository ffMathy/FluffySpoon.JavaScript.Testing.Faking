export type PropertyType = 'method' | 'property'
export type AssertionMethod = 'received' | 'didNotReceive'
export type ConfigurationMethod = 'clearSubstitute' | 'mimick'
export type SubstitutionMethod = 'mimicks' | 'throws' | 'returns' | 'resolves' | 'rejects'

export type FirstLevelMethod = AssertionMethod | ConfigurationMethod
export type SubstituteMethod = FirstLevelMethod | SubstitutionMethod
export type SubstituteContext = SubstituteMethod | 'none'

export type ClearType = 'all' | 'receivedCalls' | 'substituteValues'

export type FilterFunction<T> = (item: T) => boolean