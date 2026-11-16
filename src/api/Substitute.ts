import { ObjectSubstitute } from './types'
import { createSubstitute } from '../internals'

/**
 * The type of a substitute for `T`: every member of `T` with the setup API (`.returns`, `.throws`, `.mimicks`, and
 * `.resolves` / `.rejects` for promises), plus `received` / `didNotReceive` and the symbol API (`[received]`,
 * `[didNotReceive]`, `[configure]`, `[mimick]`, `[clearReceivedCalls]`). It is assignable to `T`.
 */
export type SubstituteOf<T> = ObjectSubstitute<T> & T

export class Substitute {
  /**
   * Creates a substitute for `T` (an interface, a class or any other type): `const calculator = Substitute.for<Calculator>()`.
   * Configure it with `calculator.add(1, 2).returns(3)`, pass it to the code under test as a `T`, and check the calls
   * with `calculator.received().add(1, 2)`. Members that were not configured return a substitute of their own.
   */
  public static for<T>(): SubstituteOf<T> {
    return createSubstitute() as SubstituteOf<T>
  }
}
