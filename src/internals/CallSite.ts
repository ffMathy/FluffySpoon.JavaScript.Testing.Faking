/**
 * Call sites of operations on substitutes: the first stack frame outside the library.
 *
 * Every received call keeps its call site, to show it in assertion messages. Collecting a stack trace is cheap; it
 * is the formatting into text that costs, so V8 does it lazily, when `stack` is first read. The engine also needs to
 * know, now and then, whether two operations come from the same expression in a test (D25). For that it reads the
 * structured call site (file and enclosing function) of a captured stack, once, by formatting it with a
 * prepareStackTrace that returns the V8 call sites. The text is then produced from those call sites when a message
 * needs it.
 */

type V8CallSite = {
  getFileName(): string | null | undefined
  getFunctionName(): string | null
  getEnclosingLineNumber?(): number | null
  getEnclosingColumnNumber?(): number | null
  toString(): string
}

/** A captured stack trace: V8 installs a lazily formatted `stack` property on it. */
export type StackHolder = { stack?: unknown }

/**
 * The function the first frame outside the library runs in: its file, and the position where the function starts
 * (V8 since Node 14.18) or, on older runtimes, its name.
 */
export type Frame = { readonly file: string | null | undefined, readonly enclosing: string | null }

// Only the call site (the first frame) is ever used, so only one frame is collected: collecting the whole stack for
// every call would dominate the cost of a call, especially with a raised stackTraceLimit. Error.stackTraceLimit = 0
// is honoured: then there is no call site at all.
export const captureStack = (stackStart: Function): StackHolder => {
  const holder: StackHolder = {}
  if (typeof Error.captureStackTrace !== 'function') {
    holder.stack = new Error().stack
    return holder
  }
  const stackTraceLimit = Error.stackTraceLimit
  if (!(stackTraceLimit >= 0 && stackTraceLimit <= 1)) Error.stackTraceLimit = 1
  try {
    Error.captureStackTrace(holder, stackStart)
  } finally {
    Error.stackTraceLimit = stackTraceLimit
  }
  return holder
}

const returnCallSites = (_error: unknown, callSites: unknown) => callSites

/** Reads the stack of a holder with a prepareStackTrace that returns the V8 call sites (undefined if it cannot). */
const readCallSites = (holder: StackHolder): { callSites?: V8CallSite[], text?: unknown } => {
  const errorConstructor = Error as { prepareStackTrace?: unknown }
  const prepare = errorConstructor.prepareStackTrace
  let replaced = false
  try {
    errorConstructor.prepareStackTrace = returnCallSites
    replaced = errorConstructor.prepareStackTrace === returnCallSites
  } catch { /* a frozen Error: no structured call sites */ }
  let value: unknown
  try {
    value = holder.stack
  } catch {
    value = undefined
  } finally {
    if (replaced) {
      try {
        errorConstructor.prepareStackTrace = prepare
      } catch { /* it was writable a moment ago */ }
    }
  }
  return Array.isArray(value) ? { callSites: value as V8CallSite[] } : { text: value }
}

const frameOf = (callSite: V8CallSite | undefined): Frame | null => {
  if (callSite === undefined) return null
  try {
    const line = typeof callSite.getEnclosingLineNumber === 'function' ? callSite.getEnclosingLineNumber() : null
    const column = typeof callSite.getEnclosingColumnNumber === 'function' ? callSite.getEnclosingColumnNumber() : null
    const enclosing = typeof line === 'number' && typeof column === 'number' ? `${line}:${column}` : callSite.getFunctionName()
    return { file: callSite.getFileName(), enclosing }
  } catch {
    return null
  }
}

const formatCallSites = (holder: StackHolder, callSites: V8CallSite[]): string => {
  const prepare = (Error as { prepareStackTrace?: unknown }).prepareStackTrace
  if (typeof prepare === 'function') {
    try {
      const formatted = prepare.call(Error, holder, callSites)
      if (typeof formatted === 'string') return formatted
    } catch { /* fall back to the default format */ }
  }
  return ['Error', ...callSites.map(callSite => `    at ${String(callSite)}`)].join('\n')
}

/** The call site of one operation. The structured frame and the text are both worked out lazily. */
export class CallSite {
  // undefined: not read yet; null: not available (no frame, or not a V8 runtime)
  private _frame?: Frame | null = undefined
  private _callSites?: V8CallSite[] = undefined
  private _text?: string = undefined

  constructor(private readonly _holder: StackHolder) { }

  public static capture(stackStart: Function): CallSite {
    return new CallSite(captureStack(stackStart))
  }

  /** The first frame outside the library, or null when there is none (e.g. Error.stackTraceLimit = 0). */
  public get frame(): Frame | null {
    if (this._frame === undefined) {
      const { callSites, text } = readCallSites(this._holder)
      this._callSites = callSites
      if (typeof text === 'string') this._text = text
      this._frame = callSites === undefined ? null : frameOf(callSites[0])
    }
    return this._frame
  }

  /** The stack trace as text (only the call site), for messages. */
  public get stack(): string | undefined {
    if (this._frame === undefined) void this.frame // the call sites are read once, for the frame and the text
    if (this._text !== undefined) return this._text
    if (this._callSites === undefined) return undefined
    return this._text = formatCallSites(this._holder, this._callSites)
  }
}

/**
 * D25: whether two operations belong to the same expression: their call sites are in the same file and the same
 * enclosing function. When a call site is not available, only adjacency counts (the caller has checked it).
 */
export const sameExpression = (a: Frame | null, b: Frame | null): boolean =>
  a === null || b === null || (a.file === b.file && a.enclosing === b.enclosing)
