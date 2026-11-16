import { ObjectSubstituteTransformation } from './Substitute'
import { ObjectSubstituteMethods } from './SubstituteMethods'
import { FunctionSubstitute } from './FunctionSubstitute'

// A substitute of a function type (or of an interface with call signatures) is called like the function, and each call
// has the setup API (`listener('saved').returns('ack')`, T37). These signatures come before `T`'s own in
// `SubstituteOf<T>`, so a call resolves against them first.
export type ObjectSubstitute<T> =
    FunctionSubstitute<NonNullable<T>, 'substitute'> &
    ObjectSubstituteMethods<T> &
    ObjectSubstituteTransformation<T>

export { received, didNotReceive, clearReceivedCalls, mimick, configure } from './SubstituteMethods'
export { returns, throws, resolves, rejects, mimicks } from './SubstitutionLevel'
