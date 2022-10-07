import { DisabledSubstituteObject, ObjectSubstitute } from './Transformations'
import { SubstituteNode } from './SubstituteNode'

export type SubstituteOf<T> = ObjectSubstitute<T> & T
type InstantiableSubstitute = SubstituteOf<unknown> & { [SubstituteNode.instance]?: SubstituteNode }

export class Substitute {
  static for<T>(): SubstituteOf<T> {
    const substitute = SubstituteNode.createRoot()
    return substitute.proxy as unknown as SubstituteOf<T>
  }

  static disableFor<T extends InstantiableSubstitute>(substituteProxy: T): DisabledSubstituteObject<T> {
    const substitute = substituteProxy[SubstituteNode.instance]

    const disableProxy = <
      TParameters extends unknown[],
      TReturnType extends unknown
    >(reflection: (...args: TParameters) => TReturnType): typeof reflection => (...args) => {
      substitute.rootContext.substituteMethodsEnabled = false
      const reflectionResult = reflection(...args)
      substitute.rootContext.substituteMethodsEnabled = true
      return reflectionResult
    }

    return new Proxy(substitute.proxy, {
      get: function (target, property) {
        return disableProxy(Reflect.get)(target, property)
      },
      set: function (target, property, value) {
        return disableProxy(Reflect.set)(target, property, value)
      },
      apply: function (target, _, args) {
        return disableProxy(Reflect.apply)(target, _, args)
      }
    }) as DisabledSubstituteObject<T>
  }
}