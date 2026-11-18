import { EXCEPTION, SELF, SubstituteExceptionType, keyToString } from './Constants'
import { colorsEnabled, deepestMatcher, describeOtherReading, firstStackFrame, formatArguments, formatValue, MAX_MESSAGE_DEPTH, MESSAGE_BOUNDS, messageBounds, plural, PrintBounds, TextBuilder, TextPart, withPrintGuard } from './utilities'
import type { CallRecord } from './CallRecord'
import type { RecordedArguments } from './RecordedArguments'
import { withRootNumbers } from './Paths'

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
  /** E52: the substitute itself, whose path is shown with the roots numbered when that tells calls apart. */
  subject?: { readonly path: string }
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
/**
 * E44: and it stops listing them once the listed calls take this many characters (each value in them is bounded, see
 * Stringify), so that a message stays readable, whatever the size of the arguments.
 */
export const MAX_LISTED_CHARACTERS = 20000

/**
 * E54: the expected call and the received calls that print alike with values MESSAGE_BOUNDS.depth levels deep, printed
 * `depth` levels deep instead (see deeperLines).
 */
type Deeper = { readonly depth: number, readonly records: ReadonlySet<CallRecord> }

/**
 * Prints a value of a message within bounds. E54: a message compares and prints the same values more than once (see
 * deeperLines, printsAlike), so without colours each object is printed once per depth in a message.
 */
type Printer = (value: unknown, bounds: PrintBounds) => string

const printerFor = (colors: boolean): Printer => {
  if (colors) return (value, bounds) => formatValue(value, true, bounds)
  const texts = new Map<PrintBounds, Map<unknown, string>>()
  return (value, bounds) => {
    if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) return formatValue(value, false, bounds)
    let known = texts.get(bounds)
    if (known === undefined) texts.set(bounds, known = new Map())
    let text = known.get(value)
    if (text === undefined) known.set(value, text = formatValue(value, false, bounds))
    return text
  }
}

const printArguments = (args: readonly unknown[] | undefined, print: Printer, bounds: PrintBounds): string =>
  formatArguments(args, false, bounds, value => print(value, bounds))

const expectedBounds = (deeper: Deeper | undefined): PrintBounds => deeper === undefined ? MESSAGE_BOUNDS : messageBounds(deeper.depth)

const recordBounds = (record: CallRecord, deeper: Deeper | undefined): PrintBounds =>
  deeper !== undefined && deeper.records.has(record) ? messageBounds(deeper.depth) : MESSAGE_BOUNDS

const describeExpectedCall = (mismatch: CallCountMismatch, print: Printer, deeper: Deeper | undefined): string => {
  const { key, expected } = mismatch
  const name = key === SELF ? mismatch.substitutePath : keyToString(key)
  const bounds = expectedBounds(deeper)
  switch (expected.kind) {
    case 'method': return `${name}${printArguments(expected.specification?.value ?? [], print, bounds)}`
    case 'set': return `${name} = ${print(expected.specification?.value?.[0], bounds)}`
    default: return name
  }
}

const describeRecord = (record: CallRecord, print: Printer, colors: boolean, deeper: Deeper | undefined): string => {
  switch (record.kind) {
    case 'get': return ''
    case 'call': return printArguments(record.args, print, recordBounds(record, deeper)) + describeOtherReading(record, colors)
    case 'set': return ` = ${print(record.args?.[0], recordBounds(record, deeper))}`
  }
}

/**
 * The listed calls or assignments that do not match the expected one and can print like it. Only those that the
 * message can show: within MAX_LISTED_CALLS, and before the listed calls take MAX_LISTED_CHARACTERS characters with their
 * values MESSAGE_BOUNDS.depth levels deep (printed deeper, they take at least as many).
 */
const unmatchedOfExpectedKind = (mismatch: CallCountMismatch, print: Printer): CallRecord[] => {
  const { expected } = mismatch
  if (expected.kind !== 'method' && expected.kind !== 'set') return []
  const kind = expected.kind === 'method' ? 'call' : 'set'
  const records: CallRecord[] = []
  let characters = 0
  for (let index = 0; index < mismatch.listed.length && index < MAX_LISTED_CALLS && characters < MAX_LISTED_CHARACTERS; index++) {
    const { record, matches } = mismatch.listed[index]
    if (!matches && record.kind === kind) records.push(record)
    if (record.kind !== 'get') characters += printArguments(record.args ?? [], print, MESSAGE_BOUNDS).length
  }
  return records
}

/** E54: how deep the expected arguments are searched for matchers (the D27 search goes as deep). */
const MATCHER_SEARCH_DEPTH = 32

/**
 * E54 (R9-ADV-1): values are printed MESSAGE_BOUNDS.depth levels deep. When the expected call prints like received
 * calls that it does not match (they differ deeper down), those lines are printed deeper, at the least depth up to
 * MAX_MESSAGE_DEPTH at which all of them that differ at all by then print differently from the expected call, so that
 * the message shows where they differ. When the expected call holds a matcher deeper than that (shown in any case, see
 * Stringify), the received calls it does not match are printed as deep as the container that the matcher is in (up to
 * MAX_MESSAGE_DEPTH), so that they show the values the matcher was given, and so is the expected call. Undefined when
 * no line needs to be printed deeper. `print`: without colours.
 */
