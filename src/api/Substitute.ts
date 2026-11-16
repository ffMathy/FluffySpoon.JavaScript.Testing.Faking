import { ObjectSubstitute } from './types'
import { createSubstitute } from '../internals'

export type SubstituteOf<T> = ObjectSubstitute<T> & T

export class Substitute {
  public static for<T>(): SubstituteOf<T> {
    return createSubstitute() as SubstituteOf<T>
  }
}
