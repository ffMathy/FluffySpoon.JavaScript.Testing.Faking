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
 * from the same capture, with a prepareStackTrace of its own that looks at the V8 call sites, which saves a second
 * capture per operation, the thing an operation costs most (E11). Reading the call sites changes
 * Error.prepareStackTrace only for that moment (E5). The capture must still format as usual when its text is read
 * later:
 * - E16: when Error.prepareStackTrace holds a formatter (Node.js's own from 20.20 on, or an installed one such as
 *   source-map-support's or jest's), the call sites are kept as the capture's stack, and the formatter makes the text
 *   from them when it is needed, as V8 would have called it (source maps included);
 * - otherwise (Node.js before 20.20 without an installed formatter, Error.prepareStackTrace deleted, vm contexts such
 *   as vitest's vm pools), it throws after looking at them: V8 keeps nothing of a formatting that throws (verified on
 *   Node.js 10 to 26), and formats the capture normally later. A debugger set to pause on caught exceptions stops
 *   there, inside the library.
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

/** A captured stack trace: V8 installs a lazily formatted `stack` property on it. */
export type StackHolder = { stack?: unknown }

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

const errorConstructor = Error as unknown as Record<string, unknown>
const STACK_TRACE_LIMIT = 'stackTraceLimit'
const NONE: unique symbol = Symbol('none')
/** E15: the last limit that could not be lowered for a moment (read-only, getter-only, frozen): it is not tried again. */
let fixedLimit: unknown = NONE
/** The last limit whose property was found to be assignable (so that it is not looked at on every capture). */
let assignableLimit: unknown = NONE

/**
 * Whether Error.stackTraceLimit can be assigned without an exception (E16: a debugger set to pause on caught
 * exceptions would stop at a failed assignment): a writable value, or an accessor with a setter.
 */
const limitIsAssignable = (): boolean => {
  const descriptor = Object.getOwnPropertyDescriptor(errorConstructor, STACK_TRACE_LIMIT)
  if (descriptor === undefined) return false
  return 'value' in descriptor ? descriptor.writable === true : typeof descriptor.set === 'function'
}

/**
 * Lowers Error.stackTraceLimit (a number above 1) to 1 for a moment, and gives what to restore: NONE when it was left
 * as it was, because it cannot be changed (E15: read-only, getter-only, Object.freeze(Error); then the capture takes as
 * many frames as the limit says, which is slower but just as correct).
 */
const lowerLimit = (limit: number): unknown => {
  if (limit === 1 || limit === fixedLimit) return NONE
  let lowered = false
  try {
    if (limit === assignableLimit || limitIsAssignable()) {
      assignableLimit = limit
      errorConstructor[STACK_TRACE_LIMIT] = 1
      lowered = true
    }
  } catch { /* it changed in the meantime */ }
  if (!lowered) {
    fixedLimit = limit
    return NONE
  }
  if (errorConstructor[STACK_TRACE_LIMIT] !== 1) {
    // an accessor that ignores what it is given: nothing to restore
    fixedLimit = limit
    return NONE
  }
  fixedLimit = NONE
  return limit
}

const restoreLimit = (limit: unknown): void => {
  if (limit === NONE) return
  try {
    errorConstructor[STACK_TRACE_LIMIT] = limit
  } catch { /* it could be changed a moment ago */ }
}

/**
 * E21: the capture of an operation without stack frames, shared by all of them: Error.stackTraceLimit is missing, is
 * not a number or is below 1 (V8 itself collects no frames for any error then). It has no stack, so it shows no
 * "called at" line, and has no frame (D25 falls back to adjacency, E2).
 */
export const NO_FRAMES: StackHolder = Object.freeze({})

/** Error.stackTraceLimit as a number of frames, or 0 when V8 collects none (see NO_FRAMES). */
const currentLimit = (): number => {
  let limit: unknown
  try {
    limit = errorConstructor[STACK_TRACE_LIMIT]
  } catch {
    return 0
  }
  return typeof limit === 'number' && limit >= 1 ? limit : 0
}

