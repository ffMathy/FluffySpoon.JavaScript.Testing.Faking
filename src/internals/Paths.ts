import { SELF, keyToString } from './Constants'
import { PATH_BOUNDS, formatBounded, withPrintGuard } from './utilities'
import { libraryGuard } from './utilities/Guard'

/*
 * The paths of auto-substitutes (`@Substitute.logger`, `@Substitute.getUser(1).name`), as printouts and messages show
 * them. Typed structurally (an AutoEntry is a PathEntry, a SubstituteState a PathState), so that this module does not
 * depend on SubstituteState.
 */
export type PathEntry = {
  readonly kind: 'get' | 'call'
  readonly key: PropertyKey
  readonly argumentList: readonly unknown[] | undefined
  readonly parent: PathState
  /**
   * E99: whether this is the auto-substitute of a nested setup through a call with matchers, which every call matching it
   * answers (see AutoEntry.specifiesMatchers).
   */
  readonly specifiesMatchers?: boolean
}
export type PathState = {
  readonly owner?: PathEntry
  /** E99: what the received calls of a member answered with a configured value (see SubstituteState.configuredAnswers). */
  configuredAnswers?(key: PropertyKey): ReadonlyMap<HandOut, object> | undefined
}

/** E99: a received call that answered with a substitute (a CallRecord). */
export type HandOut = { readonly kind: string, readonly args?: readonly unknown[], readonly retracted: boolean }

/*
 * E33: printing never recurses without end. The arguments in a path can hold substitutes, whose paths can hold the same
 * arguments again: a factory's result stored on the object passed to it (`ctx.child = app.create(ctx)`), or a handler
 * bound to the instance that holds it (`this.onSave = bus.handler.bind(this)`). So a call whose arguments are already
 * being formatted further up shows them as `(…)` (`@Substitute.create(…)`), and so does a path inside the arguments of
 * another path, unless its arguments are all primitives (`@Substitute.save(@Substitute.getUser(1))`), which hold no
 * substitutes. This keeps a printout of many such values small.
 */
const formatting = new Set<object>()
let argumentNesting = 0
const MAX_ARGUMENT_NESTING = 1

const isPrimitive = (value: unknown): boolean => value === null || (typeof value !== 'object' && typeof value !== 'function')

/**
 * The arguments of a call as a path shows them: `(1, { id: 1 })`, objects one level deep, substitutes by their paths
 * (printed under the print guard, so that a substitute among the arguments is never printed in full), errors without
 * their stack (E40, E45), each one bounded (E44, PATH_BOUNDS: a few keys and items, at most 200 characters), at most
 * 10 of them. `entry`: the call whose arguments these are (see above).
 */
export const pathArguments = (args: readonly unknown[] | undefined, entry?: object): string => {
  const values = args ?? []
  if (values.length === 0) return '()'
  if ((entry !== undefined && formatting.has(entry)) || (argumentNesting >= MAX_ARGUMENT_NESTING && !values.every(isPrimitive))) return '(…)'
  if (entry !== undefined) formatting.add(entry)
  argumentNesting++
  try {
    const shown = values.length > PATH_BOUNDS.maxArrayLength ? values.slice(0, PATH_BOUNDS.maxArrayLength) : values
    const texts = withPrintGuard(() => shown.map(value => formatBounded(value, PATH_BOUNDS, false)))
    if (values.length > shown.length) texts.push(`... ${values.length - shown.length} more arguments`)
    return `(${texts.join(', ')})`
  } catch {
    return '(...)'
  } finally {
    argumentNesting--
    if (entry !== undefined) formatting.delete(entry)
  }
}

/*
 * E35: a path shows at most PATH_HEAD + PATH_TAIL + 1 members. A longer one (a list walked 5,000 steps, a fluent
 * builder in a loop) shows the first PATH_HEAD and the last PATH_TAIL, with `…` between them, so that printing a deep
 * chain stays small. Paths are built by walking up the owners (no recursion).
 */
const PATH_HEAD = 3
const PATH_TAIL = 6

const memberOf = (entry: PathEntry): string => entry.key === SELF ? '' : `.${keyToString(entry.key)}`

const pieceOf = (entry: PathEntry): string =>
  entry.kind === 'call' ? `${memberOf(entry)}${pathArguments(entry.argumentList, entry)}` : memberOf(entry)

/**
 * The members from below `ancestor` (the root, when it is undefined) down to `leaf`, as a path shows them:
 * `.logger.child('x')`, `('saved').name`. Empty when there are none. `piece`: how a member is shown (E99, see
 * recordPieces).
 */
