import { Substitute } from './api'
import { SubstituteException as SubstituteExceptionClass } from './internals/SubstituteException'

export * from './api'
export default Substitute

/**
 * The error thrown when an assertion (`received` / `didNotReceive`) fails and on invalid use of the library.
 * Use it with `instanceof`: `t.throws(() => sub.received().add(1, 2), { instanceOf: SubstituteException })`.
 */
export interface SubstituteException extends Error {
  /** The kind of failure, e.g. 'CallCountMismatch'. */
  type?: string
}

// Declared through a public interface so that the published typings do not depend on the internals (which reference
// Node's `util` typings).
export const SubstituteException: {
  new (message: string): SubstituteException
  readonly prototype: SubstituteException
} = SubstituteExceptionClass
