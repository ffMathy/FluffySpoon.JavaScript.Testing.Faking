import { SubstituteNodeModel } from './Types'
import { stringifyReceivedCalls, TextBuilder, stringifyExpectation } from './Utilities'

const SubstituteExceptionType = {
  callCountMismatch: 'CallCountMismatch',
  PropertyNotMocked: 'PropertyNotMocked'
} as const
type SubstituteExceptionType = typeof SubstituteExceptionType[keyof typeof SubstituteExceptionType]

export class SubstituteException extends Error {
  type?: SubstituteExceptionType

  constructor(msg: string, exceptionType?: SubstituteExceptionType) {
    super(msg)
    this.name = new.target.name
    this.type = exceptionType
    const errorConstructor = exceptionType !== undefined ? SubstituteException[`for${exceptionType}`] : undefined
    Error.captureStackTrace(this, errorConstructor)
  }

  static forCallCountMismatch(
    expected: { count: number | undefined, call: SubstituteNodeModel },
    received: { matchCount: number, calls: SubstituteNodeModel[] }
  ) {
    const callPath = `@Substitute.${expected.call.key.toString()}`

    const textBuilder = new TextBuilder()
      .add('Call count mismatch in ')
      .add('@Substitute.', t => t.underline())
      .add(expected.call.key.toString(), t => t.bold().underline())
      .add(':')
      .newLine().add('Expected to receive ')
      .addParts(...stringifyExpectation(expected))
      .add(', but received ')
      .add(received.matchCount < 1 ? 'none' : received.matchCount.toString(), t => t.faint())
      .add('.')
    if (received.calls.length > 0) textBuilder.newLine().add(`All property or method calls to ${callPath} received so far:${stringifyReceivedCalls(callPath, expected.call, received.calls)}`)

    return new this(textBuilder.toString(), SubstituteExceptionType.callCountMismatch)
  }

  static forPropertyNotMocked(property: PropertyKey) {
    return new this(
      `There is no mock for property: ${property.toString()}`,
      SubstituteExceptionType.PropertyNotMocked
    )
  }

  static generic(message: string) {
    return new this(message)
  }
}