export const pathPieces = (leaf: PathEntry | undefined, ancestor?: PathState, piece: (entry: PathEntry) => string = pieceOf): string => {
  const entries: PathEntry[] = []
  for (let entry = leaf; entry !== undefined;) {
    entries.push(entry)
    const parent = entry.parent
    if (parent === ancestor) break
    entry = parent.owner
  }
  entries.reverse()
  const count = entries.length
  if (count <= PATH_HEAD + PATH_TAIL + 1) return entries.map(piece).join('')
  return `${entries.slice(0, PATH_HEAD).map(piece).join('')}.…${entries.slice(count - PATH_TAIL).map(piece).join('')}`
}

/*
 * E99 (R15FE-5): a nested setup through a call with matchers (`io.to(Arg.any()).emit(Arg.all()).returns(true)`) makes
 * every call matching it answer one auto-substitute, whose path shows the matchers (`@Substitute.to(Arg.any{any})`).
 * The calls received by that substitute (and further down) came through the concrete calls that it was handed out to
 * (`io.to('room-a')`): when there is one such call (or several equal ones), its records are shown with it
 * (`@Substitute.to('room-a').emit(...)`), in failure messages and in printouts; when there are several, they keep the
 * path with the matchers, and a failure message says under its listing which calls it was handed out to (sharedNotes).
 * The setups and the substitute itself keep that path: they apply to every matching call. The hand-outs are those that
 * the engine notes for checks through a call with matchers (SubstituteState.configuredAnswers, E81), read only when a
 * record is shown.
 */

/** E99: whether two argument lists of received calls are equal (RecordedArguments.literalsEqual, given by the caller). */
export type SameArguments = (a: readonly unknown[], b: readonly unknown[]) => boolean

/** E99: the calls a shared auto-substitute was handed out to (see handOuts). */
type HandOuts = { readonly calls: readonly HandOut[], readonly more: number }

/**
 * E99: what showing records with the calls that handed their substitutes out needs: how to compare arguments, and the
 * hand-outs found so far. One is made for each printout or failure message (see recordLabels), which records do not
 * change while they are built, so that the hand-outs of each substitute are looked up once there.
 */
export type RecordLabelContext = { readonly same: SameArguments, readonly found: Map<PathEntry, HandOuts> }

export const recordLabelContext = (same: SameArguments): RecordLabelContext => ({ same, found: new Map() })

/** E99: how many calls a note of sharedNotes names, at most. */
const HAND_OUTS_SHOWN = 3

const NO_ARGUMENTS: readonly unknown[] = []
const NO_HAND_OUTS: HandOuts = { calls: [], more: 0 }

/**
 * E99: the received calls (not retracted) that the auto-substitute of a nested setup through a call with matchers was
 * handed out to: the first HAND_OUTS_SHOWN distinct ones (by `context.same`), in the order they were received, and how
 * many calls more there are with other arguments than those (each call is compared with those only, so that this costs
 * no more than HAND_OUTS_SHOWN comparisons per call). None for any other auto-substitute.
 */
export const handOuts = (entry: PathEntry, context: RecordLabelContext): HandOuts => {
  if (entry.specifiesMatchers !== true) return NO_HAND_OUTS
  let found = context.found.get(entry)
  if (found !== undefined) return found
  const calls: HandOut[] = []
  let more = 0
  const answers = entry.parent.configuredAnswers?.(entry.key)
  if (answers !== undefined) {
    const same = context.same
    for (const [record, answer] of answers) {
      if (answer !== entry || record.retracted || record.kind !== 'call') continue
      const args = record.args ?? NO_ARGUMENTS
      if (calls.some(known => same(known.args ?? NO_ARGUMENTS, args))) continue
      if (calls.length < HAND_OUTS_SHOWN) calls.push(record)
      else more++
    }
  }
  found = { calls, more }
  context.found.set(entry, found)
  return found
}

/** E99: how a member is shown in the path of records (see above). */
const recordPieces = (context: RecordLabelContext) => (entry: PathEntry): string => {
  if (entry.specifiesMatchers === true && entry.kind === 'call') {
    const { calls } = handOuts(entry, context)
    if (calls.length === 1) return `${memberOf(entry)}${pathArguments(calls[0].args, entry)}`
  }
  return pieceOf(entry)
}

/**
 * E99: the path of an auto-substitute as its received calls are shown (`@Substitute.to('room-a')`, see above); its path
 * when it is not below a nested setup through a call with matchers.
 */
export const recordPath = (entry: PathEntry, context: RecordLabelContext): string => {
  if (libraryGuard.rootNumbers !== undefined) return `${rootLabel(rootOf(entry))}${pathPieces(entry, undefined, recordPieces(context))}`
  libraryGuard.rootLabels++
  return `@Substitute${pathPieces(entry, undefined, recordPieces(context))}`
}

