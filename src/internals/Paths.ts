import { SELF, keyToString } from './Constants'
import { formatArgument, withPrintGuard } from './utilities'

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
}
export type PathState = { readonly owner?: PathEntry }

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
 * their stack (E40). `entry`: the call whose arguments these are (see above).
 */
export const pathArguments = (args: readonly unknown[] | undefined, entry?: object): string => {
  const values = args ?? []
  if (values.length === 0) return '()'
  if ((entry !== undefined && formatting.has(entry)) || (argumentNesting >= MAX_ARGUMENT_NESTING && !values.every(isPrimitive))) return '(…)'
  if (entry !== undefined) formatting.add(entry)
  argumentNesting++
  try {
    return `(${withPrintGuard(() => values.map(value => formatArgument(value, { depth: 0, colors: false, breakLength: Infinity })).join(', '))})`
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

const pieceOf = (entry: PathEntry): string => {
  const member = entry.key === SELF ? '' : `.${keyToString(entry.key)}`
  return entry.kind === 'call' ? `${member}${pathArguments(entry.argumentList, entry)}` : member
}

/**
 * The members from below `ancestor` (the root, when it is undefined) down to `leaf`, as a path shows them:
 * `.logger.child('x')`, `('saved').name`. Empty when there are none.
 */
export const pathPieces = (leaf: PathEntry | undefined, ancestor?: PathState): string => {
  const entries: PathEntry[] = []
  for (let entry = leaf; entry !== undefined;) {
    entries.push(entry)
    const parent = entry.parent
    if (parent === ancestor) break
    entry = parent.owner
  }
  entries.reverse()
  const count = entries.length
  if (count <= PATH_HEAD + PATH_TAIL + 1) return entries.map(pieceOf).join('')
  return `${entries.slice(0, PATH_HEAD).map(pieceOf).join('')}.…${entries.slice(count - PATH_TAIL).map(pieceOf).join('')}`
}

/*
 * E52 (R8FE-9): every root substitute prints as `@Substitute`. A failure message whose expected call and a received
 * call print alike, but differ in which substitute is an argument (`use('/admin', @Substitute)` twice), is built again
 * with the roots numbered in the order they appear in it (`@Substitute#1.use('/admin', @Substitute#2)`), see
 * SubstituteException. The numbers belong to that message only, so messages stay the same from run to run.
 */
let rootNumbers: Map<PathState, number> | undefined

/** How a root substitute is shown: `@Substitute`, or `@Substitute#n` while roots are numbered. */
export const rootLabel = (root: PathState): string => {
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
  const outer = rootNumbers
  rootNumbers = new Map()
  try {
    const value = print()
    return { value, roots: rootNumbers.size }
  } finally {
    rootNumbers = outer
  }
}

const rootOf = (entry: PathEntry): PathState => {
  let state = entry.parent
  while (state.owner !== undefined) state = state.owner.parent
  return state
}

/** The path of an auto-substitute: `@Substitute.logger`, `@Substitute.getUser(1)`, `@Substitute('saved')`. */
export const entryPath = (entry: PathEntry): string =>
  `${rootNumbers === undefined ? '@Substitute' : rootLabel(rootOf(entry))}${pathPieces(entry)}`

/** The path of a substitute (`@Substitute` for a root) relative to one of its ancestors: `logger`, `getUser(1)`, `('x')`. */
export const relativePath = (state: PathState, ancestor: PathState): string => {
  if (state === ancestor) return ''
  const pieces = pathPieces(state.owner, ancestor)
  return pieces.startsWith('.') ? pieces.slice(1) : pieces
}
