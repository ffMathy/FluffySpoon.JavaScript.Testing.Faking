import { inspect } from 'util';
import { PropertyType, stringifyArguments, stringifyCalls, Call } from './Utilities';

export class SubstituteJS {
  private _lastRegisteredSubstituteJSMethodOrProperty: string
  set lastRegisteredSubstituteJSMethodOrProperty(value: string) {
    this._lastRegisteredSubstituteJSMethodOrProperty = value;
  }
  get lastRegisteredSubstituteJSMethodOrProperty() {
    return this._lastRegisteredSubstituteJSMethodOrProperty ?? 'root';
  }
  [Symbol.toPrimitive]() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  [Symbol.toStringTag]() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  [Symbol.iterator]() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  [inspect.custom]() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  valueOf() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  $$typeof() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  toString() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  inspect() {
    return `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
  }
  length = `[class ${this.constructor.name}] -> ${this.lastRegisteredSubstituteJSMethodOrProperty}`;
}

enum SubstituteExceptionTypes {
  CallCountMissMatch = 'CallCountMissMatch',
  PropertyNotMocked = 'PropertyNotMocked'
}

export class SubstituteException extends Error {
  type: SubstituteExceptionTypes
  constructor(msg: string, exceptionType?: SubstituteExceptionTypes) {
    super(msg);
    Error.captureStackTrace(this, SubstituteException);
    this.name = new.target.name;
    this.type = exceptionType
  }

  static forCallCountMissMatch(
    callCount: { expected: number | null, received: number },
    property: { type: PropertyType, value: PropertyKey },
    calls: { expectedArguments: any[], received: Call[] }
  ) {
    const message = 'Expected ' + (callCount.expected === null ? '1 or more' : callCount.expected) +
      ' call' + (callCount.expected === 1 ? '' : 's') + ' to the ' + property.type + ' ' + property.value.toString() +
      ' with ' + stringifyArguments(calls.expectedArguments) + ', but received ' + (callCount.received === 0 ? 'none' : callCount.received) +
      ' of such call' + (callCount.received === 1 ? '' : 's') +
      '.\nAll calls received to ' + property.type + ' ' + property.value.toString() + ':' + stringifyCalls(calls.received);
    return new this(message, SubstituteExceptionTypes.CallCountMissMatch);
  }

  static forPropertyNotMocked(property: PropertyKey) {
    return new this(`There is no mock for property: ${String(property)}`, SubstituteExceptionTypes.PropertyNotMocked)
  }

  static generic(message: string) {
    return new this(message)
  }
}