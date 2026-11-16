export type ColorEnvironment = Readonly<Record<string, string | undefined>>

const isSet = (value: string | undefined): boolean => value !== undefined && value !== ''

/**
 * Whether messages should contain ANSI colour codes, for an environment and the TTY state of stdout.
 * The TTY state is only asked for when the environment does not decide (reading process.stdout creates the stream).
 *
 * 1. FORCE_COLOR wins: '0' or 'false' turns colours off, any other value (including '') turns them on.
 * 2. Otherwise NO_COLOR or NODE_DISABLE_COLORS with a non-empty value, or TERM=dumb, turn them off (D18, D24).
 * 3. Otherwise colours are used only when stdout is a TTY.
 */
export const shouldUseColors = (env: ColorEnvironment, stdoutIsTTY: () => boolean): boolean => {
  const forceColor = env.FORCE_COLOR
  if (forceColor !== undefined) return !(forceColor === '0' || forceColor.toLowerCase() === 'false')
  if (isSet(env.NO_COLOR) || isSet(env.NODE_DISABLE_COLORS)) return false
  if (env.TERM === 'dumb') return false
  try {
    return stdoutIsTTY() === true
  } catch {
    return false
  }
}

/** The colour decision for this process (see shouldUseColors). It is made again for every message. */
export const colorsEnabled = (): boolean => {
  if (typeof process === 'undefined' || process === null) return false
  return shouldUseColors(process.env ?? {}, () => process.stdout?.isTTY === true)
}
