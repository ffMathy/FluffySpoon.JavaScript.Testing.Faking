import type { ClearReceivedCallsPropertyKey, DidNotReceivePropertyKey, MimickPropertyKey, MimicksPropertyKey, ReceivedPropertyKey, RejectsPropertyKey, ResolvesPropertyKey, ReturnsPropertyKey, ThrowsPropertyKey, clearReceivedCalls, didNotReceive, mimick, mimicks, received, rejects, resolves, returns, throws } from "./Transformations"

export type PropertyType = 'method' | 'property'

export type AssertionMethod = 
    ReceivedPropertyKey | 
    DidNotReceivePropertyKey

export type ConfigurationMethod = 
    ClearReceivedCallsPropertyKey | 
    MimickPropertyKey

export type SubstitutionMethod = 
    MimicksPropertyKey | 
    ThrowsPropertyKey | 
    ReturnsPropertyKey | 
    ResolvesPropertyKey | 
    RejectsPropertyKey

export type FirstLevelMethod = AssertionMethod | ConfigurationMethod

export type SubstituteMethod = FirstLevelMethod | SubstitutionMethod

export type SubstituteContext = SubstituteMethod | 'none'

export type FilterFunction<T> = (item: T) => boolean