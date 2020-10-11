import { Argument, AllArguments } from './Arguments'

type ArgumentsClass = 'primitives-only' | 'with-single-argument' | 'all-arguments'
export class RecordedArguments {
  private _argumentsClass: ArgumentsClass
  private _value?: any[]
  private readonly _hasNoArguments: boolean = false

  private constructor(rawArguments?: any[]) {
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

  static noArguments(): RecordedArguments {
    return new this()
  }

  static sort<T extends { arguments: RecordedArguments }>(objectWithArguments: T[]): T[] {
    return objectWithArguments.sort((a, b) => {
      const aClass = a.arguments.argumentsClass
      const bClass = b.arguments.argumentsClass

      if (aClass === bClass) return 0
      if (aClass === 'primitives-only') return -1
      if (bClass === 'primitives-only') return 1

      if (aClass === 'with-single-argument') return -1
      if (bClass === 'with-single-argument') return 1

      if (aClass === 'all-arguments') return -1
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
    if (this.hasNoArguments && other.hasNoArguments) return true
    if (this.argumentsClass === 'all-arguments' || other.argumentsClass === 'all-arguments') return true
    if (this.value.length !== this.value.length) return false

    return this.value.every((argument, index) => this.areArgumentsEqual(argument, other.value[index]))
  }

  private classifyArguments(rawArguments: any[]): ArgumentsClass {
    const allPrimitives = rawArguments.every(arg => !(arg instanceof Argument || arg instanceof AllArguments))
    if (allPrimitives) return 'primitives-only'

    const hasSingleArgument = rawArguments.some(arg => arg instanceof Argument)
    if (hasSingleArgument) return 'with-single-argument'

    return 'all-arguments'
  }

  private areArgumentsEqual(a: any, b: any): boolean {
    if (a instanceof Argument && b instanceof Argument) return false
    if (a instanceof Argument) return a.matches(b)
    if (b instanceof Argument) return b.matches(a)
    return this.areArgumentsDeepEqual(a, b)
  }

  private areArgumentsDeepEqual(a: any, b: any, previousSeenObjects?: WeakSet<object>): boolean {
    const seenObjects = previousSeenObjects ?? new WeakSet()

    const seenA = seenObjects.has(a)
    const seenB = seenObjects.has(b)
    const aIsNonNullObject = typeof a === 'object' && a !== null
    const bIsNonNullObject = typeof b === 'object' && b !== null

    if (!seenA && aIsNonNullObject) seenObjects.add(a)
    if (!seenB && bIsNonNullObject) seenObjects.add(b)

    const aEqualsB = a === b
    if ((seenA && seenB) || aEqualsB) return aEqualsB

    if (aIsNonNullObject && bIsNonNullObject) {
      if (a.constructor !== b.constructor) return false
      const objectAKeys = Object.keys(a)
      if (objectAKeys.length !== Object.keys(b).length) return false
      return objectAKeys.every(key => this.areArgumentsDeepEqual(a[key], b[key], seenObjects))
    }

    return aEqualsB
  }
}
