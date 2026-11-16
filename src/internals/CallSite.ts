/**
 * Call sites of operations on substitutes: the first stack frame outside the library.
 *
 * Every received call keeps a captured stack trace (only its call site), to show it in assertion messages. V8 formats
 * it lazily, when `stack` is first read, like any other stack trace: Error.prepareStackTrace, source maps (node
 * --enable-source-maps, jest, vitest) and stack-trace packages all apply (E4). The text is never put together from
 * structured call sites.
 *
 * The engine also needs to know, now and then, whether two operations come from the same expression in a test (D25):
 * whether their first frames outside the library are in the same file and the same enclosing function. It reads that
 * from the same capture, with a prepareStackTrace that looks at the V8 call sites and then throws: V8 keeps nothing of
 * a formatting that throws, so the capture still formats normally when its text is read later (verified on Node.js 10
 * to 26). That saves a second capture per operation, which is what an operation costs most (E11). Reading the call
 * sites changes Error.prepareStackTrace only for that moment (E5).
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

const errorConstructor = Error as unknown as Record<string, unknown>
const STACK_TRACE_LIMIT = 'stackTraceLimit'
const NONE: unique symbol = Symbol('none')
const NONE_OWN: unique symbol = Symbol('no own property')
/** E15: the last limit that could not be lowered for a moment (read-only, getter-only, frozen): it is not tried again. */
let fixedLimit: unknown = NONE

/**
 * Lowers Error.stackTraceLimit to 1 for a moment, and gives what to restore: NONE when it was left as it was, because
 * it is 0 or 1 already or cannot be changed (E15: read-only, getter-only, Object.freeze(Error); then the capture takes
 * as many frames as the limit says, which is slower but just as correct). undefined for a limit that did not exist.
 */
const lowerLimit = (): unknown => {
  let limit: unknown
  try {
    limit = errorConstructor[STACK_TRACE_LIMIT]
  } catch {
    return NONE
  }
  if ((limit as number) >= 0 && (limit as number) <= 1) return NONE
  if (limit === fixedLimit) return NONE
  // a limit that does not exist is restored by deleting it again, not by leaving an own property `undefined` behind
  if (limit === undefined && !Object.prototype.hasOwnProperty.call(errorConstructor, STACK_TRACE_LIMIT)) limit = NONE_OWN
  try {
    errorConstructor[STACK_TRACE_LIMIT] = 1
  } catch {
    fixedLimit = limit === NONE_OWN ? undefined : limit
    return NONE
  }
  if (errorConstructor[STACK_TRACE_LIMIT] !== 1) {
    // an accessor that ignores what it is given: nothing to restore
    fixedLimit = limit === NONE_OWN ? undefined : limit
    return NONE
  }
  fixedLimit = NONE
  return limit
}

const restoreLimit = (limit: unknown): void => {
  if (limit === NONE) return
  try {
    if (limit === NONE_OWN) delete errorConstructor[STACK_TRACE_LIMIT]
    else errorConstructor[STACK_TRACE_LIMIT] = limit
  } catch { /* it could be changed a moment ago */ }
}

// Only the call site (the first frame) is ever used, so only one frame is collected: collecting the whole stack for
// every call would dominate the cost of a call, especially with a raised stackTraceLimit. Error.stackTraceLimit = 0
// is honoured: then there is no call site at all.
export const captureStack = (stackStart: Function): StackHolder => {
  const holder: StackHolder = {}
  if (typeof Error.captureStackTrace !== 'function') {
    holder.stack = new Error().stack
    return holder
  }
  const limit = lowerLimit()
  try {
    Error.captureStackTrace(holder, stackStart)
  } finally {
    restoreLimit(limit)
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

const PREPARE_STACK_TRACE = 'prepareStackTrace'
/** Thrown by peekFirstFrame, so that V8 does not keep a formatted stack. */
const PEEKED = Object.freeze({ peeked: true })
let readFrame: Frame | null = null

/** Reads the first frame, and throws, so that the holder keeps its call sites for its text. */
const peekFirstFrame = (_error: unknown, callSites: unknown): never => {
  readFrame = Array.isArray(callSites) ? frameOf(callSites[0]) : null
  throw PEEKED
}

/** Reads the first frame, and lets V8 keep the result: for a capture that is never shown (cheaper than a peek). */
const takeFirstFrame = (_error: unknown, callSites: unknown): null => {
  readFrame = Array.isArray(callSites) ? frameOf(callSites[0]) : null
  return null
}

/**
 * Formats a holder's stack with `prepare` in place of Error.prepareStackTrace, and puts the exact property back (E5).
 * A writable data property (Node.js 21 and later have one, as source-map-support installs one) is assigned and
 * assigned back, which keeps its attributes. Otherwise the property is redefined for the moment, and its descriptor is
 * restored or the property deleted. A property that cannot be redefined without changing it for good (a
 * non-configurable accessor, as the stack-chain package can install, or a non-configurable read-only value) is left
 * alone: then there is no frame, and adjacency decides (E2).
 */
const readFirstFrame = (holder: StackHolder, prepare: typeof peekFirstFrame | typeof takeFirstFrame): Frame | null => {
  const errorConstructor = Error as unknown as Record<string, unknown>
  let original: PropertyDescriptor | undefined
  try {
    original = Object.getOwnPropertyDescriptor(errorConstructor, PREPARE_STACK_TRACE)
  } catch {
    return null
  }
  const assign = original !== undefined && original.writable === true
  if (!assign && original !== undefined && original.configurable !== true) return null
  try {
    if (assign) errorConstructor[PREPARE_STACK_TRACE] = prepare
    else Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, { value: prepare, writable: true, configurable: true, enumerable: false })
  } catch {
    return null
  }
  readFrame = null
  let read = false
  try {
    void holder.stack
    read = prepare === takeFirstFrame
  } catch (error) {
    read = error === PEEKED
  } finally {
    try {
      if (assign) errorConstructor[PREPARE_STACK_TRACE] = original!.value
      else if (original === undefined) delete errorConstructor[PREPARE_STACK_TRACE]
      else Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, original)
    } catch { /* it could be redefined a moment ago */ }
  }
  // a stack formatted earlier (its text was read) has no call sites left to look at
  return read ? readFrame : null
}

/*
 * The frame of the most recent holder that was read. D25 compares the operation that handed out a proxy with the
 * operation that uses it right after; the latter is the next one to hand out a proxy, so along a chain every frame is
 * read once. Only the latest is kept: the received calls do not carry a frame each (D30).
 */
let lastHolder: StackHolder | undefined
let lastFrame: Frame | null = null

/** The first frame outside the library of a capture, or null when there is none. The capture keeps its text. */
export const frameOfStack = (holder: StackHolder): Frame | null => {
  if (holder !== lastHolder) {
    lastFrame = readFirstFrame(holder, peekFirstFrame)
    lastHolder = holder
  }
  return lastFrame
}

/**
 * The first frame outside the library of the current operation (the trap function is the stack start), for an
 * operation that records nothing (a setup, an assertion): its capture is read once and never shown.
 */
export const currentFrame = (stackStart: Function): Frame | null => readFirstFrame(captureStack(stackStart), takeFirstFrame)

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
