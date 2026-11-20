import { types } from 'util'
import { isSubstituteProxy } from '../../shared/Constants'
import { hashSettings } from './ArgumentHash'
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
 *
 * E109 (R16-ADV-2): the walk is not made again for what is known to hold no substitute.
 * - An argument that the search for matchers, which every call makes (see RecordedArguments.containsMatchers), looked
 *   through in full and found only primitive values, plain objects and arrays in, holds no substitute: it is not walked
 *   (its items count towards the look's budget all the same). That costs nothing that the call does not do anyway, so a
 *   new batch of records passed to every call is not listed twice.
 * - A container that a walk went through to its end (within the bounds, nothing left out) without meeting a substitute,
 *   with at least REMEMBERED_ITEMS items listed inside it, is remembered (weakly, by identity) and not walked again by
 *   later looks: a table or a batch passed to many calls is walked once. A substitute put into such a container later
 *   (or a prototype changed later) is not looked for, as a matcher put into an object that the search for matchers no
 *   longer searches is not found (see RecordedArguments); with the memos off (hashSettings, for tests), nothing is
 *   remembered.
 */

/** How deep the walk goes into an argument, how many items of one object it lists at most, and in all. */
const LOOK_DEPTH = 32
const LOOK_WIDTH = 1024
const LOOK_ITEMS = 32768
/** How far up the prototype chain of an object the walk looks for a substitute (an instance of `class X extends sub.Base`). */
const PROTOTYPE_DEPTH = 8
/** E109: how many items a walk must list inside a container without meeting a substitute for it to be remembered. */
const REMEMBERED_ITEMS = 256
/** E109: the arguments, by position, that the search for matchers can tell about (see RecordedArguments). */
export const CLEAR_ARGUMENTS = 30

/** E109: containers that hold no substitute (see above), with the items that walking them listed. */
const clearContainers = new WeakMap<object, number>()

/**
 * Opens the look of a real call with these arguments (the arguments are not changed), and returns it (see closeLook).
 * E109: `clear`, a bit per argument (the first CLEAR_ARGUMENTS), tells which of them the search for matchers found to
 * hold no substitute, and `items` how many items it listed in each (see RecordedArguments.clearArgumentsOf).
 */
export const openLook = (args: readonly unknown[], clear = 0, items?: readonly number[]): ArgumentLook => {
  let clearItems: number[] | undefined
  if (clear !== 0 && items !== undefined) {
    for (let index = 0; index < args.length && index < CLEAR_ARGUMENTS; index++) {
      const argument = args[index]
      if ((clear & (1 << index)) !== 0 && typeof argument === 'object' && argument !== null) {
        if (clearItems === undefined) clearItems = new Array(args.length).fill(0)
        clearItems[index] = items[index]
      }
    }
  }
  const look: ArgumentLook = {
    args, answers: undefined, taken: 0, pending: undefined, reached: undefined, seen: undefined, budget: LOOK_ITEMS, outer: libraryGuard.looking,
    clear, clearItems, vague: 0, unclear: undefined, walks: 0
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

/** The depth that marks the end of a container among the pending values (see Mark). */
const END = -1

/**
 * E109: the end of a container among the pending values, below what it holds: when the walk comes to it, everything
 * inside the container has been walked. `vague` and `budget` are the look's at its start (see endOf).
 */
type Mark = { container: object, vague: number, budget: number }

/** E109: notes that the walk met something that keeps it from vouching for the containers under way (see Mark). */
const vague = (look: ArgumentLook): void => {
  look.vague = (look.vague ?? 0) + 1
}

/** E109: notes a container that the walk cannot vouch for (see Mark). */
const unclear = (look: ArgumentLook, container: object): void => {
  (look.unclear ?? (look.unclear = new Set())).add(container)
}

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
  // E109: a walk that comes back while another one lists a container (a trap of a proxy, an index getter of an array,
  // touching a substitute) keeps the containers under way from being vouched for
  const walks = look.walks ?? 0
  if (walks > 0) vague(look)
  look.walks = walks + 1
  try {
    return walk(look, proxy)
  } finally {
    look.walks = (look.walks ?? 1) - 1
  }
}

const walk = (look: ArgumentLook, proxy: object): boolean => {
  if (look.pending === undefined) {
    // E109: the arguments that hold no substitute (see openLook) and primitive ones are passed over before anything is
    // made for the walk, so that a look where nothing is left costs nothing more
    const args = look.args
    const clear = look.clear ?? 0
    let index = look.taken
    for (; index < args.length; index++) {
      if (index < CLEAR_ARGUMENTS && (clear & (1 << index)) !== 0) {
        const items = look.clearItems === undefined ? 0 : look.clearItems[index]
        if (items > 0) look.budget = Math.max(0, look.budget - items)
      } else if (isObjectLike(args[index])) break
    }
    look.taken = index
    if (index >= args.length && look.answers === undefined) return false
  }
  const reached = look.reached ?? (look.reached = new Set())
  const seen = look.seen ?? (look.seen = new Set())
  const pending = look.pending ?? (look.pending = [])
  const remember = hashSettings.memos
  for (;;) {
    if (pending.length === 0) {
      const index = look.taken
      const argumentCount = look.args.length
      const answers = look.answers
      if (index >= argumentCount + (answers === undefined ? 0 : answers.length)) return false
      look.taken = index + 1
      if (index < argumentCount) {
        // E109: an argument that the search for matchers found to hold no substitute (see openLook)
        if (index < CLEAR_ARGUMENTS && ((look.clear ?? 0) & (1 << index)) !== 0) {
          const items = look.clearItems === undefined ? 0 : look.clearItems[index]
          if (items > 0) look.budget = Math.max(0, look.budget - items)
          continue
        }
        pending.push(look.args[index], 0)
      } else pending.push(answers![index - argumentCount], 0)
    }
    const depth = pending.pop() as number
    const value = pending.pop()
    if (depth === END) {
      endOf(look, value as Mark | undefined, remember)
      continue
    }
    if (typeof value === 'function') {
      if (isSubstituteProxy(value)) {
        reached.add(value)
        vague(look)
        if (value === proxy) return true
      }
      continue
    }
    if (typeof value !== 'object' || value === null) continue
    if (seen.has(value)) {
      // (walked already: what the walk could not vouch for keeps the containers under way from being vouched for)
      if (look.unclear !== undefined && look.unclear.has(value)) vague(look)
      continue
    }
    seen.add(value)
    // E109: a container remembered to hold no substitute (see above)
    const remembered = remember ? clearContainers.get(value) : undefined
    if (remembered !== undefined) {
      look.budget = Math.max(0, look.budget - remembered)
      continue
    }
    let found = false
    let clean = true
    try {
      let prototype = Object.getPrototypeOf(value)
      for (let level = 0; level < PROTOTYPE_DEPTH && prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype; level++) {
        if (isSubstituteProxy(prototype)) {
          reached.add(prototype)
          vague(look)
          unclear(look, value)
          clean = false
          found = prototype === proxy
          break
        }
        prototype = Object.getPrototypeOf(prototype)
      }
      // (what the object holds is walked later all the same, also when the substitute asked about was its prototype)
      if (depth >= LOOK_DEPTH) {
        vague(look)
        unclear(look, value)
      } else if (!ArrayBuffer.isView(value)) pushItems(look, pending, value, depth + 1, clean, remember)
    } catch {
      // (left out)
      vague(look)
      unclear(look, value)
    }
    if (found) return true
  }
}

/** Whether a value can be or hold a substitute: anything but a primitive (primitives are not walked). */
const isObjectLike = (value: unknown): boolean => (typeof value === 'object' && value !== null) || typeof value === 'function'

/**
 * Puts what a value holds (see walkUntil) on the pending values, with their depth, within the look's bounds: the items
 * that can be or hold a substitute, after a Mark of the container (E109) unless there are none. They are read first and
 * put on the pending values afterwards, so that a walk that comes back meanwhile (see walkUntil) cannot take them.
 * `clean`: no substitute was met in the container's prototype chain.
 */
const pushItems = (look: ArgumentLook, pending: unknown[], value: object, depth: number, clean: boolean, remember: boolean): void => {
  const proxy = types.isProxy(value)
  if (proxy && clean) {
    // E109: a proxy may answer otherwise next time: neither it nor what holds it is vouched for
    leftOut(look, value)
    clean = false
  }
  let inside: unknown[] | undefined
  let listed: number
  if (Array.isArray(value)) {
    const length = value.length
    // (too wide: never walked, whatever the budget)
    if (length > LOOK_WIDTH) return
    if (length > look.budget) return leftOut(look, value)
    look.budget -= length
    listed = length
    for (let index = 0; index < length; index++) {
      const item = value[index]
      if (isObjectLike(item)) (inside ?? (inside = [])).push(item)
    }
  } else if (types.isMap(value) || types.isSet(value)) {
    const collection = value as Map<unknown, unknown> | Set<unknown>
    const isMap = types.isMap(value)
    const size = isMap ? collection.size * 2 : collection.size
    if (size > LOOK_WIDTH) return
    if (size > look.budget) return leftOut(look, value)
    look.budget -= size
    listed = size
    if (isMap) {
      for (const [key, item] of value as Map<unknown, unknown>) {
        if (isObjectLike(key)) (inside ?? (inside = [])).push(key)
        if (isObjectLike(item)) (inside ?? (inside = [])).push(item)
      }
    } else for (const item of value as Set<unknown>) if (isObjectLike(item)) (inside ?? (inside = [])).push(item)
  } else {
    const keys = Object.keys(value)
    const symbols = Object.getOwnPropertySymbols(value)
    const count = keys.length + symbols.length
    if (count > LOOK_WIDTH) return
    if (count > look.budget) return leftOut(look, value)
    look.budget -= count
    listed = count
    for (let index = 0; index < keys.length; index++) {
      const item = dataValue(value, keys[index], proxy)
      if (isObjectLike(item)) (inside ?? (inside = [])).push(item)
    }
    for (let index = 0; index < symbols.length; index++) {
      if (!Object.prototype.propertyIsEnumerable.call(value, symbols[index])) continue
      const item = dataValue(value, symbols[index], proxy)
      if (isObjectLike(item)) (inside ?? (inside = [])).push(item)
    }
  }
  if (inside === undefined) {
    // (nothing inside to walk: it holds no substitute)
    if (clean && remember && listed >= REMEMBERED_ITEMS) clearContainers.set(value, listed)
    return
  }
  // E109: the Mark goes below the items (none for a container whose prototype chain held a substitute, see endOf)
  if (clean) {
    pending.push({ container: value, vague: look.vague ?? 0, budget: look.budget + listed } as Mark, END)
    unclear(look, value)
  }
  for (let index = 0; index < inside.length; index++) pending.push(inside[index], depth)
}

/** E109: a container that the budget left out: what it holds is not known (see Mark). */
const leftOut = (look: ArgumentLook, value: object): void => {
  vague(look)
  unclear(look, value)
}

/**
 * E109: the end of a container (see Mark): when nothing that keeps the walk from vouching for it was met inside it, it
 * holds no substitute, and it is remembered when enough items were listed inside it.
 */
const endOf = (look: ArgumentLook, mark: Mark | undefined, remember: boolean): void => {
  if (mark === undefined || (look.vague ?? 0) !== mark.vague) return
  look.unclear?.delete(mark.container)
  const listed = mark.budget - look.budget
  if (remember && listed >= REMEMBERED_ITEMS) clearContainers.set(mark.container, listed)
}

/** The value of an own property, without running a getter (or a get trap of a proxy). */
const dataValue = (object: object, key: PropertyKey, proxy: boolean): unknown => {
  if (proxy) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  }
  return lookupGetter.call(object, key) === undefined ? (object as any)[key] : undefined
}
