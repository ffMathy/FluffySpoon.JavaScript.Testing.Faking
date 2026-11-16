/**
 * Call sites of operations on substitutes: the first stack frame outside the library.
 *
 * Every received call keeps a captured stack trace (only its call site), to show it in assertion messages. Capturing
 * is cheap; it is the formatting into text that costs, so V8 does it lazily, when `stack` is first read, and then
 * formats it like any other stack trace: Error.prepareStackTrace, source maps (node --enable-source-maps, jest,
 * vitest) and stack-trace packages all apply (E4).
 *
 * The engine also needs to know, now and then, whether two operations come from the same expression in a test (D25):
 * whether their first frames outside the library are in the same file and the same enclosing function. For that it
 * reads the structured call sites of a SEPARATE capture, with a prepareStackTrace that returns the V8 call sites. That
 * capture is never used for text. Reading it changes Error.prepareStackTrace only for that moment (E5).
 */

type V8CallSite = {
  getFileName(): string | null | undefined
  getFunctionName(): string | null
  getEnclosingLineNumber?(): number | null
  getEnclosingColumnNumber?(): number | null
  isAsync?(): boolean
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

/** The stack trace of a holder as text, formatted the usual way (undefined if it is not text). */
export const stackText = (holder: StackHolder): string | undefined => {
  try {
    const stack = holder.stack
    return typeof stack === 'string' ? stack : undefined
  } catch {
    return undefined
  }
}

const PREPARE_STACK_TRACE = 'prepareStackTrace'
const returnCallSites = (_error: unknown, callSites: unknown) => callSites

/**
 * E5: the descriptor that puts returnCallSites in place of Error.prepareStackTrace for a moment, or undefined when that
 * is not possible without changing the property for good: a non-configurable accessor (as the stack-chain package
 * installs) or a non-configurable, non-writable value, or an Error that cannot be extended.
 */
const temporaryDescriptor = (original: PropertyDescriptor | undefined): PropertyDescriptor | undefined => {
  if (original === undefined || original.configurable === true)
    return { value: returnCallSites, writable: true, configurable: true, enumerable: original?.enumerable === true }
  if ('value' in original && original.writable === true) return { value: returnCallSites }
  return undefined
}

/**
 * Reads the structured call sites of a holder (undefined if it cannot). Error.prepareStackTrace is replaced by a data
 * property only while the holder's stack is formatted, and the exact property descriptor is put back afterwards, so
 * that the process's stack formatting never changes (E5).
 */
const readCallSites = (holder: StackHolder): V8CallSite[] | undefined => {
  const errorConstructor = Error as unknown as Record<string, unknown>
  let original: PropertyDescriptor | undefined
  try {
    original = Object.getOwnPropertyDescriptor(errorConstructor, PREPARE_STACK_TRACE)
  } catch {
    return undefined
  }
  const temporary = temporaryDescriptor(original)
  if (temporary === undefined) return undefined
  try {
    Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, temporary)
  } catch {
    return undefined
  }
  let value: unknown
  try {
    value = holder.stack
  } catch {
    value = undefined
  } finally {
    try {
      if (original === undefined) delete errorConstructor[PREPARE_STACK_TRACE]
      else Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, original)
    } catch { /* it could be redefined a moment ago */ }
  }
  return Array.isArray(value) ? value as V8CallSite[] : undefined
}

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
    return { file: callSite.getFileName(), enclosing }
  } catch {
    return null
  }
}

/** The first frame outside the library of a capture made for that purpose, or null when there is none. */
const frameOfCapture = (holder: StackHolder): Frame | null => {
  const callSites = readCallSites(holder)
  return callSites === undefined ? null : frameOf(callSites[0])
}

/** The first frame outside the library of the current operation (the trap function is the stack start). */
export const currentFrame = (stackStart: Function): Frame | null => frameOfCapture(captureStack(stackStart))

/*
 * The frame of the operation that last handed out a proxy (or a deferred read). D25 only ever compares the frame of the
 * operation that handed out the proxy that the current operation uses, when that was the most recent operation of all,
 * so one capture is kept, for the latest hand-out only: the received calls do not carry a second stack each (D30).
 */
const handOut: { owner: object | undefined, capture: StackHolder | undefined, frame: Frame | null | undefined } =
  { owner: undefined, capture: undefined, frame: undefined }

/**
 * Captures the frame of the current operation, which hands out a proxy for `owner` (a received call). The capture of
 * the same owner is kept: a method read and invoked in one expression (`sub.method(...)`) hands out twice.
 */
export const captureHandOutFrame = (owner: object, stackStart: Function): void => {
  if (handOut.owner === owner) return
  handOut.owner = owner
  handOut.capture = captureStack(stackStart)
  handOut.frame = undefined
}

/** Forgets the capture of `owner`: its operation turned out to be another one (a method read invoked elsewhere). */
export const forgetHandOutFrame = (owner: object): void => {
  if (handOut.owner !== owner) return
  handOut.owner = undefined
  handOut.capture = undefined
  handOut.frame = undefined
}

/** The frame of the operation that handed out a proxy for `owner`, if it was the latest hand-out; otherwise null. */
export const handOutFrame = (owner: object): Frame | null => {
  if (handOut.owner !== owner || handOut.capture === undefined) return null
  if (handOut.frame === undefined) handOut.frame = frameOfCapture(handOut.capture)
  return handOut.frame
}

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
