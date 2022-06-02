import { inspect, InspectOptions, isDeepStrictEqual } from 'util'
import { Argument, AllArguments } from './Arguments'

type ArgumentsClass = 'plain' | 'with-predicate' | 'wildcard'
export class RecordedArguments {
  private _argumentsClass: ArgumentsClass
  private _value?: any[]
  private readonly _hasNoArguments: boolean = false

  private constructor(rawArguments: any[] | void) {
    if (typeof rawArguments === 'undefined') {
      this._hasNoArguments = true
      return this
    }

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
      const aClass = a.recordedArguments.argumentsClass
      const bClass = b.recordedArguments.argumentsClass

      if (aClass === bClass) return 0
      if (aClass === 'plain') return -1
      if (bClass === 'plain') return 1

      if (aClass === 'with-predicate') return -1
      if (bClass === 'with-predicate') return 1

      if (aClass === 'wildcard') return -1
      return 1
    })
  }

  get argumentsClass(): ArgumentsClass {
    return this._argumentsClass
  }

  get value(): any[] | undefined {
    return this._value
  }

  get hasNoArguments(): boolean {
    return this._hasNoArguments
  }

  public match(other: RecordedArguments) {
    if (this.argumentsClass === 'wildcard' || other.argumentsClass === 'wildcard') return true
    if (this.hasNoArguments || other.hasNoArguments) return this.hasNoArguments && other.hasNoArguments
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