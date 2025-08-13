import { inspect, InspectOptions, isDeepStrictEqual } from 'util'
import { Argument, AllArguments } from '../shared'

type ArgumentsClass = 'plain' | 'with-predicate' | 'wildcard'
const argumentsClassDigitMapper: Record<ArgumentsClass | 'none', number> = {
  plain: 0,
  'with-predicate': 1,
  wildcard: 2,
  none: 4
}

export class RecordedArguments {
  private _argumentsClass?: ArgumentsClass
  private _value?: any[]

  private constructor(rawArguments: any[] | void) {
    if (typeof rawArguments === 'undefined') return this

    this._argumentsClass = this.classifyArguments(rawArguments)
    this._value = rawArguments
  }

  static from(rawArguments: any[]): RecordedArguments {
    return new this(rawArguments)
  }

  static none(): RecordedArguments {
    return new this()
  }

  static sort<T extends { recordedArguments: RecordedArguments }>(objectWithArguments: T[]): T[] {
    return objectWithArguments.sort((a, b) => {
      const aClass = a.recordedArguments.argumentsClass ?? 'none'
      const bClass = b.recordedArguments.argumentsClass ?? 'none'
      return argumentsClassDigitMapper[aClass] - argumentsClassDigitMapper[bClass]
    })
  }

  get argumentsClass(): ArgumentsClass | undefined {
    return this._argumentsClass
  }

  get value(): any[] | undefined {
    return this._value
  }

  public hasArguments(): this is this & { argumentsClass: ArgumentsClass, value: any[] } {
    return Array.isArray(this._value)
  }

  public match(other: RecordedArguments): boolean {
    if (this.argumentsClass === 'wildcard' || other.argumentsClass === 'wildcard') return true
    if (!this.hasArguments() || !other.hasArguments()) return !this.hasArguments() && !other.hasArguments()
    if (this.value.length !== other.value.length) return false
    return this.value.every((argument, index) => this.areArgumentsEqual(argument, other.value[index]))
  }

  private classifyArguments(rawArguments: any[]): ArgumentsClass {
    const allPlain = rawArguments.every(arg => !(arg instanceof Argument || arg instanceof AllArguments))
    if (allPlain) return 'plain'

    const hasSingleArgument = rawArguments.some(arg => arg instanceof Argument)
    if (hasSingleArgument) return 'with-predicate'

    return 'wildcard'
  }

  private areArgumentsEqual(a: any, b: any): boolean {
    if (a instanceof Argument && b instanceof Argument) return false
    if (a instanceof Argument) return a.matches(b)
    if (b instanceof Argument) return b.matches(a)
    return isDeepStrictEqual(a, b)
  }

  [inspect.custom](_: number, options: InspectOptions) {
    return this.printableForm(options)
  }

  private printableForm(options: InspectOptions): string {
    const inspectedValues = this.value?.map(v => inspect(v, options))
    if (!Array.isArray(inspectedValues)) return ''
    return inspectedValues.length !== 1
      ? `(${inspectedValues.join(', ')})`
      : inspectedValues[0]
  }
}
