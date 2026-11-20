import { EXCEPTION, SELF, SubstituteExceptionType, keyToString } from './Constants'
import { colorsEnabled, deepestMatcher, describeOtherReading, firstStackFrame, formatArguments, formatValue, leastDifference, MAX_MESSAGE_DEPTH, MESSAGE_BOUNDS, messageBounds, plural, PrintBounds, TextBuilder, TextPart, withPrintGuard } from './utilities'
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
  /** E81: the substitute the record belongs to, when the check counts the calls of several (undefined: the subject). */
  owner?: { readonly path: string }
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
  /** E99: how the substitutes of the listed records are shown, when not by their paths (see RecordLabels). */
  recordLabels?: RecordLabels
}

/**
 * E99 (R15FE-5): how the substitutes that listed records belong to are shown (see Paths.recordPath): asked while the
 * message is built, so that the roots are numbered there when the message numbers them (E52).
 */
export type RecordLabels = {
  /** The path of the substitute that a listed record belongs to: its owner, or the substitute checked when undefined. */
  path(owner: { readonly path: string } | undefined): string
  /** The lines under the listing about those substitutes (`owners`: of the records listed, each once). */
  notes(owners: ReadonlyArray<{ readonly path: string } | undefined>): string[]
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

const NO_ARGUMENTS: readonly unknown[] = []

const printArguments = (args: readonly unknown[] | undefined, colors: boolean, bounds: PrintBounds): string =>
  formatArguments(args ?? NO_ARGUMENTS, colors, bounds)

const expectedBounds = (deeper: Deeper | undefined): PrintBounds => deeper === undefined ? MESSAGE_BOUNDS : messageBounds(deeper.depth)

const recordBounds = (record: CallRecord, deeper: Deeper | undefined): PrintBounds =>
  deeper !== undefined && deeper.records.has(record) ? messageBounds(deeper.depth) : MESSAGE_BOUNDS

const describeExpectedCall = (mismatch: CallCountMismatch, colors: boolean, deeper: Deeper | undefined): string => {
  const { key, expected } = mismatch
  const name = key === SELF ? mismatch.substitutePath : keyToString(key)
  const bounds = expectedBounds(deeper)
  switch (expected.kind) {
    case 'method': return `${name}${printArguments(expected.specification?.value ?? [], colors, bounds)}`
    case 'set': return `${name} = ${formatValue(expected.specification?.value?.[0], colors, bounds)}`
    default: return name
  }
}

const describeRecord = (record: CallRecord, colors: boolean, deeper: Deeper | undefined): string => {
  switch (record.kind) {
    case 'get': return ''
    case 'call': return (record.args === undefined ? '' : printArguments(record.args, colors, recordBounds(record, deeper))) + describeOtherReading(record, colors)
    case 'set': return ` = ${formatValue(record.args?.[0], colors, recordBounds(record, deeper))}`
  }
}

/**
 * The listed calls or assignments that do not match the expected one and can print like it. Only those that the
 * message can show: within MAX_LISTED_CALLS, and before the listed calls take MAX_LISTED_CHARACTERS characters with their
 * values MESSAGE_BOUNDS.depth levels deep (printed deeper, they take at least as many).
 */
const unmatchedOfExpectedKind = (mismatch: CallCountMismatch): CallRecord[] => {
  const { expected } = mismatch
  if (expected.kind !== 'method' && expected.kind !== 'set') return []
  const kind = expected.kind === 'method' ? 'call' : 'set'
  const records: CallRecord[] = []
  let characters = 0
  for (let index = 0; index < mismatch.listed.length && index < MAX_LISTED_CALLS && characters < MAX_LISTED_CHARACTERS; index++) {
    const { record, matches } = mismatch.listed[index]
    if (!matches && record.kind === kind) records.push(record)
    if (record.kind !== 'get') characters += printArguments(record.args ?? [], false, MESSAGE_BOUNDS).length
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
 * no line needs to be printed deeper.
 *
 * E59 (R10-ADV-1), E72, E78: a line "prints like" the expected call when it does so in what matching sees (see
 * leastDifference): a matcher of the expected call stands for the received value it was given, which it prints in place
 * of (a generated id or a callback next to a DTO that differs three levels down), and orders that matching ignores do
 * not count. E68 (R11V-3): each line that prints alike is printed at the least depth that tells it apart, as it prints
 * (cut where it is cut).
 */
const deeperLines = (mismatch: CallCountMismatch): Deeper | undefined => {
  const records = unmatchedOfExpectedKind(mismatch)
  if (records.length === 0) return undefined
  const expectedArguments = mismatch.expected.specification?.value ?? NO_ARGUMENTS
  const base = Math.min(MAX_MESSAGE_DEPTH, Math.max(MESSAGE_BOUNDS.depth, deepestMatcher(expectedArguments, MATCHER_SEARCH_DEPTH) - 1))
  let depth = base > MESSAGE_BOUNDS.depth ? base : undefined
  const alike: CallRecord[] = []
  for (const record of records) {
    const difference = leastDifference(expectedArguments, record.args ?? NO_ARGUMENTS, base, MAX_MESSAGE_DEPTH)
    if (difference === base) continue
    alike.push(record)
    if (difference <= MAX_MESSAGE_DEPTH && (depth === undefined || difference > depth)) depth = difference
  }
  if (depth === undefined) return undefined
  return { depth, records: new Set(base > MESSAGE_BOUNDS.depth ? records : alike) }
}

/**
 * E52: whether the expected call or assignment prints like one that was received (and is listed) but does not match
 * it (each printed as deep as the message prints it, see deeperLines).
 * E79 (R12-ADV-2): as deeperLines takes it, too: two lines print alike also where they differ only where the expected
 * call has a matcher (it stands for the received value there) or in an order that matching ignores (E72, E78), as
 * leastDifference finds at the depth at which they are printed, if they print differently with the roots numbered (so
 * they differ in which substitute is an argument). So a check whose only real difference is which substitute is the
 * argument numbers the substitutes also with a matcher elsewhere in the expected call, or with keys in another order.
 */
const printsAlike = (mismatch: CallCountMismatch, deeper: Deeper | undefined): boolean => {
  const expectedArguments = mismatch.expected.specification?.value ?? NO_ARGUMENTS
  const bounds = expectedBounds(deeper)
  const expectedText = printArguments(expectedArguments, false, bounds)
  const candidates: Array<readonly unknown[]> = []
  for (const record of unmatchedOfExpectedKind(mismatch)) {
    const args = record.args ?? NO_ARGUMENTS
    const lineBounds = recordBounds(record, deeper)
    if (printArguments(args, false, lineBounds) === expectedText) return true
    // (lines printed at another depth than the expected call)
    if (lineBounds.depth === bounds.depth && leastDifference(expectedArguments, args, bounds.depth, bounds.depth) === Infinity) candidates.push(args)
  }
  if (candidates.length === 0) return false
  // and they print differently with the roots numbered
  return withRootNumbers(() => candidates.some(args => leastDifference(expectedArguments, args, bounds.depth, bounds.depth) !== Infinity)).value
}

/**
 * E87 (R13FE-2): the note a message ends with when, after the deeper re-print, the expected call or assignment still
 * prints exactly like a received one that it does not match (see printedAlike). `cut`: the lines show that the message
 * leaves something out (`[Object]` deeper than it prints, `... 3 more keys`, `… (20 more characters)`, `[Getter]`), where
 * they can differ as well.
 */
export const PRINTED_ALIKE_NOTES = {
  method: 'Some calls print the same but do not match: functions and symbols match by identity, and #private fields and other internal state are not printed. Match such arguments with Arg.is(), or pass the same instance.',
  set: 'Some assignments print the same but do not match: functions and symbols match by identity, and #private fields and other internal state are not printed. Match such values with Arg.is(), or assign the same instance.',
  methodCut: 'Some calls print the same but do not match: they can differ in what the message leaves out ([Object], more keys, items or characters), functions and symbols match by identity, and #private fields and other internal state are not printed. Match such arguments with Arg.is(), or pass the same instance.',
  setCut: 'Some assignments print the same but do not match: they can differ in what the message leaves out ([Object], more keys, items or characters), functions and symbols match by identity, and #private fields and other internal state are not printed. Match such values with Arg.is(), or assign the same instance.'
}

/**
 * What a printed value or argument list shows when the message leaves something out: an object deeper than it prints
 * (`[Object]`, `[Array]`, `[Foo]`) or an accessor (`[Getter]`), and what is cut (`... 3 more keys`, `... 2 more items`,
 * `... 1 more argument`, `... 5 more characters`, `… (20 more characters)`).
 */
const LEFT_OUT = /\[[A-Za-z_$][\w$]*(: null prototype)?\]|… \(\d+ more characters\)|\.\.\. \d+ more (key|item|argument|character)s?\b/

/**
 * E87 (R13FE-2): the text (without colours) of a listed call's arguments or assignment's value, when the call or
 * assignment does not match the expected one and prints exactly like it, as the message prints them: an exact
 * comparison of their texts.
 */
const printedAlike = (mismatch: CallCountMismatch, listed: ListedCall, deeper: Deeper | undefined): string | undefined => {
  const { expected } = mismatch
  const { record } = listed
  if (listed.matches) return undefined
  let texts: [string, string] | undefined
  if (expected.kind === 'method' && record.kind === 'call')
    texts = [printArguments(record.args, false, recordBounds(record, deeper)), printArguments(expected.specification?.value ?? NO_ARGUMENTS, false, expectedBounds(deeper))]
  else if (expected.kind === 'set' && record.kind === 'set')
    texts = [formatValue(record.args?.[0], false, recordBounds(record, deeper)), formatValue(expected.specification?.value?.[0], false, expectedBounds(deeper))]
  return texts !== undefined && texts[0] === texts[1] ? texts[0] : undefined
}

/** E87: the note for lines that print alike as `text` (see PRINTED_ALIKE_NOTES). */
const printedAlikeNote = (mismatch: CallCountMismatch, text: string): string => {
  const cut = LEFT_OUT.test(text)
  return mismatch.expected.kind === 'set' ? (cut ? PRINTED_ALIKE_NOTES.setCut : PRINTED_ALIKE_NOTES.set) : (cut ? PRINTED_ALIKE_NOTES.methodCut : PRINTED_ALIKE_NOTES.method)
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
    // E54: lines that print alike are printed deeper
    const deeper = withPrintGuard(() => deeperLines(mismatch))
    let built = withPrintGuard(() => SubstituteException.buildCallCountMismatchMessage(mismatch, colors, deeper))
    let message = built.text
    // E52: the expected call prints like a received call that it does not match: number the roots, if that shows more
    // than one of them
    if (withPrintGuard(() => printsAlike(mismatch, deeper))) {
      const numbered = withRootNumbers(() => withPrintGuard(() => SubstituteException.buildCallCountMismatchMessage(mismatch, colors, deeper)))
      if (numbered.roots > 1) {
        built = numbered.value
        message = SubstituteException.withNote(built.text, 'The substitutes are numbered in this message (@Substitute#1, @Substitute#2, ...) to tell them apart.', colors)
      }
    }
    // E87 (R13FE-2): lines that still print exactly alike
    if (built.printedAlike !== undefined) message = SubstituteException.withNote(message, printedAlikeNote(mismatch, built.printedAlike), colors)
    return new this(message, EXCEPTION.callCountMismatch, stackStart)
  }

  /** A message with a note at its end, on a line of its own. */
  private static withNote(message: string, note: string, colors: boolean): string {
    return message + (message.endsWith('\n') ? '' : '\n') + new TextBuilder().add(note, t => t.faint()).newLine().toString(colors)
  }

  /**
   * The message, and (E87) whether a listed call or assignment that does not match the expected one prints exactly like
   * it.
   */
  private static buildCallCountMismatchMessage(
    mismatch: CallCountMismatch, colors: boolean, deeper: Deeper | undefined
  ): { text: string, printedAlike: string | undefined } {
    const { expected, key } = mismatch
    const substitutePath = mismatch.subject?.path ?? mismatch.substitutePath
    const memberPath = key === SELF ? substitutePath : `${substitutePath}.${keyToString(key)}`

    /** E87: the text of the listed lines that print exactly like the expected one without matching it (they all print so). */
    let alike: string | undefined
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
      .add(describeExpectedCall(mismatch, colors, deeper), t => t.bold())
      .add(', but received ')
      .add(mismatch.receivedText, t => t.faint())
      .add('.')
    if (mismatch.explanation !== undefined) textBuilder.add(` ${mismatch.explanation}`)

    /** E99: the lines under the listing (see RecordLabels). */
    let notes: string[] = []
    if (mismatch.listed.length > 0) {
      // an assignment assertion lists only the assignments, the others list reads and calls
      const heading = expected.kind === 'set' ? 'All property assignments to' : 'All property or method calls to'
      textBuilder.newLine().add(`${heading} ${memberPath} received so far:`)
      const shown = mismatch.listed.length > MAX_LISTED_CALLS ? mismatch.listed.slice(0, MAX_LISTED_CALLS) : mismatch.listed
      let listedCount = 0
      let listedCharacters = 0
      // E99: the paths of the substitutes that the records shown belong to, each built once
      const labels = mismatch.recordLabels
      const recordPaths = new Map<{ readonly path: string } | undefined, string>()
      const labelOf = (owner: { readonly path: string } | undefined): string => {
        let label = recordPaths.get(owner)
        if (label === undefined) {
          const path = labels!.path(owner)
          label = key === SELF ? path : `${path}.${keyToString(key)}`
          recordPaths.set(owner, label)
        }
        return label
      }
      for (const listed of shown) {
        if (listedCharacters >= MAX_LISTED_CHARACTERS) break
        const style = (part: TextPart) => listed.matches ? part.faint() : part.bold()
        const call = describeRecord(listed.record, colors, deeper)
        // E81: a record of one of several substitutes is shown with that substitute's own path
        const recordPath = labels !== undefined ? labelOf(listed.owner)
          : listed.owner === undefined ? memberPath : key === SELF ? listed.owner.path : `${listed.owner.path}.${keyToString(key)}`
        if (alike === undefined) alike = printedAlike(mismatch, listed, deeper)
        textBuilder.newLine().add('› ')
          .add(listed.matches ? '✔ ' : '✘ ', style)
          .add(listed.record.constructed === true ? `new ${recordPath}` : recordPath, style)
          .add(call, style)
        const frame = firstStackFrame(listed.record.stack)
        if (frame !== undefined) textBuilder.newLine().add(frame.replace('at ', 'called at '), t => t.faint())
        if (listed.predicateThrew)
          textBuilder.newLine().add(`    (an Arg.is predicate threw while matching this call: ${describeError(listed.predicateError)})`, t => t.faint())
        listedCount++
        listedCharacters += recordPath.length + call.length + (frame === undefined ? 0 : frame.length)
      }
      const hidden = mismatch.listed.length - listedCount
      if (hidden > 0) textBuilder.newLine().add(`› … and ${hidden} more`, t => t.faint())
      textBuilder.newLine()
      if (labels !== undefined) notes = labels.notes([...recordPaths.keys()])
    }

    const hints = notes.length > 0 ? [...notes, ...mismatch.hints ?? []] : mismatch.hints ?? []
    if (hints.length > 0) {
      if (mismatch.listed.length === 0) textBuilder.newLine()
      for (const hint of hints) textBuilder.add(hint).newLine()
    }

    return { text: textBuilder.toString(colors), printedAlike: alike }
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
