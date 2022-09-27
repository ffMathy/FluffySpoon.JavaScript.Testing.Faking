import { inspect, InspectOptions } from 'util'

import { SubstituteBase } from './SubstituteBase'
import { createSubstituteProxy } from './SubstituteProxy'
import { Recorder } from './Recorder'
import { DisabledSubstituteObject, ObjectSubstitute, OmitProxyMethods } from './Transformations'

export type SubstituteOf<T extends Object> = ObjectSubstitute<OmitProxyMethods<T>, T> & T
type Instantiable<T> = { [SubstituteBase.instance]?: T }

export class Substitute extends SubstituteBase {
  private _proxy: Substitute
  private _recorder: Recorder = new Recorder()
  private _context: { disableAssertions: boolean } = { disableAssertions: false }

  constructor() {
    super()
    this._proxy = createSubstituteProxy(
      this,
      {
        get: (target, _property, _, node) => {
          if (target.context.disableAssertions) node.disableAssertions()
        }
        // apply: (target, _, args, __, proxy) => {
        // const rootProperty = proxy.get(target, '()', proxy) TODO: Implement to support callable interfaces
        // return Reflect.apply(rootProperty, rootProperty, args)
        // }
      }
    )
  }

  static for<T extends Object>(): SubstituteOf<T> {
    const substitute = new this()
    return substitute.proxy as unknown as SubstituteOf<T>
  }

  static disableFor<T extends SubstituteOf<unknown> & Instantiable<Substitute>>(substituteProxy: T): DisabledSubstituteObject<T> {
    const substitute = substituteProxy[SubstituteBase.instance]

    const disableProxy = <
      TParameters extends unknown[],
      TReturnType extends unknown
    >(reflection: (...args: TParameters) => TReturnType): typeof reflection => (...args) => {
      substitute.context.disableAssertions = true
      const reflectionResult = reflection(...args)
      substitute.context.disableAssertions = false
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

  public get proxy() {
    return this._proxy
  }

  public get recorder() {
    return this._recorder
  }

  public get context() {
    return this._context
  }

  protected printableForm(_: number, options: InspectOptions): string {
    const records = inspect(this.recorder, options)

    const instanceName = 'Substitute' // Substitute<FooThing>
    return instanceName + ' {' + records + '\n}'
  }
}
