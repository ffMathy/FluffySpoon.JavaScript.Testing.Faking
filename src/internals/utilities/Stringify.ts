import { inspect, InspectOptions } from 'util'

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

export const formatValue = (value: unknown, colors: boolean, options?: InspectOptions): string => {
  try {
    return withPrintGuard(() => inspect(value, { ...options, colors }))
  } catch {
    return `<${typeof value}>`
  }
}

export const formatArguments = (args: readonly unknown[] | undefined, colors: boolean, options?: InspectOptions): string =>
  args === undefined ? '' : `(${args.map(arg => formatValue(arg, colors, options)).join(', ')})`

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
