import { PropertyType } from './Types'
import { RecordedArguments } from './RecordedArguments'
import { PropertyType as PropertyTypeMap, stringifyArguments, stringifyCalls, textModifier, plurify } from './Utilities'

enum SubstituteExceptionTypes {
  CallCountMissMatch = 'CallCountMissMatch',
  PropertyNotMocked = 'PropertyNotMocked'
}

export class SubstituteException extends Error {
  type?: SubstituteExceptionTypes

  constructor(msg: string, exceptionType?: SubstituteExceptionTypes) {
    super(msg)
    Error.captureStackTrace(this, SubstituteException)
    this.name = new.target.name
    this.type = exceptionType
  }

  static forCallCountMissMatch(
    count: { expected: number | undefined, received: number },
    property: { type: PropertyType, value: PropertyKey },
    calls: { expected: RecordedArguments, received: RecordedArguments[] }
  ) {
    const propertyValue = textModifier.bold(property.value.toString())
    const commonMessage = `Expected ${textModifier.bold(
      count.expected === undefined ? '1 or more' : count.expected.toString()
    )} ${plurify('call', count.expected)} to the ${textModifier.italic(property.type)} ${propertyValue}`

    const messageForMethods = property.type === PropertyTypeMap.Method ? ` with ${stringifyArguments(calls.expected)}` : '' // should also apply for setters (instead of methods only)
    const receivedMessage = `, but received ${textModifier.bold(count.received < 1 ? 'none' : count.received.toString())} of such calls.`

    const callTrace = calls.received.length > 0
      ? `\nAll calls received to ${textModifier.italic(property.type)} ${propertyValue}:${stringifyCalls(calls.received)}`
      : ''

    return new this(
      commonMessage + messageForMethods + receivedMessage + callTrace,
      SubstituteExceptionTypes.CallCountMissMatch
    )
  }

  static forPropertyNotMocked(property: PropertyKey) {
    return new this(
      `There is no mock for property: ${property.toString()}`,
      SubstituteExceptionTypes.PropertyNotMocked
    )
  }

  static generic(message: string) {
    return new this(message)
  }
}