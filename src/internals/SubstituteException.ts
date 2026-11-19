import { EXCEPTION, SELF, SubstituteExceptionType, keyToString } from './Constants'
import { colorsEnabled, deepestMatcher, describeOtherReading, DIFFERENCE_ENTRIES, DifferenceSearch, firstStackFrame, firstVisibleDifference, formatArguments, formatValue, MAX_MESSAGE_DEPTH, MESSAGE_BOUNDS, messageBounds, plural, PrintBounds, TextBuilder, TextPart, withPrintGuard } from './utilities'
import type { CallRecord } from './CallRecord'
import type { RecordedArguments } from './RecordedArguments'
import { rootLabelCount, withRootNumbers } from './Paths'

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

/** A printed value or argument list. `unnumbered`: it shows no substitute, so it prints the same with the roots numbered. */
type Printed = { readonly text: string, readonly unnumbered: boolean }

/**
 * Prints the values and argument lists of one message within bounds. E54: a message compares and prints the same values
 * more than once (see deeperLines, printsAlike), so each value and each argument list is printed once per depth.
 * E60 (R10V-1): when the message is built again with the roots numbered (E52), the printer of that build takes over
 * the texts of `reuse` (a printer with the same colours) that show no substitute: only the others are printed again.
 */
class Printer {
  private readonly values = new Map<PrintBounds, Map<unknown, Printed>>()
  private readonly lists = new Map<PrintBounds, Map<readonly unknown[], Printed>>()
  /**
   * How many of the texts this printer gave out show a substitute: an argument list that takes the text of such a value
   * from the cache shows one, too.
   */
  private numbered = 0

  /**
   * E73 (R11-ADV-6): the own enumerable keys of the objects printed and compared for the message (see
   * DifferenceSearch.keys), shared by its printers, so that each object is listed once per message.
   */
  readonly keys: Map<object, PropertyKey[]>

  constructor(private readonly colors: boolean, private readonly reuse?: Printer, keys?: Map<object, PropertyKey[]>) {
    this.keys = keys ?? reuse?.keys ?? new Map()
  }

  value(value: unknown, bounds: PrintBounds): string {
    // -0 and 0 are one key of a Map: primitives are printed every time (cheaply)
    if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) return formatValue(value, this.colors, bounds)
    const known = Printer.known(this.values, bounds)
    let printed = known.get(value)
    if (printed === undefined) {
      printed = this.reused(this.reuse?.values, bounds, value)
      if (printed === undefined) {
        const before = rootLabelCount() + this.numbered
        const text = formatValue(value, this.colors, bounds, this.keys)
        printed = { text, unnumbered: rootLabelCount() + this.numbered === before }
      }
      known.set(value, printed)
    }
    if (!printed.unnumbered) this.numbered++
    return printed.text
  }

  /** E79: whether the text of an argument list printed with `bounds` shows a substitute (see value). */
  showsSubstitute(args: readonly unknown[], bounds: PrintBounds): boolean {
    this.arguments(args, bounds)
    return Printer.known(this.lists, bounds).get(args)?.unnumbered === false
  }

  arguments(args: readonly unknown[], bounds: PrintBounds): string {
    const known = Printer.known(this.lists, bounds)
    let printed = known.get(args)
    if (printed === undefined) {
      printed = this.reused(this.reuse?.lists, bounds, args)
      if (printed === undefined) {
        // (the texts of values that it takes from the cache count, too)
        const before = rootLabelCount() + this.numbered
        const text = formatArguments(args, this.colors, bounds, value => this.value(value, bounds))
        printed = { text, unnumbered: rootLabelCount() + this.numbered === before }
      }
      known.set(args, printed)
    }
    if (!printed.unnumbered) this.numbered++
    return printed.text
  }

  private static known<K>(cache: Map<PrintBounds, Map<K, Printed>>, bounds: PrintBounds): Map<K, Printed> {
    let known = cache.get(bounds)
    if (known === undefined) cache.set(bounds, known = new Map())
    return known
  }

  /** A text of `reuse` that shows no substitute (see above). */
  private reused<K>(reusable: Map<PrintBounds, Map<K, Printed>> | undefined, bounds: PrintBounds, key: K): Printed | undefined {
    if (reusable === undefined) return undefined
    const printed = reusable.get(bounds)?.get(key)
    return printed !== undefined && printed.unnumbered ? printed : undefined
  }
}

