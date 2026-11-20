/**
 * Call sites of operations on substitutes: the first stack frame outside the library.
 *
 * Every operation that may be shown in a message keeps a captured stack trace, which V8 formats lazily, when `stack` is
 * first read, like any other stack trace: Error.prepareStackTrace, source maps (node --enable-source-maps, jest,
 * vitest) and stack-trace packages all apply (E4). The text is never put together from structured call sites.
 *
 * The engine also needs to know whether two operations come from the same expression in a test (D25): whether their
 * first frames outside the library are in the same file and the same enclosing function. It reads that from a separate
 * capture, made at the same moment, with a prepareStackTrace that returns the V8 call sites and never throws (E16).
 * That capture is never used for text. Reading it changes Error.prepareStackTrace only for that moment (E5).
 * Error.stackTraceLimit is never changed: V8 itself collects no frames when it is 0, below 1, missing, not a number or
 * an accessor (E15, E21), and then there is no "called at" line and no frame.
 */

type V8CallSite = {
  getFileName(): string | null | undefined
  getFunctionName(): string | null
  getEnclosingLineNumber?(): number | null
  getEnclosingColumnNumber?(): number | null
  getLineNumber?(): number | null
  getColumnNumber?(): number | null
  isAsync?(): boolean
}

/** A captured stack trace (V8 installs a lazily formatted `stack` property on it) and the frame of its operation. */
export type StackHolder = { stack?: unknown, frame?: Frame | null }

/**
 * The function the first frame outside the library runs in: its file, and the position where the function starts
 * (V8 since Node 14.18) or, on older runtimes, its name.
 */
export type Frame = {
  readonly file: string | null | undefined
  readonly enclosing: string | null
  /** E47: where in the file the operation is (as V8 counts, before source maps), when V8 tells it. */
  readonly line?: number | null
  readonly column?: number | null
}

/** A site without a stack or a frame (Assertions' checkViewSite, E61). */
export const NO_FRAMES: StackHolder = Object.freeze({})

/**
 * The frame of a call site. An async frame is no frame of the operation: V8 appends the async functions that await the
 * current promise job to its stack (async stack traces), so a call made from a promise job, which has no frame of its
 * own, would otherwise look like a call made by the test function that awaits it (E2).
 */
const frameOf = (callSite: V8CallSite | undefined): Frame | null => {
  if (callSite === undefined) return null
  try {
    if (typeof callSite.isAsync === 'function' && callSite.isAsync()) return null
    const line = typeof callSite.getEnclosingLineNumber === 'function' ? callSite.getEnclosingLineNumber() : null
    const column = typeof callSite.getEnclosingColumnNumber === 'function' ? callSite.getEnclosingColumnNumber() : null
    const enclosing = typeof line === 'number' && typeof column === 'number' ? `${line}:${column}` : callSite.getFunctionName()
    return {
      file: callSite.getFileName(),
      enclosing,
      line: typeof callSite.getLineNumber === 'function' ? callSite.getLineNumber() : null,
      column: typeof callSite.getColumnNumber === 'function' ? callSite.getColumnNumber() : null
    }
  } catch {
    return null
  }
}

const errorConstructor = Error as unknown as Record<string, unknown>
const PREPARE_STACK_TRACE = 'prepareStackTrace'
const returnCallSites = (_error: unknown, callSites: unknown): unknown => callSites

/**
 * The first frame outside the library of the current operation (`stackStart`: the trap function), from a capture of its
 * own. Error.prepareStackTrace is replaced by returnCallSites only while that capture is formatted, and the exact
 * property is put back (E5): a writable data property (Node.js 20.20 and later have one, as source-map-support installs
 * one) is assigned and assigned back, which keeps its attributes; otherwise the property is redefined for the moment,
 * and its descriptor is restored or the property deleted. A property that cannot be redefined without changing it for
 * good (a non-configurable accessor, as the stack-chain package can install, or a non-configurable read-only value), or
 * that cannot be added (an Error that is not extensible), is left alone: then there is no frame, and adjacency decides
 * (E2).
 */
export const currentFrame = (stackStart: Function): Frame | null => {
  if (typeof Error.captureStackTrace !== 'function') return null
  let original: PropertyDescriptor | undefined
  try {
    original = Object.getOwnPropertyDescriptor(errorConstructor, PREPARE_STACK_TRACE)
    if (original === undefined && !Object.isExtensible(errorConstructor)) return null
  } catch {
    return null
  }
  const assign = original !== undefined && original.writable === true
  if (!assign && original !== undefined && original.configurable !== true) return null
  try {
    if (assign) errorConstructor[PREPARE_STACK_TRACE] = returnCallSites
    else Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, { value: returnCallSites, writable: true, configurable: true, enumerable: false })
  } catch {
    return null
  }
  let callSites: unknown
  try {
    const holder: StackHolder = {}
    Error.captureStackTrace(holder, stackStart)
    callSites = holder.stack
  } catch {
    callSites = undefined
  } finally {
    try {
      if (assign) errorConstructor[PREPARE_STACK_TRACE] = original!.value
      else if (original === undefined) delete errorConstructor[PREPARE_STACK_TRACE]
      else Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, original)
    } catch { /* it could be redefined a moment ago */ }
  }
  return Array.isArray(callSites) ? frameOf(callSites[0]) : null
}

