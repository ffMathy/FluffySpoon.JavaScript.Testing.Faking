import { types } from 'util'
import { isSubstituteProxy } from '../../shared/Constants'
import { ArgumentLook, libraryGuard } from './Guard'

/*
 * E100 (R15-ADV-4): what a matcher's look at a real call leaves behind.
 *
 * In a check, a setup's registration and any other matching against recorded calls, a matcher (an Arg.is predicate, a
 * test runner's asymmetricMatch or a sinon matcher's test) looks with nothing recorded at all (E95: `libraryGuard.matching`,
 * see evaluateArgument). When a real call of the code under test is matched against setups with matchers, only the
 * matchers' look at the values being matched leaves no trace: the substitutes among the call's arguments (the argument
 * itself, and substitutes inside it, see walk) and whatever those answer meanwhile, transitively. Every other operation
 * on a substitute while the matchers run is recorded and uses up sequence values as anywhere else, above all the calls
 * that the code under test makes from a callback that a predicate invokes
 * (`db.query(Arg.any(), Arg.is(cb => { cb(null, rows); return true }))`): they are the code under test's own calls.
 *
 * The pass that matches a real call against the setups of its member opens one look for all of its matchers (see
 * CallSubstitutions.match), and the record path asks it whether the substitute an operation is made on is among the
 * values looked at (see isLooked). Which substitutes those are is found out only when an operation on a substitute
 * happens during the look, by walking the values once (each object once, within bounds like those of the search for
 * matchers): a call whose matchers touch no substitute costs one look object and nothing else.
 */

/** How deep the walk goes into an argument, how many items of one object it lists at most, and in all. */
const LOOK_DEPTH = 32
const LOOK_WIDTH = 1024
const LOOK_ITEMS = 32768
/** How far up the prototype chain of an object the walk looks for a substitute (an instance of `class X extends sub.Base`). */
const PROTOTYPE_DEPTH = 8

/** Opens the look of a real call with these arguments (the arguments are not changed), and returns it (see closeLook). */
export const openLook = (args: readonly unknown[]): ArgumentLook => {
  const look: ArgumentLook = { args, answers: undefined, walked: 0, reached: undefined, seen: undefined, budget: LOOK_ITEMS, outer: libraryGuard.looking }
  libraryGuard.looking = look
  return look
}

/** Ends a look opened with openLook: the look under way before it (if any) applies again. */
export const closeLook = (look: ArgumentLook): void => {
  libraryGuard.looking = look.outer
}

/**
 * Whether a substitute (its proxy, of any copy) is among the values that the matchers of the looks under way look at: a
 * real call made by code that a matcher runs is matched in a look of its own, during which the values of the look it was
 * made in are still looked at.
 */
export const isLooked = (proxy: unknown): boolean => {
  if (typeof proxy !== 'function') return false
  for (let look = libraryGuard.looking; look !== undefined; look = look.outer) {
    if (look.walked < look.args.length + (look.answers?.length ?? 0)) walkRest(look)
    if (look.reached !== undefined && look.reached.has(proxy)) return true
  }
  return false
}

/** Notes what a looked substitute answered: the matchers look at it too (it is walked when an operation needs it). */
export const noteLookAnswer = (value: unknown): void => {
  const look = libraryGuard.looking
  if (look === undefined || !((typeof value === 'object' && value !== null) || typeof value === 'function')) return
  if (look.answers === undefined) look.answers = [value]
  else look.answers.push(value)
}

/**
 * An operation on a looked substitute (see isLooked): it runs as the looks of checks do (`peek`: nothing it does leaves a
 * trace, also inside, such as a mimicked substitute it delegates to), and what it answers is looked at from then on.
 */
export const lookedPeek = <T>(peek: () => T): T => {
  let answer: T
  libraryGuard.matching++
  try {
    answer = peek()
  } finally {
    libraryGuard.matching--
  }
  noteLookAnswer(answer)
  return answer
}

/** Walks the values of a look not walked yet. Each one is counted before it is walked, so a walk that comes back (a trap of a proxy among the values touching a substitute) goes on with the next one. */
const walkRest = (look: ArgumentLook): void => {
  if (look.reached === undefined) look.reached = new Set()
  if (look.seen === undefined) look.seen = new Set()
  for (;;) {
    const index = look.walked
    const argumentCount = look.args.length
    const answers = look.answers
    if (index >= argumentCount + (answers?.length ?? 0)) return
    look.walked = index + 1
    walk(look, index < argumentCount ? look.args[index] : answers![index - argumentCount], 0)
  }
}

// Annex B, in every supported runtime (as in RecordedArguments)
const lookupGetter: (this: object, key: PropertyKey) => Function | undefined = (Object.prototype as any).__lookupGetter__

/**
 * Finds the substitutes in a value: the value itself, the items of arrays, Maps and Sets, the own enumerable data
 * properties of other objects (no getter is run), and a substitute in the prototype chain of an object. A substitute is
 * never looked into (that would be an operation on it). Every object is walked once; LOOK_DEPTH, LOOK_WIDTH and the
 * look's budget bound the walk; an object that cannot be listed (a revoked proxy, a throwing trap) is left out.
 */
const walk = (look: ArgumentLook, value: unknown, depth: number): void => {
  if (typeof value === 'function') {
    if (isSubstituteProxy(value)) look.reached!.add(value)
    return
  }
  if (typeof value !== 'object' || value === null || look.seen!.has(value)) return
  look.seen!.add(value)
  try {
    let prototype = Object.getPrototypeOf(value)
    for (let level = 0; level < PROTOTYPE_DEPTH && prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype; level++) {
      if (isSubstituteProxy(prototype)) {
        look.reached!.add(prototype)
        break
      }
      prototype = Object.getPrototypeOf(prototype)
    }
    if (depth >= LOOK_DEPTH || ArrayBuffer.isView(value)) return
    const items = itemsOf(value)
    if (items === undefined || items.length > LOOK_WIDTH || items.length > look.budget) return
    look.budget -= items.length
    for (let index = 0; index < items.length; index++) walk(look, items[index], depth + 1)
  } catch {
    // (left out)
  }
}

/** What a value holds, for the walk (see above). */
const itemsOf = (value: object): readonly unknown[] | undefined => {
  if (Array.isArray(value)) return value.length > LOOK_WIDTH ? undefined : value
  if (types.isMap(value)) return (value as Map<unknown, unknown>).size > LOOK_WIDTH / 2 ? undefined : [...(value as Map<unknown, unknown>).keys(), ...(value as Map<unknown, unknown>).values()]
  if (types.isSet(value)) return (value as Set<unknown>).size > LOOK_WIDTH ? undefined : [...(value as Set<unknown>).values()]
  const keys: PropertyKey[] = Object.keys(value)
  if (keys.length > LOOK_WIDTH) return undefined
  for (const symbol of Object.getOwnPropertySymbols(value)) if (Object.prototype.propertyIsEnumerable.call(value, symbol)) keys.push(symbol)
  const proxy = types.isProxy(value)
  return keys.map(key => {
    if (proxy) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
    }
    return lookupGetter.call(value, key) === undefined ? (value as any)[key] : undefined
  })
}
