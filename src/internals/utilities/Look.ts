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
 * happens during the look, by walking the values (each object once, within bounds like those of the search for
 * matchers), and only as far as needed: the walk stops at the substitute asked about, and goes on from there when
 * another one is asked about. A call whose matchers touch no substitute costs one look object and nothing else.
 */

/** How deep the walk goes into an argument, how many items of one object it lists at most, and in all. */
const LOOK_DEPTH = 32
const LOOK_WIDTH = 1024
const LOOK_ITEMS = 32768
/** How far up the prototype chain of an object the walk looks for a substitute (an instance of `class X extends sub.Base`). */
const PROTOTYPE_DEPTH = 8

/** Opens the look of a real call with these arguments (the arguments are not changed), and returns it (see closeLook). */
export const openLook = (args: readonly unknown[]): ArgumentLook => {
  const look: ArgumentLook = {
    args, answers: undefined, taken: 0, pending: undefined, reached: undefined, seen: undefined, budget: LOOK_ITEMS, outer: libraryGuard.looking
  }
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
    if (look.reached !== undefined && look.reached.has(proxy)) return true
    if (walkUntil(look, proxy)) return true
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

// Annex B, in every supported runtime (as in RecordedArguments)
const lookupGetter: (this: object, key: PropertyKey) => Function | undefined = (Object.prototype as any).__lookupGetter__

/**
 * Walks the values of a look (the arguments, then the answers, each one to its end before the next one) until it finds
 * `proxy`, and tells whether it did. It finds the substitutes in a value: the value itself, the items of arrays, Maps
 * and Sets, the own enumerable data properties of other objects (no getter is run), and a substitute in the prototype
 * chain of an object. A substitute is never looked into (that would be an operation on it). Every object is walked
 * once; LOOK_DEPTH, LOOK_WIDTH and the look's budget bound the walk; an object that cannot be listed (a revoked proxy, a
 * throwing trap) is left out. The values still to walk are kept on the look (`pending`, with their depths), so that the
 * next question goes on from where this one stopped, and a walk that comes back (a trap of a proxy among the values
 * touching a substitute) goes on with what is left.
 */
const walkUntil = (look: ArgumentLook, proxy: object): boolean => {
  const reached = look.reached ?? (look.reached = new Set())
  const seen = look.seen ?? (look.seen = new Set())
  const pending = look.pending ?? (look.pending = [])
  for (;;) {
    if (pending.length === 0) {
      const index = look.taken
      const argumentCount = look.args.length
      const answers = look.answers
      if (index >= argumentCount + (answers === undefined ? 0 : answers.length)) return false
      look.taken = index + 1
      pending.push(index < argumentCount ? look.args[index] : answers![index - argumentCount], 0)
    }
    const depth = pending.pop() as number
    const value = pending.pop()
    if (typeof value === 'function') {
      if (isSubstituteProxy(value)) {
        reached.add(value)
        if (value === proxy) return true
      }
      continue
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    try {
      let prototype = Object.getPrototypeOf(value)
      for (let level = 0; level < PROTOTYPE_DEPTH && prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype; level++) {
        if (isSubstituteProxy(prototype)) {
          reached.add(prototype)
          if (prototype === proxy) return true
          break
        }
        prototype = Object.getPrototypeOf(prototype)
      }
      if (depth >= LOOK_DEPTH || ArrayBuffer.isView(value)) continue
      pushItems(look, pending, value, depth + 1)
    } catch {
      // (left out)
    }
  }
}

/** Puts what a value holds (see walkUntil) on the pending values, with their depth, within the look's bounds. */
const pushItems = (look: ArgumentLook, pending: unknown[], value: object, depth: number): void => {
  if (Array.isArray(value)) {
    const length = value.length
    if (length > LOOK_WIDTH || length > look.budget) return
    look.budget -= length
    for (let index = 0; index < length; index++) pending.push(value[index], depth)
    return
  }
  if (types.isMap(value) || types.isSet(value)) {
    const collection = value as Map<unknown, unknown> | Set<unknown>
    const size = types.isMap(value) ? collection.size * 2 : collection.size
    if (size > LOOK_WIDTH || size > look.budget) return
    look.budget -= size
    if (types.isMap(value)) for (const [key, item] of value as Map<unknown, unknown>) pending.push(key, depth, item, depth)
    else for (const item of value as Set<unknown>) pending.push(item, depth)
    return
  }
  const keys = Object.keys(value)
  const symbols = Object.getOwnPropertySymbols(value)
  const count = keys.length + symbols.length
  if (count > LOOK_WIDTH || count > look.budget) return
  look.budget -= count
  const proxy = types.isProxy(value)
  for (let index = 0; index < keys.length; index++) pending.push(dataValue(value, keys[index], proxy), depth)
  for (let index = 0; index < symbols.length; index++)
    if (Object.prototype.propertyIsEnumerable.call(value, symbols[index])) pending.push(dataValue(value, symbols[index], proxy), depth)
}

/** The value of an own property, without running a getter (or a get trap of a proxy). */
const dataValue = (object: object, key: PropertyKey, proxy: boolean): unknown => {
  if (proxy) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  }
  return lookupGetter.call(object, key) === undefined ? (object as any)[key] : undefined
}