// Only the call site (the first frame) is ever used, so only one frame is collected: collecting the whole stack for
// every call would dominate the cost of a call, especially with a raised stackTraceLimit. A limit that gives no frames
// (Error.stackTraceLimit = 0, or E21: missing or not a number) is honoured: then there is no call site at all, and
// the property is left alone.
export const captureStack = (stackStart: Function): StackHolder => {
  if (typeof Error.captureStackTrace !== 'function') return { stack: new Error().stack }
  const limit = currentLimit()
  if (limit === 0) return NO_FRAMES
  const holder: StackHolder = {}
  const lowered = lowerLimit(limit)
  try {
    Error.captureStackTrace(holder, stackStart)
  } finally {
    restoreLimit(lowered)
  }
  return holder
}

/**
 * E16: the stack trace of a holder whose call sites were read while Error.prepareStackTrace held a formatter (Node.js's
 * own from 20.20 on, or an installed one such as source-map-support's) is what the temporary formatter returned in its
 * place, so that V8 keeps nothing else: the call site itself (as usual, when there is one frame), or a DeferredStack
 * with the call sites (when the limit could not be lowered, E15). Its text is made when it is first needed, from the
 * same call sites, by the formatter in place then (or, if there is none any more, the one in place when call sites were
 * last kept), called as V8 calls it.
 */
class DeferredStack {
  constructor(readonly callSites: readonly unknown[]) { }
}
/** The prototype of V8's call sites, seen when call sites are first kept. */
let callSitePrototype: object | null | undefined
/** The formatter in place when call sites were last kept. */
let keptFormatter: Function | undefined

/** The call sites kept as the stack of a holder (see DeferredStack), or undefined when it is anything else. */
const keptCallSites = (stack: unknown): readonly unknown[] | undefined => {
  if (stack instanceof DeferredStack) return stack.callSites
  if (typeof stack === 'object' && stack !== null && callSitePrototype !== undefined && Object.getPrototypeOf(stack) === callSitePrototype) return [stack]
  return undefined
}

