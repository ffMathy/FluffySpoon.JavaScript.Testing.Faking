import { inspect, InspectOptions, types } from 'util'
import { SubstituteException } from './SubstituteException'

const instance = Symbol('Substitute:Instance')
type SpecialProperty = typeof instance | typeof inspect.custom | 'then'
export abstract class SubstituteBase extends Function {
  constructor() {
    super()
  }

  static instance: typeof instance = instance

  protected isSpecialProperty(property: PropertyKey): property is SpecialProperty {
    return property === SubstituteBase.instance || property === inspect.custom || property === 'then'
  }

  protected evaluateSpecialProperty(property: SpecialProperty) {
    switch (property) {
      case SubstituteBase.instance:
        return this
      case inspect.custom:
        return this.printableForm.bind(this)
      case 'then':
        return
      default:
        throw SubstituteException.generic(`Evaluation of special property ${property} is not implemented`)
    }
  }

  protected abstract printableForm(_: number, options: InspectOptions): string

  public [inspect.custom](...args: [_: number, options: InspectOptions]): string {
    return types.isProxy(this) ? this[inspect.custom](...args) : this.printableForm(...args)
  }
}