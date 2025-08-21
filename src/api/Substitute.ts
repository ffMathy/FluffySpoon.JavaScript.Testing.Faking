import { ObjectSubstitute } from './types'
import { SubstituteNode } from '../internals'

export type SubstituteOf<T> = ObjectSubstitute<T> & T

export class Substitute {
  public static for<T>(): SubstituteOf<T> {
    const substitute = SubstituteNode.createRoot()
    return substitute.proxy as unknown as SubstituteOf<T>
  }
}
