import { SubstituteNodeModel, SubstituteExceptionType } from './Types'
import { stringify, TextBuilder, constants } from './utilities'

export class SubstituteException extends Error {
  public type?: SubstituteExceptionType

  constructor(msg: string, exceptionType?: SubstituteExceptionType) {
    super(msg)
    this.name = new.target.name
    this.type = exceptionType
    const errorConstructor = exceptionType !== undefined ? SubstituteException[`for${exceptionType}`] : undefined
    Error.captureStackTrace(this, errorConstructor)
  }

  public static forCallCountMismatch(
    expected: { count: number | undefined, call: SubstituteNodeModel },
    received: { matchCount: number, calls: SubstituteNodeModel[] }
  ) {
    const callPath = `@Substitute.${expected.call.property.toString()}`

    const textBuilder = new TextBuilder()
      .add('Call count mismatch in ')
      .add('@Substitute.', t => t.underline())
      .add(expected.call.property.toString(), t => t.bold().underline())
      .add(':')
      .newLine().add('Expected to receive ')
      .addParts(...stringify.expectation(expected))
      .add(', but received ')
      .add(received.matchCount < 1 ? 'none' : received.matchCount.toString(), t => t.faint())
      .add('.')
    if (received.calls.length > 0) textBuilder.newLine().add(`All property or method calls to ${callPath} received so far:${stringify.receivedCalls(callPath, expected.call, received.calls)}`)

    return new this(textBuilder.toString(), constants.EXCEPTION.callCountMismatch)
  }

  public static forPropertyNotMocked(property: PropertyKey) {
    return new this(
      `There is no mock for property: ${property.toString()}`,
      constants.EXCEPTION.propertyNotMocked
    )
  }

  public static generic(message: string) {
    return new this(message)
  }
}