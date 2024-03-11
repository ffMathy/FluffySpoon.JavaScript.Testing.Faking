import { ObjectSubstitute } from './Transformations'
import { SubstituteNode } from './SubstituteNode'

export type SubstituteOf<T> = ObjectSubstitute<T> & T

type InstantiableSubstitute<T extends SubstituteOf<unknown>> = T & { [SubstituteNode.instance]: SubstituteNode }

export class Substitute {
  public static for<T>(): SubstituteOf<T> {
    const substitute = SubstituteNode.createRoot()
    return substitute.proxy as unknown as SubstituteOf<T>
  }

  private static extractSubstituteNodeFromSubstitute(substitute: InstantiableSubstitute<SubstituteOf<unknown>>): SubstituteNode {
    return substitute[SubstituteNode.instance]
  }
}