/** E99: relativePath, as the received calls of `state` are shown (see above). */
export const relativeRecordPath = (state: PathState, ancestor: PathState, context: RecordLabelContext): string => {
  if (state === ancestor) return ''
  const pieces = pathPieces(state.owner, ancestor, recordPieces(context))
  return pieces.startsWith('.') ? pieces.slice(1) : pieces
}

/**
 * E99: for the auto-substitutes of nested setups through calls with matchers on the way to the substitutes whose received
 * calls a failure message lists (`leaves`: their entries; undefined for a root) that calls with different arguments were
 * handed out to, a line each that says so, outermost first: `@Substitute.to(Arg.any{any}) is shared by every call
 * matching it; it was returned to @Substitute.to('room-a'), @Substitute.to('room-b'), @Substitute.to('room-c') and 2 more.`
 */
export const sharedNotes = (leaves: Iterable<PathEntry | undefined>, context: RecordLabelContext): string[] => {
  const notes: string[] = []
  const seen = new Set<PathEntry>()
  for (const leaf of leaves) {
    const shared: PathEntry[] = []
    for (let entry = leaf; entry !== undefined && !seen.has(entry); entry = entry.parent.owner) {
      seen.add(entry)
      if (entry.specifiesMatchers === true) shared.push(entry)
    }
    for (let index = shared.length - 1; index >= 0; index--) {
      const entry = shared[index]
      const { calls, more } = handOuts(entry, context)
      if (calls.length < 2) continue
      const parent = entry.parent.owner === undefined ? undefined : recordPath(entry.parent.owner, context)
      const texts = calls.map(call => `${parent ?? rootLabel(entry.parent)}${memberOf(entry)}${pathArguments(call.args, entry)}`)
      const returnedTo = more > 0 ? `${texts.join(', ')} and ${more} more` : `${texts.slice(0, -1).join(', ')} and ${texts[texts.length - 1]}`
      notes.push(`${recordPath(entry, context)} is shared by every call matching it; it was returned to ${returnedTo}.`)
    }
  }
  return notes
}

/*
 * E52 (R8FE-9): every root substitute prints as `@Substitute`. A failure message whose expected call and a received
 * call print alike, but differ in which substitute is an argument (`use('/admin', @Substitute)` twice), is built again
 * with the roots numbered in the order they appear in it (`@Substitute#1.use('/admin', @Substitute#2)`), see
 * SubstituteException. The numbers belong to that message only, so messages stay the same from run to run.
 * E71 (R11V-4): the numbers are kept on the guard that the copies of the library share (see Guard), so that a
 * substitute of another copy among the arguments (duplicate installs) is numbered in the message, too.
 */

/**
 * E60: how many root labels have been shown so far (in paths and printouts, E71: by any copy), so that a failure message
 * can tell which printed values show a substitute, and reuse the others when it is built again with the roots numbered.
 */
export const rootLabelCount = (): number => libraryGuard.rootLabels

/** How a root substitute is shown: `@Substitute`, or `@Substitute#n` while roots are numbered. */
export const rootLabel = (root: PathState): string => {
  libraryGuard.rootLabels++
  const rootNumbers = libraryGuard.rootNumbers
  if (rootNumbers === undefined) return '@Substitute'
  let number = rootNumbers.get(root)
  if (number === undefined) {
    number = rootNumbers.size + 1
    rootNumbers.set(root, number)
  }
  return `@Substitute#${number}`
}

/** Runs `print` with the roots numbered (see above), and gives how many roots it showed. */
export const withRootNumbers = <T>(print: () => T): { value: T, roots: number } => {
  const outer = libraryGuard.rootNumbers
  const rootNumbers = new Map<object, number>()
  libraryGuard.rootNumbers = rootNumbers
  try {
    const value = print()
    return { value, roots: rootNumbers.size }
  } finally {
    libraryGuard.rootNumbers = outer
  }
}

const rootOf = (entry: PathEntry): PathState => {
  let state = entry.parent
  while (state.owner !== undefined) state = state.owner.parent
  return state
}

/** The path of an auto-substitute: `@Substitute.logger`, `@Substitute.getUser(1)`, `@Substitute('saved')`. */
export const entryPath = (entry: PathEntry): string => {
  if (libraryGuard.rootNumbers !== undefined) return `${rootLabel(rootOf(entry))}${pathPieces(entry)}`
  libraryGuard.rootLabels++
  return `@Substitute${pathPieces(entry)}`
}

/** The path of a substitute (`@Substitute` for a root) relative to one of its ancestors: `logger`, `getUser(1)`, `('x')`. */
export const relativePath = (state: PathState, ancestor: PathState): string => {
  if (state === ancestor) return ''
  const pieces = pathPieces(state.owner, ancestor)
  return pieces.startsWith('.') ? pieces.slice(1) : pieces
}
