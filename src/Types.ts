import type { clearReceivedCalls, didNotReceive, mimick, mimicks, received, rejects, resolves, returns, throws } from "./Symbols"

export type PropertyType = 'method' | 'property'
export type AssertionMethod = typeof received | typeof didNotReceive
export type ConfigurationMethod = typeof clearReceivedCalls | typeof mimick
export type SubstitutionMethod = typeof mimicks | typeof throws | typeof returns | typeof resolves | typeof rejects

export type FirstLevelMethod = AssertionMethod | ConfigurationMethod
export type SubstituteMethod = FirstLevelMethod | SubstitutionMethod
export type SubstituteContext = SubstituteMethod | 'none'

export type FilterFunction<T> = (item: T) => boolean