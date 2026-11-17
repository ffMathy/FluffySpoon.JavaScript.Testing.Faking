import { inspect, InspectOptions, types } from 'util'

let printDepth = 0

/**
 * Runs `print` while marking that the library is printing. Substitutes met while printing (for example a
 * substitute recorded as an argument of another substitute) are printed in their short form, so
 * printing never recurses through substitutes, even when they reference each other.
 */
export const withPrintGuard = <T>(print: () => T): T => {
  printDepth++
  try {
    return print()
  } finally {
    printDepth--
  }
}

export const isPrinting = (): boolean => printDepth > 0

/** Whether a value is an error: a native error, or an object with Error.prototype in its prototype chain. */
const isError = (value: unknown): value is Error => {
  // a substitute is a function (proxy), never an error; reading from it would be recorded
  if (typeof value !== 'object' || value === null) return false
  try {
    return types.isNativeError(value) || value instanceof Error
  } catch {
    return false // a revoked proxy
  }
}

const errorHead = (error: Error): string => {
  const name = typeof error.name === 'string' && error.name !== '' ? error.name : 'Error'
  const message = typeof error.message === 'string' ? error.message : String(error.message)
  return message === '' ? `[${name}]` : `[${name}: ${message}]`
}

/**
 * E40: an error as a value in a message or a printout, without its stack (whose frames would look like the "called at"
 * lines of the calls), as util.inspect shows an error without a stack: `[SyntaxError: Unexpected end of JSON input]`,
 * and its cause: `[Error: saving failed] { [cause]: [TypeError: x is undefined] }`.
 */
const compactError = (error: Error): string => {
  const head = errorHead(error)
  if (!Object.prototype.hasOwnProperty.call(error, 'cause')) return head
  const cause = (error as Error & { cause?: unknown }).cause
  const causeText = isError(cause) ? errorHead(cause) : withPrintGuard(() => inspect(cause, { depth: 0, colors: false, breakLength: Infinity }))
  return `${head} { [cause]: ${causeText} }`
}

/** An argument (or a configured value) as messages and printouts show it: errors compactly (E40), anything else inspected. */
export const formatArgument = (value: unknown, options: InspectOptions): string => {
  if (isError(value)) {
    try {
      return compactError(value)
    } catch {
      // an error whose name or message cannot be read: inspected as usual
    }
  }
  return inspect(value, options)
}

export const formatValue = (value: unknown, colors: boolean, options?: InspectOptions): string => {
  try {
    return withPrintGuard(() => formatArgument(value, { ...options, colors }))
  } catch {
    return `<${typeof value}>`
  }
}

export const formatArguments = (args: readonly unknown[] | undefined, colors: boolean, options?: InspectOptions): string =>
  args === undefined ? '' : `(${args.map(arg => formatValue(arg, colors, options)).join(', ')})`

/**
 * D26: for the direct-call reading of an invocation through call/apply, how it was written (` via .call(t, 1)`).
 * Typed structurally, so that this module does not depend on CallRecord.
 */
export const describeOtherReading = (
  record: { directReading?: boolean, twin?: { key: PropertyKey, args?: readonly unknown[] } },
  colors: boolean
): string => {
  const twin = record.twin
  if (record.directReading !== true || twin === undefined) return ''
  return ` via .${String(twin.key)}${formatArguments(twin.args, colors)}`
}

/** The first "at ..." line of a stack trace, if there is one (there is none with Error.stackTraceLimit = 0). */
export const firstStackFrame = (stack: string | undefined): string | undefined => {
  if (typeof stack !== 'string') return undefined
  const lines = stack.split('\n')
  for (let index = 1; index < lines.length; index++) {
    if (/^\s*at /.test(lines[index])) return lines[index]
  }
  return undefined
}

export const plural = (word: string, count: number | undefined) => `${word}${count === 1 ? '' : 's'}`
