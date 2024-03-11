import { ObjectSubstitute } from './Transformations'
import { SubstituteNode } from './SubstituteNode'

export type SubstituteOf<T> = ObjectSubstitute<T> & T

export class Substitute {
  public static for<T>(): SubstituteOf<T> {
    const substitute = SubstituteNode.createRoot()
    return substitute.proxy as unknown as SubstituteOf<T>
  }
}