const deeperLines = (mismatch: CallCountMismatch, print: Printer): Deeper | undefined => {
  const records = unmatchedOfExpectedKind(mismatch, print)
  if (records.length === 0) return undefined
  const expectedArguments = mismatch.expected.specification?.value ?? []
  const textAt = (args: readonly unknown[], depth: number) => printArguments(args, print, messageBounds(depth))
  const base = Math.min(MAX_MESSAGE_DEPTH, Math.max(MESSAGE_BOUNDS.depth, deepestMatcher(expectedArguments, MATCHER_SEARCH_DEPTH) - 1))
  const expectedText = textAt(expectedArguments, base)
  let alike = records.filter(record => textAt(record.args ?? [], base) === expectedText)
  let depth = base > MESSAGE_BOUNDS.depth ? base : undefined
  const deepened = new Set(depth === undefined ? alike : records)
  for (let candidate = base + 1; candidate <= MAX_MESSAGE_DEPTH && alike.length > 0; candidate++) {
    const expectedDeeper = textAt(expectedArguments, candidate)
    const still = alike.filter(record => textAt(record.args ?? [], candidate) === expectedDeeper)
    if (still.length < alike.length) depth = candidate
    alike = still
  }
  return depth === undefined ? undefined : { depth, records: deepened }
}

/**
 * E52: whether the expected call or assignment prints like one that was received (and is listed) but does not match
 * it (each printed as deep as the message prints it, see deeperLines). `print`: without colours.
 */
const printsAlike = (mismatch: CallCountMismatch, print: Printer, deeper: Deeper | undefined): boolean => {
  const expectedText = printArguments(mismatch.expected.specification?.value ?? [], print, expectedBounds(deeper))
  return unmatchedOfExpectedKind(mismatch, print).some(record => printArguments(record.args ?? [], print, recordBounds(record, deeper)) === expectedText)
}

const describeError = (error: unknown): string => {
  try {
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return formatValue(error, false)
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
    const plain = printerFor(false)
    // E54: lines that print alike are printed deeper
    const deeper = withPrintGuard(() => deeperLines(mismatch, plain))
    let message = withPrintGuard(() => SubstituteException.buildCallCountMismatchMessage(mismatch, colors, colors ? printerFor(true) : plain, deeper))
    // E52: the expected call prints like a received call that it does not match: number the roots, if that shows more
    // than one of them
    if (withPrintGuard(() => printsAlike(mismatch, plain, deeper))) {
      const numbered = withRootNumbers(() => withPrintGuard(() => SubstituteException.buildCallCountMismatchMessage(mismatch, colors, printerFor(colors), deeper)))
      if (numbered.roots > 1) message = numbered.value + (numbered.value.endsWith('\n') ? '' : '\n') + new TextBuilder()
        .add('The substitutes are numbered in this message (@Substitute#1, @Substitute#2, ...) to tell them apart.', t => t.faint())
        .newLine()
        .toString(colors)
    }
    return new this(message, EXCEPTION.callCountMismatch, stackStart)
  }

  private static buildCallCountMismatchMessage(mismatch: CallCountMismatch, colors: boolean, print: Printer, deeper: Deeper | undefined): string {
    const { expected, key } = mismatch
    const substitutePath = mismatch.subject?.path ?? mismatch.substitutePath
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
      .add(describeExpectedCall(mismatch, print, deeper), t => t.bold())
      .add(', but received ')
      .add(mismatch.receivedText, t => t.faint())
      .add('.')
    if (mismatch.explanation !== undefined) textBuilder.add(` ${mismatch.explanation}`)

    if (mismatch.listed.length > 0) {
      // an assignment assertion lists only the assignments, the others list reads and calls
      const heading = expected.kind === 'set' ? 'All property assignments to' : 'All property or method calls to'
      textBuilder.newLine().add(`${heading} ${memberPath} received so far:`)
      const shown = mismatch.listed.length > MAX_LISTED_CALLS ? mismatch.listed.slice(0, MAX_LISTED_CALLS) : mismatch.listed
      let listedCount = 0
      let listedCharacters = 0
      for (const listed of shown) {
        if (listedCharacters >= MAX_LISTED_CHARACTERS) break
        const style = (part: TextPart) => listed.matches ? part.faint() : part.bold()
        const call = describeRecord(listed.record, print, colors, deeper)
        textBuilder.newLine().add('› ')
          .add(listed.matches ? '✔ ' : '✘ ', style)
          .add(listed.record.constructed === true ? `new ${memberPath}` : memberPath, style)
          .add(call, style)
        const frame = firstStackFrame(listed.record.stack)
        if (frame !== undefined) textBuilder.newLine().add(frame.replace('at ', 'called at '), t => t.faint())
        if (listed.predicateThrew)
          textBuilder.newLine().add(`    (an Arg.is predicate threw while matching this call: ${describeError(listed.predicateError)})`, t => t.faint())
        listedCount++
        listedCharacters += memberPath.length + call.length + (frame === undefined ? 0 : frame.length)
      }
      const hidden = mismatch.listed.length - listedCount
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
