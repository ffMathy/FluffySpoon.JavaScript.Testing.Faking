import { ObjectSubstituteTransformation } from './Substitute'
import { ObjectSubstituteMethods } from './SubstituteMethods'

export type ObjectSubstitute<T> = 
    ObjectSubstituteMethods<T> & 
    ObjectSubstituteTransformation<T>

export { received, didNotReceive, clearReceivedCalls, mimick } from './SubstituteMethods'
export { returns, throws, resolves, rejects, mimicks } from './SubstitutionLevel'
