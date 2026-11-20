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
 * values looked at (see isLooked). The arguments are walked the first time an operation on a substitute happens during
 * the look (E109: once per look), and each value a looked substitute answers when it answers it.
 */

/** How deep the walk goes into a value, and how far up the prototype chain of an object it looks for a substitute. */
const LOOK_DEPTH = 32
const PROTOTYPE_DEPTH = 8

/** Opens the look of a real call with these arguments (the arguments are not changed), and returns it (see closeLook). */
export const openLook = (args: readonly unknown[]): ArgumentLook => {
  const look: ArgumentLook = { args, reached: undefined, seen: new Set(), outer: libraryGuard.looking }
  libraryGuard.looking = look
  return look
}

/** Ends a look opened with openLook: the look under way before it (if any) applies again. */
export const closeLook = (look: ArgumentLook): void => {
  libraryGuard.looking = look.outer
}

/** The substitutes that a look reaches (see walk): its arguments are walked the first time this is asked. */
const reachedBy = (look: ArgumentLook): Set<object> => {
  if (look.reached === undefined) {
    look.reached = new Set()
    walk(look, look.args)
  }
  return look.reached
}

/**
 * Whether a substitute (its proxy, of any copy) is among the values that the matchers of the looks under way look at: a
 * real call made by code that a matcher runs is matched in a look of its own, during which the values of the look it was
 * made in are still looked at.
 */
export const isLooked = (proxy: unknown): boolean => {
  if (typeof proxy !== 'function') return false
  for (let look = libraryGuard.looking; look !== undefined; look = look.outer) if (reachedBy(look).has(proxy)) return true
  return false
}

/** Notes what a looked substitute answered: the matchers look at it too. */
export const noteLookAnswer = (value: unknown): void => {
  const look = libraryGuard.looking
  if (look === undefined || !isObjectLike(value)) return
  reachedBy(look)
  walk(look, [value])
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

/** Whether a value can be or hold a substitute: anything but a primitive (primitives are not walked). */
const isObjectLike = (value: unknown): boolean => (typeof value === 'object' && value !== null) || typeof value === 'function'

/**
 * Notes the substitutes in `values` on the look (see reachedBy): a value itself, the items of arrays, Maps and Sets, the
 * own enumerable data properties of other objects (no getter is run), and a substitute in the prototype chain of an
 * object. A substitute is never looked into (that would be an operation on it). Every object is walked once (cycles
 * end), LOOK_DEPTH levels deep at most; an object that cannot be listed (a revoked proxy, a throwing trap) is left out.
 * The walk is the library's look: what it makes the code under test's proxies do to substitutes leaves no trace.
 */
const walk = (look: ArgumentLook, values: readonly unknown[]): void => {
  const reached = look.reached!
  // (the first value first)
  const pending: Array<[unknown, number]> = values.map((value): [unknown, number] => [value, 0]).reverse()
  libraryGuard.matching++
  try {
    while (pending.length > 0) {
      const [value, depth] = pending.pop()!
      if (typeof value === 'function') {
        if (isSubstituteProxy(value)) reached.add(value)
        continue
      }
      if (typeof value !== 'object' || value === null || look.seen.has(value)) continue
      look.seen.add(value)
      try {
        let prototype = Object.getPrototypeOf(value)
        for (let level = 0; level < PROTOTYPE_DEPTH && prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype; level++) {
          if (isSubstituteProxy(prototype)) {
            reached.add(prototype)
            break
          }
          prototype = Object.getPrototypeOf(prototype)
        }
        if (depth < LOOK_DEPTH && !ArrayBuffer.isView(value))
          for (const item of itemsOf(value)) if (isObjectLike(item)) pending.push([item, depth + 1])
      } catch { /* (left out) */ }
    }
  } finally {
    libraryGuard.matching--
  }
}

/** What a value holds (see walk). */
const itemsOf = (value: object): unknown[] => {
  if (Array.isArray(value)) return Array.from({ length: value.length }, (_, index) => value[index])
  if (types.isMap(value)) {
    const items: unknown[] = []
    for (const [key, item] of value as Map<unknown, unknown>) items.push(key, item)
    return items
  }
  if (types.isSet(value)) return [...(value as Set<unknown>)]
  const items: unknown[] = []
  for (const key of Object.keys(value)) items.push(dataValue(value, key))
  for (const symbol of Object.getOwnPropertySymbols(value))
    if (Object.prototype.propertyIsEnumerable.call(value, symbol)) items.push(dataValue(value, symbol))
  return items
}

/** The value of an own property, without running a getter (or a get trap of a proxy). */
export const dataValue = (object: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
}
