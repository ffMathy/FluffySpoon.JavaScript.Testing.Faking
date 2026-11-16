/**
 * Whether messages should contain ANSI colour codes.
 * FORCE_COLOR wins (0/false disables it), then NO_COLOR (any non-empty value disables colours),
 * otherwise colours are only used when stdout is a TTY.
 */
export const colorsEnabled = (): boolean => {
  if (typeof process === 'undefined' || process === null) return false
  const env = process.env ?? {}
  const forceColor = env.FORCE_COLOR
  if (forceColor !== undefined) return !(forceColor === '0' || forceColor.toLowerCase() === 'false')
  const noColor = env.NO_COLOR
  if (noColor !== undefined && noColor !== '') return false
  try {
    return process.stdout?.isTTY === true
  } catch {
    return false
  }
}