const NO_ARGUMENTS: readonly unknown[] = []

const printArguments = (args: readonly unknown[] | undefined, print: Printer, bounds: PrintBounds): string =>
  print.arguments(args ?? NO_ARGUMENTS, bounds)

const expectedBounds = (deeper: Deeper | undefined): PrintBounds => deeper === undefined ? MESSAGE_BOUNDS : messageBounds(deeper.depth)

const recordBounds = (record: CallRecord, deeper: Deeper | undefined): PrintBounds =>
  deeper !== undefined && deeper.records.has(record) ? messageBounds(deeper.depth) : MESSAGE_BOUNDS

const describeExpectedCall = (mismatch: CallCountMismatch, print: Printer, deeper: Deeper | undefined): string => {
  const { key, expected } = mismatch
  const name = key === SELF ? mismatch.substitutePath : keyToString(key)
  const bounds = expectedBounds(deeper)
  switch (expected.kind) {
    case 'method': return `${name}${printArguments(expected.specification?.value ?? [], print, bounds)}`
    case 'set': return `${name} = ${print.value(expected.specification?.value?.[0], bounds)}`
    default: return name
  }
}

const describeRecord = (record: CallRecord, print: Printer, colors: boolean, deeper: Deeper | undefined): string => {
  switch (record.kind) {
    case 'get': return ''
    case 'call': return (record.args === undefined ? '' : printArguments(record.args, print, recordBounds(record, deeper))) + describeOtherReading(record, colors)
    case 'set': return ` = ${print.value(record.args?.[0], recordBounds(record, deeper))}`
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
 *
 * E59 (R10-ADV-1): a line "prints like" the expected call when it does so with the matchers of the expected call left
 * out: a matcher prints by its label where the received value stands, so that alone does not tell them apart (a
 * generated id or a callback next to a DTO that differs three levels down).
 * E60 (R10V-1): firstVisibleDifference finds the least depth at which a line can print differently, from the values
 * themselves, so that lines are printed deeper only from that depth on, and only until they print differently (each
 * value's text is printed once per depth, see Printer). Lines that print alike up to MAX_MESSAGE_DEPTH are not printed
 * deeper at all. All the lines that print alike are printed as deep as the deepest of them needs, so a line is only
 * looked at further when it could need more than that, and the comparisons of one message look at no more than
 * DIFFERENCE_ENTRIES entries in all: the lines after that are printed as deep as the ones before (E70: with or without
 * matchers in the expected call). Without matchers in the expected call, the printed lines decide too: a line that
 * prints differently at `base` stays as it is (unless it does so only in the order of its keys, E72, which is looked at
 * last), and the depth at which a line prints differently is checked on the printed lines (which the message prints
 * anyway).
 * E68 (R11V-3): where the comparison sees a difference that the printed lines do not show (beyond the characters a value
 * is cut after), the depths are tried from the one the message is printed at so far on, so that the message is
 * printed at the least depth that tells its lines apart.
 */
const deeperLines = (mismatch: CallCountMismatch, print: Printer): Deeper | undefined => {
  const records = unmatchedOfExpectedKind(mismatch, print)
  if (records.length === 0) return undefined
  const expectedArguments = mismatch.expected.specification?.value ?? NO_ARGUMENTS
  const textAt = (args: readonly unknown[], depth: number) => printArguments(args, print, messageBounds(depth))
  /** The least depth from `from` on, up to MAX_MESSAGE_DEPTH, at which a line prints differently from the expected call. */
  const printsDifferentlyFrom = (args: readonly unknown[], from: number): number | undefined => {
    for (let candidate = from; candidate <= MAX_MESSAGE_DEPTH; candidate++)
      if (textAt(args, candidate) !== textAt(expectedArguments, candidate)) return candidate
    return undefined
  }
  const matcherLevel = deepestMatcher(expectedArguments, MATCHER_SEARCH_DEPTH)
  const base = Math.min(MAX_MESSAGE_DEPTH, Math.max(MESSAGE_BOUNDS.depth, matcherLevel - 1))
  const expectedText = matcherLevel < 0 ? textAt(expectedArguments, base) : undefined
  const search: DifferenceSearch = {
    bounds: MESSAGE_BOUNDS,
    maxDepth: MAX_MESSAGE_DEPTH,
    textOf: (value, depth) => print.value(value, messageBounds(depth)),
    keys: print.keys,
    entries: DIFFERENCE_ENTRIES
  }
  let depth = base > MESSAGE_BOUNDS.depth ? base : undefined
  const alike: CallRecord[] = []
  /** E72: the lines that print differently at `base` without matchers in the expected call (looked at last, see below). */
  const differing: CallRecord[] = []
  for (const record of records) {
    const args = record.args ?? NO_ARGUMENTS
    if (expectedText !== undefined && textAt(args, base) !== expectedText) {
      differing.push(record)
      continue
    }
    // whether the line prints differently at `floor` (with matchers in the expected call: first whether at `base`):
    // only a difference deeper than `floor` makes the message print the lines deeper
    const floor = depth ?? base
    const difference = search.entries > 0 ? firstVisibleDifference(search, expectedArguments, args, floor, expectedText === undefined ? base : floor) : undefined
    // the budget ran out during this line: the line can print differently at a lesser depth than the one found
    const partial = difference !== undefined && search.complete === false
    // the depth at which the line prints differently from the expected call, if that makes the message print deeper
    let shows: number | undefined
    if (expectedText === undefined) {
      // matchers in the expected call: the comparison decides (E59)
      if (difference !== undefined) {
        if (difference <= base) continue
        if (difference > floor && difference <= MAX_MESSAGE_DEPTH) shows = difference
      }
    } else if (difference !== undefined && (difference <= base || partial)) {
      // a difference that does not show (see E68 above), or a comparison cut short: the printed lines decide
      if (difference <= base || (difference > floor && difference <= MAX_MESSAGE_DEPTH)) shows = printsDifferentlyFrom(args, Math.max(floor, base + 1))
    } else if (difference !== undefined && difference > floor && difference <= MAX_MESSAGE_DEPTH) {
      shows = printsDifferentlyFrom(args, difference)
    }
    alike.push(record)
    if (shows !== undefined) depth = shows
  }
  // E72 (R11-ADV-4): a line that prints differently at `base` only in the order of its keys (which matching does not
  // see) prints like the expected call to the comparison, and is printed as deep as a difference further down needs.
  // These lines are compared with what is left of the budget, after the lines that print alike.
  for (const record of differing) {
    if (search.entries <= 0) break
    const args = record.args ?? NO_ARGUMENTS
    const floor = depth ?? base
    const difference = firstVisibleDifference(search, expectedArguments, args, floor, base)
    if (difference <= base || search.complete === false) continue
    alike.push(record)
    if (difference > floor && difference <= MAX_MESSAGE_DEPTH) {
      const shows = printsDifferentlyFrom(args, difference)
      if (shows !== undefined) depth = shows
    }
  }
  if (depth === undefined) return undefined
  return { depth, records: new Set(base > MESSAGE_BOUNDS.depth ? records : alike) }
}

/**
 * E52: whether the expected call or assignment prints like one that was received (and is listed) but does not match
 * it (each printed as deep as the message prints it, see deeperLines). `print`: without colours.
 * E79 (R12-ADV-2): as deeperLines takes it, too: two lines that show substitutes print alike also where they differ
 * only where the expected call has a matcher (it stands for the received value there) or in an order that matching
 * ignores (E72, E78), as firstVisibleDifference finds up to the depth at which they are printed, if they print
 * differently with the roots numbered (so they differ in which substitute is an argument). So a check whose only real
 * difference is which substitute is the argument numbers the substitutes also with a matcher elsewhere in the expected
 * call, or with keys in another order.
 */
const printsAlike = (mismatch: CallCountMismatch, print: Printer, deeper: Deeper | undefined): boolean => {
  const expectedArguments = mismatch.expected.specification?.value ?? NO_ARGUMENTS
  const bounds = expectedBounds(deeper)
  const expectedText = printArguments(expectedArguments, print, bounds)
  /** Compares the lines with the texts of `printer`, up to the depth at which they are printed (one budget for all). */
  const comparer = (printer: Printer) => {
    const search: DifferenceSearch = {
      bounds: MESSAGE_BOUNDS,
      maxDepth: bounds.depth,
      textOf: (value, depth) => printer.value(value, messageBounds(depth)),
      keys: print.keys,
      entries: DIFFERENCE_ENTRIES
    }
    /** Whether they print alike; undefined when the comparison could not tell (the budget is spent). */
    return (args: readonly unknown[]): boolean | undefined => {
      if (search.entries <= 0) return undefined
      const difference = firstVisibleDifference(search, expectedArguments, args, bounds.depth)
      return search.complete === true ? difference > bounds.depth : undefined
    }
  }
  let alike: ((args: readonly unknown[]) => boolean | undefined) | undefined
  const candidates: Array<readonly unknown[]> = []
  for (const record of unmatchedOfExpectedKind(mismatch, print)) {
    const args = record.args ?? NO_ARGUMENTS
    const lineBounds = recordBounds(record, deeper)
    if (printArguments(args, print, lineBounds) === expectedText) return true
    // (lines printed at different depths, or that show no substitute on either side, which numbering cannot tell apart)
    if (lineBounds !== bounds || !print.showsSubstitute(expectedArguments, bounds) || !print.showsSubstitute(args, lineBounds)) continue
    alike ??= comparer(print)
    if (alike(args) === true) candidates.push(args)
  }
  if (candidates.length === 0) return false
  // and they print differently with the roots numbered
  return withRootNumbers(() => {
    const numbered = comparer(new Printer(false, undefined, print.keys))
    return candidates.some(args => numbered(args) === false)
  }).value
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
const LEFT_OUT = /\[[A-Za-z_$][\w$]*(: null prototype)?\]|… \((\d+ )?more characters\)|\.\.\. \d+ more (key|item|argument|character)s?\b/

const withoutColors = (text: string): string => text.replace(/\x1b\[\d+m/g, '')

/**
 * E87 (R13FE-2): the text (without colours) of a listed call's arguments or assignment's value, when the call or
 * assignment does not match the expected one and prints exactly like it, as the message prints them (`print` has
 * printed both: an exact comparison of their texts). `colors`: whether `print` prints with colours.
 */
const printedAlike = (mismatch: CallCountMismatch, listed: ListedCall, print: Printer, colors: boolean, deeper: Deeper | undefined): string | undefined => {
  const { expected } = mismatch
  const { record } = listed
  if (listed.matches) return undefined
  let texts: [string, string] | undefined
  if (expected.kind === 'method' && record.kind === 'call')
    texts = [printArguments(record.args, print, recordBounds(record, deeper)), printArguments(expected.specification?.value ?? NO_ARGUMENTS, print, expectedBounds(deeper))]
  else if (expected.kind === 'set' && record.kind === 'set')
    texts = [print.value(record.args?.[0], recordBounds(record, deeper)), print.value(expected.specification?.value?.[0], expectedBounds(deeper))]
  if (texts === undefined) return undefined
  if (!colors) return texts[0] === texts[1] ? texts[0] : undefined
  const text = withoutColors(texts[0])
  return text === withoutColors(texts[1]) ? text : undefined
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
    const plain = new Printer(false)
    // E54: lines that print alike are printed deeper
    const deeper = withPrintGuard(() => deeperLines(mismatch, plain))
    const print = colors ? new Printer(true, undefined, plain.keys) : plain
    let built = withPrintGuard(() => SubstituteException.buildCallCountMismatchMessage(mismatch, colors, print, deeper))
    let message = built.text
    // E52: the expected call prints like a received call that it does not match: number the roots, if that shows more
    // than one of them
    if (withPrintGuard(() => printsAlike(mismatch, plain, deeper))) {
      const numbered = withRootNumbers(() => withPrintGuard(() => SubstituteException.buildCallCountMismatchMessage(mismatch, colors, new Printer(colors, print), deeper)))
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
    mismatch: CallCountMismatch, colors: boolean, print: Printer, deeper: Deeper | undefined
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
        if (alike === undefined) alike = printedAlike(mismatch, listed, print, colors, deeper)
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