/** The call site of the current operation (`stackStart`: the trap function): its stack trace and its frame. */
export const captureStack = (stackStart: Function): StackHolder => {
  if (typeof Error.captureStackTrace !== 'function') return { stack: new Error().stack, frame: null }
  const holder: StackHolder = {}
  Error.captureStackTrace(holder, stackStart)
  holder.frame = currentFrame(stackStart)
  return holder
}

/** The stack trace of a holder as text, formatted the usual way (undefined if it is not text). */
export const stackText = (holder: StackHolder): string | undefined => {
  try {
    const stack = holder.stack
    return typeof stack === 'string' ? stack : undefined
  } catch {
    return undefined
  }
}

/** The first frame outside the library of a capture, or null when there is none. */
export const frameOfStack = (holder: StackHolder): Frame | null => holder.frame ?? null

/**
 * D25: whether two operations belong to the same expression: their call sites are in the same file and the same
 * enclosing function. E2: only when neither of them has a call site (stack traces are off, or structured call sites
 * cannot be read) does adjacency alone decide (the caller has checked it). When exactly one of them has a call site,
 * they are not the same expression: an expression in a test always has one. A call made from a promise job or
 * another callback of the runtime has none.
 */
export const sameExpression = (a: Frame | null, b: Frame | null): boolean => {
  if (a === null || b === null) return a === b
  return a.file === b.file && a.enclosing === b.enclosing
}

/** What Node.js' module.findSourceMap gives (Node.js 12.17+ and 13.7+), as far as it is used here. */
type SourceMapEntry = { generatedLine?: unknown, generatedColumn?: unknown, originalSource?: unknown, originalLine?: unknown }
type SourceMapLike = { findEntry(lineOffset: number, columnOffset: number): SourceMapEntry | undefined }

/**
 * E125: the source map Node.js has for a file, or undefined: Node.js keeps one for a module it loaded while source maps
 * were enabled (node --enable-source-maps, process.setSourceMapsEnabled, module.setSourceMapsSupport; tsx enables them)
 * and the module's code names one. Asked anew each time (a test runner in watch mode can load a changed file again).
 */
const sourceMapOf = (file: unknown): SourceMapLike | undefined => {
  if (typeof file !== 'string' || file === '') return undefined
  try {
    const find = require('module').findSourceMap
    if (typeof find !== 'function') return undefined
    const map = find(file)
    return typeof map === 'object' && map !== null && typeof map.findEntry === 'function' ? map : undefined
  } catch {
    return undefined
  }
}

/**
 * E125: the source and line (0-based) that a source map gives for a position (1-based, as V8 reports it), or undefined.
 * findEntry gives the mapping that starts last at or before the position. V8 can put an operation at a character that
 * no mapping starts at: a property read of a chain at its dot (`.log` in `logger.received(2).log(...)`), where tsc and
 * esbuild map the name after it. That character belongs to the mapping before it, which for a chain over several lines
 * of the source is on the line before. So a mapping that starts one or two characters later (the name after `.` or
 * `?.`) is taken first, then the one before it on the same line of the file that runs; one that starts on an earlier
 * line of that file tells nothing about this line.
 */
const mappedLine = (map: SourceMapLike, line: number, column: number): SourceMapEntry | undefined => {
  const at = (offset: number): SourceMapEntry | undefined => {
    const entry = map.findEntry(line - 1, column - 1 + offset)
    return typeof entry === 'object' && entry !== null && entry.generatedLine === line - 1 && typeof entry.originalLine === 'number' ? entry : undefined
  }
  try {
    const before = at(0)
    if (before !== undefined && before.generatedColumn === column - 1) return before
    for (let offset = 1; offset <= 2; offset++) {
      const after = at(offset)
      if (after !== undefined && after.generatedColumn === column - 1 + offset) return after
    }
    return before
  } catch {
    return undefined
  }
}

/**
 * Whether the operation at `to` comes after the one at `from` on the same line of the same file (the caller has checked
 * that they are in the same function, see sameExpression): as V8 reports their positions, before source maps, and E125
 * (R17FE-5), when V8 puts them on the same line, on the same line of the source too, where Node.js has a source map for
 * the file. A transpiler can put several lines of the source on one line of its output: tsx (esbuild with
 * minifyWhitespace) puts a whole file on one. Without a source map, two statements written on one line of the file that
 * runs are on the same line.
 * Only when the two lines are the same is the source map looked at, which is rare: the rules that ask this only ask it
 * for a call that answered with the substitute it was made on (see the engine's continuesExpression) and for a matcher
 * that threw a usage error (see Assertions' cancelDeferredReportOf).
 */
export const sameLineAfter = (from: Frame, to: Frame): boolean => {
  const line = from.line
  const fromColumn = from.column
  const toColumn = to.column
  if (typeof line !== 'number' || line !== to.line || typeof fromColumn !== 'number' || typeof toColumn !== 'number' || toColumn <= fromColumn) return false
  const map = sourceMapOf(from.file)
  if (map === undefined) return true
  const fromSource = mappedLine(map, line, fromColumn)
  const toSource = mappedLine(map, line, toColumn)
  if (fromSource === undefined || toSource === undefined) return true
  return fromSource.originalLine === toSource.originalLine && fromSource.originalSource === toSource.originalSource
}