/** The stack trace of a holder as text, formatted the usual way (undefined if it is not text). */
export const stackText = (holder: StackHolder): string | undefined => {
  try {
    let stack = holder.stack
    const callSites = keptCallSites(stack)
    if (callSites !== undefined) {
      const current = errorConstructor[PREPARE_STACK_TRACE]
      const format = typeof current === 'function' ? current : keptFormatter
      if (format === undefined) return undefined
      // as V8 calls it: Node.js calls Error.prepareStackTrace(error, callSites) as a method of Error
      stack = Reflect.apply(format, Error, [holder, callSites])
      holder.stack = stack
    }
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

const PREPARE_STACK_TRACE = 'prepareStackTrace'
/** Thrown by peekFirstFrame, so that V8 does not keep a formatted stack. */
const PEEKED = Object.freeze({ peeked: true })
let readFrame: Frame | null = null
let read = false
/** The formatter in place while keepFirstFrame reads the call sites. */
let formatter: Function | undefined

const readCallSites = (callSites: unknown): void => {
  readFrame = Array.isArray(callSites) ? frameOf(callSites[0]) : null
  read = true
}

/**
 * Reads the first frame, and throws, so that the holder keeps its call sites for its text: for a holder whose text may
 * be shown, when Error.prepareStackTrace holds no formatter (Node.js before 20.20 without an installed one). V8 keeps
 * nothing of a formatting that throws.
 */
const peekFirstFrame = (_error: unknown, callSites: unknown): never => {
  readCallSites(callSites)
  throw PEEKED
}

/**
 * E16: reads the first frame without throwing (a debugger set to pause on caught exceptions would stop there), for a
 * holder whose text may be shown, while Error.prepareStackTrace holds a formatter: V8 keeps what this returns, the call
 * sites (see DeferredStack), and the text is made from them by that formatter when it is needed (stackText).
 */
const keepFirstFrame = (_error: unknown, callSites: unknown): unknown => {
  readCallSites(callSites)
  if (!Array.isArray(callSites)) return undefined
  keptFormatter = formatter
  if (callSites.length === 1) {
    // the call site itself is smaller than an array of one and a wrapper (D30)
    const prototype = Object.getPrototypeOf(callSites[0])
    if (callSitePrototype === undefined && prototype !== Object.prototype) callSitePrototype = prototype
    if (prototype === callSitePrototype) return callSites[0]
  }
  return new DeferredStack(callSites)
}

/** Reads the first frame, and lets V8 keep the result: for a capture that is never shown (cheaper than a peek). */
const takeFirstFrame = (_error: unknown, callSites: unknown): null => {
  readCallSites(callSites)
  return null
}

type Prepare = typeof peekFirstFrame | typeof keepFirstFrame | typeof takeFirstFrame

/**
 * Formats a holder's stack with `prepare` in place of Error.prepareStackTrace, and puts the exact property back (E5).
 * A writable data property (Node.js 20.20 and later have one, as source-map-support installs one) is assigned and
 * assigned back, which keeps its attributes. Otherwise the property is redefined for the moment, and its descriptor is
 * restored or the property deleted. A property that cannot be redefined without changing it for good (a
 * non-configurable accessor, as the stack-chain package can install, or a non-configurable read-only value) is left
 * alone: then there is no frame, and adjacency decides (E2).
 * `keep`: the holder's text may be shown later. Then its call sites are kept for it: with a formatter in place, as its
 * stack (E16, see DeferredStack), otherwise by a peek that throws.
 */
const readFirstFrame = (holder: StackHolder, keep: boolean): Frame | null => {
  if (holder === NO_FRAMES) return null
  let original: PropertyDescriptor | undefined
  try {
    original = Object.getOwnPropertyDescriptor(errorConstructor, PREPARE_STACK_TRACE)
  } catch {
    return null
  }
  const assign = original !== undefined && original.writable === true
  if (!assign && original !== undefined && original.configurable !== true) return null
  let prepare: Prepare = takeFirstFrame
  if (keep) {
    let current: unknown
    try {
      current = original === undefined ? undefined : 'value' in original ? original.value : errorConstructor[PREPARE_STACK_TRACE]
    } catch { /* a getter that throws: no formatter */ }
    formatter = typeof current === 'function' ? current : undefined
    prepare = formatter !== undefined ? keepFirstFrame : peekFirstFrame
  }
  try {
    if (assign) errorConstructor[PREPARE_STACK_TRACE] = prepare
    else Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, { value: prepare, writable: true, configurable: true, enumerable: false })
  } catch {
    return null
  }
  readFrame = null
  read = false
  let stack: unknown
  try {
    stack = holder.stack
  } catch { /* PEEKED */ } finally {
    formatter = undefined
    try {
      if (assign) errorConstructor[PREPARE_STACK_TRACE] = original!.value
      else if (original === undefined) delete errorConstructor[PREPARE_STACK_TRACE]
      else Object.defineProperty(errorConstructor, PREPARE_STACK_TRACE, original)
    } catch { /* it could be redefined a moment ago */ }
  }
  if (read) return readFrame
  // read earlier: kept call sites are still there, a stack formatted as text has none left to look at
  const callSites = keptCallSites(stack)
  return callSites !== undefined ? frameOf(callSites[0] as V8CallSite | undefined) : null
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
    lastFrame = readFirstFrame(holder, true)
    lastHolder = holder
  }
  return lastFrame
}

/**
 * The first frame outside the library of the current operation (the trap function is the stack start), for an
 * operation that records nothing (a setup, an assertion): its capture is read once and never shown.
 */
export const currentFrame = (stackStart: Function): Frame | null => readFirstFrame(captureStack(stackStart), false)

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
