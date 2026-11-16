import { inspect } from 'util'

import { EXCEPTION, SELF, SubstituteExceptionType, keyToString } from './Constants'
import { colorsEnabled, firstStackFrame, formatArguments, formatValue, plural, TextBuilder, TextPart, withPrintGuard } from './utilities'
import type { CallRecord } from './CallRecord'
import type { RecordedArguments } from './RecordedArguments'

export type ExpectedKind = 'method' | 'property' | 'set' | 'unknown'

export type CallCountExpectation = {
  /** undefined means "1 or more" */
  count: number | undefined
  kind: ExpectedKind
  /** The expected arguments (for 'method') or the expected value as a one-element list (for 'set'). */
  specification?: RecordedArguments
}

export type ListedCall = {
  record: CallRecord
  matches: boolean
  predicateThrew?: boolean
  predicateError?: unknown
}

export type CallCountMismatch = {
  /** Path of the substitute, e.g. `@Substitute` or `@Substitute.logger`. */
  substitutePath: string
  key: PropertyKey
  expected: CallCountExpectation
  /** How many matching calls were received, already phrased (e.g. 'none', '4', '2 property reads and 1 method call'). */
  receivedText: string
  /** Continues the expectation line, e.g. to explain what was received instead. */
  explanation?: string
  listed: ListedCall[]
  /** Lines after the listing that explain a likely mistake. */
  hints?: string[]
}

const kindPhrase = (kind: ExpectedKind, count: number | undefined): string => {
  switch (kind) {
    case 'method': return plural('method call', count)
    case 'property': return plural('property read', count)
    case 'set': return plural('property assignment', count)
    case 'unknown': return `${plural('property read', count)} or ${plural('method call', count)}`
  }
}

const memberLabel = (key: PropertyKey): string => key === SELF ? '' : keyToString(key)

/** D23: a failure message lists at most this many received calls, then "› … and N more". */
export const MAX_LISTED_CALLS = 50

const describeExpectedCall = (mismatch: CallCountMismatch, colors: boolean): string => {
  const { key, expected } = mismatch
  const name = key === SELF ? mismatch.substitutePath : keyToString(key)
  switch (expected.kind) {
    case 'method': return `${name}${formatArguments(expected.specification?.value ?? [], colors)}`
    case 'set': return `${name} = ${formatValue(expected.specification?.value?.[0], colors)}`
    default: return name
  }
}

const describeRecord = (record: CallRecord, colors: boolean): string => {
  switch (record.kind) {
    case 'get': return ''
    case 'call': return formatArguments(record.args, colors)
    case 'set': return ` = ${formatValue(record.args?.[0], colors)}`
  }
}

const describeError = (error: unknown): string => {
  try {
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return inspect(error, { depth: 1, colors: false })
  } catch {
    return String(typeof error)
  }
}

export class SubstituteException extends Error {
  public type?: SubstituteExceptionType

  constructor(msg: string, exceptionType?: SubstituteExceptionType, stackStart?: Function) {
    super(msg)
    this.name = new.target.name
    this.type = exceptionType
    if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, stackStart ?? new.target)
  }

  public static forCallCountMismatch(mismatch: CallCountMismatch, stackStart?: Function): SubstituteException {
    const colors = colorsEnabled()
    const message = withPrintGuard(() => SubstituteException.buildCallCountMismatchMessage(mismatch, colors))
    return new this(message, EXCEPTION.callCountMismatch, stackStart)
  }

  private static buildCallCountMismatchMessage(mismatch: CallCountMismatch, colors: boolean): string {
    const { expected, key, substitutePath } = mismatch
    const memberPath = key === SELF ? substitutePath : `${substitutePath}.${keyToString(key)}`

    const textBuilder = new TextBuilder()
      .add('Call count mismatch in ')
    if (key === SELF) textBuilder.add(substitutePath, t => t.bold().underline())
    else textBuilder
      .add(`${substitutePath}.`, t => t.underline())
      .add(memberLabel(key), t => t.bold().underline())
    textBuilder
      .add(':')
      .newLine().add('Expected to receive ')
      .add(expected.count === undefined ? '1 or more' : expected.count.toString(), t => t.bold())
      .add(' ')
      .add(kindPhrase(expected.kind, expected.count), t => t.bold())
      .add(' matching ')
      .add(describeExpectedCall(mismatch, colors), t => t.bold())
      .add(', but received ')
      .add(mismatch.receivedText, t => t.faint())
      .add('.')
    if (mismatch.explanation !== undefined) textBuilder.add(` ${mismatch.explanation}`)

    if (mismatch.listed.length > 0) {
      textBuilder.newLine().add(`All property or method calls to ${memberPath} received so far:`)
      const shown = mismatch.listed.length > MAX_LISTED_CALLS ? mismatch.listed.slice(0, MAX_LISTED_CALLS) : mismatch.listed
      for (const listed of shown) {
        const style = (part: TextPart) => listed.matches ? part.faint() : part.bold()
        textBuilder.newLine().add('› ')
          .add(listed.matches ? '✔ ' : '✘ ', style)
          .add(memberPath, style)
          .add(describeRecord(listed.record, colors), style)
        const frame = firstStackFrame(listed.record.stack)
        if (frame !== undefined) textBuilder.newLine().add(frame.replace('at ', 'called at '), t => t.faint())
        if (listed.predicateThrew)
          textBuilder.newLine().add(`    (an Arg.is predicate threw while matching this call: ${describeError(listed.predicateError)})`, t => t.faint())
      }
      const hidden = mismatch.listed.length - shown.length
      if (hidden > 0) textBuilder.newLine().add(`› … and ${hidden} more`, t => t.faint())
      textBuilder.newLine()
    }

    const hints = mismatch.hints ?? []
    if (hints.length > 0) {
      if (mismatch.listed.length === 0) textBuilder.newLine()
      for (const hint of hints) textBuilder.add(hint).newLine()
    }

    return textBuilder.toString(colors)
  }

  public static forPropertyNotMocked(property: PropertyKey) {
    return new this(
      `There is no mock for property: ${property.toString()}`,
      EXCEPTION.propertyNotMocked
    )
  }

  public static generic(message: string, stackStart?: Function) {
    return new this(message, undefined, stackStart)
  }
}
