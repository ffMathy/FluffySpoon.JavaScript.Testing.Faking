import { inspect, InspectOptions, types } from 'util'

import { constants, isSubstituteProxy, substituteMarker } from '../shared'
import { ArgumentHashes, AutoEntry, Substitution, SubstituteState } from './SubstituteState'
import { pathArguments, relativePath } from './Paths'
import { CallRecord, currentSequence, pairReadings, retract } from './CallRecord'
import { Frame, StackHolder, captureStack, currentFrame, sameExpression } from './CallSite'
import { RecordedArguments, isComparing } from './RecordedArguments'
import { MAX_LISTED_CALLS, SubstituteException } from './SubstituteException'
import {
  assertCall, assertPropertyRead, assertSet, deferDanglingCheck, settle, validateExpectedCount, DeferredAssertion, ExpectedCount
} from './Assertions'
import {
  ContextMethod, FunctionHelperKey, INTERNAL, SELF, SpecialProperty, StringAssertionKey, SubstitutionMethod,
  answersOnlyItself, contextMethodOf, isForeignSymbol, isFunctionHelperKey, isProtocolKey, isSpecialProperty, isStringAssertionKey, keyToString, substitutionMethodOf
} from './Constants'
import { describeOtherReading, formatArguments, formatValue, isPrinting, withPrintGuard } from './utilities'

/*
 * The proxies handed out by the library are thin translators onto SubstituteState.
 *
 * A member access cannot know yet what it is part of: `sub.add` may be a property read, the callee of
 * `sub.add(1, 2)`, the start of a setup (`sub.add(1, 2).returns(3)`) or of a nested use
 * (`sub.logger.info('x')`). Every proxy is therefore lazy: a read is recorded as a property read and
 * returns a callable handle. Invoking the handle turns that read into an invocation. Accessing a
 * substitution method (`returns`, ...) on a handle turns the expression into a setup and retracts the
 * records of the expression. Accessing anything else uses the auto-substitute behind the handle.
 */

type Printer = (options?: InspectOptions) => string
/**
 * What a substitute proxy stands for: a substitute itself (its state), the result of reading an unconfigured member
 * (an AutoEntry of kind 'get', a "member" handle) or the result of an unconfigured call (an AutoEntry of kind 'call').
 */
type Face = SubstituteState | AutoEntry

const TAKE_PENDING_READ = Symbol('take pending read')
type ReadSource = typeof TAKE_PENDING_READ | CallRecord | undefined

/**
 * The target of the short-lived proxies (assertions, configure views, deferred reads). util.inspect inspects the
 * target of a proxy (it does not trigger traps), so the target carries the printer as its inspect.custom hook.
 * It is a bound function: it can be constructed (E23), and it has no non-configurable `prototype`, so that the
 * traps can hide its own properties (E25, see viewTraps).
 */
// E40: a neutral name for util.inspect without custom inspection (see returnThis)
const viewFunction = function substitute() { }
const viewTarget = (print: Printer): any => {
  const target = viewFunction.bind(undefined)
  Object.defineProperty(target, inspect.custom, {
    value: (_depth: number, options?: InspectOptions) => print(options),
    configurable: true
  })
  return target
}

/**
 * E25: the views (assertions, configure views, bound functions, members configured both as a property and as a method)
 * have no properties of their own, and refuse to be frozen, sealed or given properties, with a usage error that names
 * the operation (a later read could not answer as usual otherwise). Substitutes themselves support it (see faceHandler).
 */
const viewChangeError = (operation: string, print: Printer, start: Function) => SubstituteException.generic(
  `${operation} cannot be used on ${print(undefined)}: the values the library hands out for assertions, setups, ` +
  `bound functions and members configured both as a property and as a method cannot be frozen, sealed or given ` +
  `properties of their own. Substitutes and their auto-substitutes can.`,
  start
)

const viewTraps = (print: Printer, onUse?: () => void): ProxyHandler<any> => ({
  defineProperty: function defineProperty() {
    onUse?.()
    throw viewChangeError('Object.defineProperty()', print, defineProperty)
  },
  preventExtensions: function preventExtensions() {
    onUse?.()
    throw viewChangeError('Object.preventExtensions() (or Object.freeze(), Object.seal())', print, preventExtensions)
  },
  deleteProperty: () => true,
  ownKeys: () => [],
  getOwnPropertyDescriptor: () => undefined
})

/**
 * A short-lived proxy (see viewTarget and viewTraps). `onUse` (E48): told when the code changes the view (which is a
 * usage error), as the handler's own traps are told when it is used.
 */
const createView = (print: Printer, handler: ProxyHandler<any>, onUse?: () => void): any =>
  new Proxy(viewTarget(print), { ...viewTraps(print, onUse), ...handler })

// ---- printing ---------------------------------------------------------------------------------

const memberLabel = (key: PropertyKey) => key === SELF ? 'call' : keyToString(key)

/** A member relative to the printed substitute: `info`, `logger.info`, `getUser(1).name` ('' for the substitute itself). */
const memberWithin = (prefix: string, key: PropertyKey): string =>
  key === SELF ? prefix : prefix === '' ? keyToString(key) : `${prefix}.${keyToString(key)}`

/**
 * E35: a printout lists all received calls and setups of the substitute itself, and at most this many of each of its
 * auto-substitutes (as messages list at most this many calls, D23), then "… and N more".
 */
const MAX_NESTED_LINES = MAX_LISTED_CALLS

/** The items to show (all of the printed substitute's own, the first MAX_NESTED_LINES of the others), and how many are left out. */
const capNested = <T extends { owner: SubstituteState }>(items: T[], state: SubstituteState): { shown: T[], hidden: number } => {
  const shown: T[] = []
  let nested = 0
  for (const item of items) {
    if (item.owner === state) shown.push(item)
    else if (nested++ < MAX_NESTED_LINES) shown.push(item)
  }
  return { shown, hidden: items.length - shown.length }
}

const andMore = (hidden: number): string[] => hidden > 0 ? [`    … and ${hidden} more`] : []

/**
 * The received calls and setups of a substitute and (E24) of its auto-substitutes, which are shown under their paths
 * relative to it (`logger.info('started')`, `logger.level => returns(3)`): the calls in the order they were made, the
 * setups in the order they were configured. An empty list means that there is nothing to show.
 * E35: the auto-substitutes are visited without recursion, at most MAX_NESTED_LINES of their calls and setups are
 * shown, and only the paths of the lines shown are built (bounded, see Paths), so a deep chain of auto-substitutes (a
 * list walk, a fluent builder in a loop) prints quickly and small.
 */
const stateLines = (state: SubstituteState, colors: boolean): string[] => {
  const records: Array<{ record: CallRecord, owner: SubstituteState }> = []
  const substitutions: Array<{ substitution: Substitution, owner: SubstituteState }> = []
  const pending: SubstituteState[] = [state]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const record of current.records) records.push({ record, owner: current })
    // 'auto' substitutions only register an auto-substitute for a nested setup, which is shown under its path
    for (const substitution of current.substitutions()) if (substitution.method !== 'auto') substitutions.push({ substitution, owner: current })
    for (const entry of current.entries()) {
      const nested = entry.materializedState
      if (nested !== undefined) pending.push(nested)
    }
  }
  const prefixes = new Map<SubstituteState, string>()
  const prefixOf = (owner: SubstituteState): string => {
    let prefix = prefixes.get(owner)
    if (prefix === undefined) {
      prefix = relativePath(owner, state)
      prefixes.set(owner, prefix)
    }
    return prefix
  }

  const lines: string[] = []
  // D26: an invocation through call/apply is shown once, as its direct-call reading
  const directReadings = new Set(records.filter(({ record }) => record.directReading === true).map(({ record }) => record))
  const shown = records.filter(({ record }) => record.twin === undefined || record.directReading === true || !directReadings.has(record.twin))
  if (shown.length > 0) {
    lines.push('  received:')
    shown.sort((a, b) => a.record.seq - b.record.seq)
    const capped = capNested(shown, state)
    for (const { record, owner } of capped.shown) {
      const name = memberWithin(prefixOf(owner), record.key)
      const suffix = record.kind === 'call'
        ? formatArguments(record.args, colors) + describeOtherReading(record, colors)
        : record.kind === 'set' ? ` = ${formatValue(record.args?.[0], colors)}` : ''
      // E23: a construction of the substitute itself names it: `new @Substitute(url)`
      lines.push(`    ${record.constructed === true ? `new ${name === '' ? state.path : name}` : name}${suffix}`)
    }
    lines.push(...andMore(capped.hidden))
  }
  if (substitutions.length > 0) {
    lines.push('  configured:')
    substitutions.sort((a, b) => a.substitution.order - b.substitution.order)
    const capped = capNested(substitutions, state)
    for (const { substitution, owner } of capped.shown) {
      const name = memberWithin(prefixOf(owner), substitution.key)
      const args = substitution.kind === 'call' ? formatArguments(substitution.args?.value, colors) : ''
      const values = substitution.values.map(value => formatValue(value, colors)).join(', ')
      lines.push(`    ${name}${args} => ${substitution.method}(${values})`)
    }
    lines.push(...andMore(capped.hidden))
  }
  return lines
}

const printState = (state: SubstituteState, colors: boolean): string => {
  if (isPrinting()) return state.path
  return withPrintGuard(() => {
    const lines = stateLines(state, colors)
    return `${state.path} {${lines.length > 0 ? '\n' + lines.join('\n') : ''}\n}`
  })
}

/**
 * E24: an auto-substitute prints as its path (`@Substitute.logger`), followed by its received calls and setups when it
 * has any, like a substitute. Inside another printout (an argument in a message, a nested value) only the path is shown.
 */
const printFace = (face: Face, colors: boolean): string => {
  if (!(face instanceof AutoEntry)) return printState(face, colors)
  const state = face.materializedState
  if (state === undefined || isPrinting()) return face.path
  return withPrintGuard(() => {
    const lines = stateLines(state, colors)
    return lines.length === 0 ? face.path : `${face.path} {\n${lines.join('\n')}\n}`
  })
}

const special = (property: SpecialProperty, print: Printer, internal: unknown): any => {
  switch (property) {
    case 'then':
      return undefined // substitutes are not thenables, so they can be awaited and resolved
    case substituteMarker:
      return true
    case INTERNAL:
      return internal
    case inspect.custom:
      return (_depth: number, options?: InspectOptions) => print(options)
    default: // toJSON, Symbol.toPrimitive
      return () => print(undefined)
  }
}

const colorsOf = (options?: InspectOptions) => options?.colors === true

// ---- substitutes and auto-substitutes ---------------------------------------------------------

export const createSubstitute = (): any => {
  const state = new SubstituteState()
  const proxy = createFaceProxy(state)
  rootProxies.set(state, proxy)
  return proxy
}

const entryProxy = (entry: AutoEntry): any => {
  if (entry.proxy === undefined) entry.proxy = createFaceProxy(entry)
  return entry.proxy
}

const faceState = (face: Face): SubstituteState => face instanceof AutoEntry ? face.state : face

/*
 * D25: chains. `sub.a.b(1).returns(2)` reads `a`, reads `b` on the auto-substitute that read handed out, and
 * so on; a setup or an assertion at the end of the chain retracts the records of the whole expression. A step
 * continues the expression of the operation that handed out its proxy when that operation was the last one of
 * all (adjacency) and both come from the same function in the same file (their first stack frames outside the
 * library). So a value that the code under test got from a substitute, and returned, does not take the code under
 * test's call with it when the test configures or checks that value. Only when neither operation has a stack frame
 * (Error.stackTraceLimit = 0, or structured call sites cannot be read) does adjacency alone decide (E2).
 * The frame of an operation that records something is read from its record's call site (CallRecord.frame); the
 * frame of one that records nothing (a setup, an assertion) from a capture of its own, and only when it is needed.
 */

/** The frame of the current operation, read only when it is needed (the trap function is the stack start). */
const frameAt = (stackStart: Function) => (): Frame | null => currentFrame(stackStart)

/** The candidate (an adjacent hand-out) if the current operation continues its expression. */
const continuedChain = (candidate: CallRecord | undefined, current: () => Frame | null): CallRecord | undefined => {
  if (candidate === undefined) return undefined
  return sameExpression(candidate.frame, current()) ? candidate : undefined
}

/** Links a new record to the candidate if it continues the candidate's expression (the record has its frame). */
const linkChain = (record: CallRecord, candidate: CallRecord | undefined): CallRecord => {
  if (candidate !== undefined && sameExpression(candidate.frame, record.frame)) record.chainPrevious = candidate
  return record
}

const adjacentHandOut = (face: Face): CallRecord | undefined => face.adjacentHandOut()

/**
 * E39: a read or a call that answers with a configured value that is a substitute of this copy of the library
 * (`app.getCalc().returns(calc)`, `app.logger.returns(logger)`, a mimicked instance's substitute) hands that substitute
 * out, as an unconfigured one hands out its auto-substitute, so that a setup or a check chained to it in the same
 * expression (`app.getCalc().add(1, 2).returns(3)`, `app.logger.received(1).info('x')`) leaves out the read or call
 * that led to it (D25). Returns the value.
 *
 * Not when the value is the substitute that was read or called itself (`map.set(Arg.all()).returns(map)`, a fluent
 * `return this`): the test holds that substitute anyway, and its next statement (`map.received(1).set('b', 2)` after
 * `expect(map.set('b', 2)).toBe(map)`) must not take the call made in the statement before with it.
 */
const handOutConfigured = <T>(value: T, record: CallRecord, owner: SubstituteState): T => {
  if (isFaceProxy(value)) {
    const face = (value as any)[INTERNAL] as Face | undefined
    if (face !== undefined && (face instanceof AutoEntry ? face.materializedState : face) !== owner) face.handOut(record)
  }
  return value
}

/*
 * D30: a substitute, and every auto-substitute (one per distinct unconfigured call), is a proxy. To keep them small,
 * all of them share one handler, and the target of each one is a function that returns its face. util.inspect looks
 * at the target of a proxy without triggering traps, so the printer is inherited from a shared prototype.
 */
type FaceTarget = () => Face

const faceOfInspected = (value: any): Face | undefined => {
  try {
    return typeof value === 'function' && !types.isProxy(value) ? value() : value[INTERNAL]
  } catch {
    return undefined
  }
}

const faceTargetPrototype = Object.create(Function.prototype, {
  [inspect.custom]: {
    value: function (this: unknown, _depth: number, options?: InspectOptions) {
      const face = faceOfInspected(this)
      return face === undefined ? '' : printFace(face, colorsOf(options))
    },
    configurable: true
  }
})

/*
 * E55 (R9-ADV-2): the library tells its own proxies (substitutes and auto-substitutes of this copy) apart from other
 * values by the prototype of their target, faceTargetPrototype, which costs nothing per auto-substitute. The code under
 * test can replace that prototype (`Object.setPrototypeOf(sub, Repo.prototype)`, the usual trick to pass an
 * `instanceof Repo` check); the proxies for which it did that are recognised by identity instead (see the
 * setPrototypeOf trap), so they keep every symbol API, isSubstituteProxy, printing and JSON. An object that merely
 * inherits from a substitute (E46) is never one of them.
 */
const reprototyped = new WeakSet<object>()
let reprototypedCount = 0

/** The proxies of the substitutes themselves (an auto-substitute keeps its own, AutoEntry.proxy). */
const rootProxies = new WeakMap<SubstituteState, object>()

const proxyOf = (face: Face): object | undefined => face instanceof AutoEntry ? face.proxy : rootProxies.get(face)

/** Whether the value is a substitute or an auto-substitute of this copy of the library (see above). */
const isFaceProxy = (value: unknown): value is Function => typeof value === 'function' &&
  (Object.getPrototypeOf(value) === faceTargetPrototype || (reprototypedCount > 0 && reprototyped.has(value)))

/*
 * E25: Object.freeze / seal / preventExtensions and Object.defineProperty work on a substitute. The target of its proxy
 * is a bound function whose only own properties, `length` and `name`, the proxy hides (ownKeys and
 * getOwnPropertyDescriptor report none). The first such change removes them from the target ("takes it over"), so that
 * from then on the target's own properties are exactly the ones the code under test defined, and the proxy's answers
 * cannot conflict with them (a frozen target without own properties constrains nothing). A defined property is a real
 * property: reads and assignments use it, and are not recorded. Everything else works as before, frozen or not.
 * Taking over is rare, so the hot path only checks a counter.
 */
const ownedTargets = new WeakSet<object>()
let ownedTargetCount = 0
const hasOwnProperty = Object.prototype.hasOwnProperty

const takeOver = (target: FaceTarget): void => {
  if (ownedTargets.has(target)) return
  delete (target as any).length
  delete (target as any).name
  ownedTargets.add(target)
  ownedTargetCount++
}

const isOwned = (target: FaceTarget): boolean => ownedTargetCount > 0 && ownedTargets.has(target)

/** Whether the code under test defined the property on the substitute (E25). */
const isDefined = (target: FaceTarget, property: PropertyKey): boolean => isOwned(target) && hasOwnProperty.call(target, property)

/*
 * E11: capturing a call site is what an operation costs most, and the cost grows with every frame between the capture
 * and the trap function it starts from, so the traps capture it themselves, and only for operations that are recorded.
 */
const faceHandler: ProxyHandler<FaceTarget> = {
  get: function get(target: FaceTarget, property: PropertyKey, receiver: unknown) {
    if (isDefined(target, property)) return Reflect.get(target, property, receiver)
    if ((typeof property === 'symbol' || answersOnlyItself(property) || isPrinting() || isComparing()) && inheritsFromSubstitute(receiver)) {
      const inherited = inheritedMember(target(), property, receiver)
      if (inherited !== AS_USUAL) return inherited
    }
    const face = target()
    const value = faceGet(face, property, get)
    return value === REAL_READ ? realGet(faceState(face), property, adjacentHandOut(face), captureStack(get)) : value
  },
  set: function set(target: FaceTarget, property: PropertyKey, value: unknown, receiver: unknown) {
    if (isDefined(target, property)) return Reflect.set(target, property, value, receiver)
    if (inheritsFromSubstitute(receiver)) return defineOnReceiver(receiver, property, value)
    faceSet(target(), property, value, set)
    return true
  },
  // E26: `key in sub` (see faceHas)
  has: (target: FaceTarget, property: PropertyKey) => isDefined(target, property) || faceHas(target(), property),
  defineProperty: (target: FaceTarget, property: PropertyKey, descriptor: PropertyDescriptor) => {
    takeOver(target)
    return Reflect.defineProperty(target, property, descriptor)
  },
  preventExtensions: (target: FaceTarget) => {
    takeOver(target)
    return Reflect.preventExtensions(target)
  },
  // E55: a substitute whose prototype the code under test replaced is recognised by identity from then on
  setPrototypeOf: (target: FaceTarget, prototype: object | null) => {
    if (!Reflect.setPrototypeOf(target, prototype)) return false
    const proxy = proxyOf(target())
    if (proxy !== undefined && !reprototyped.has(proxy)) {
      reprototyped.add(proxy)
      reprototypedCount++
    }
    return true
  },
  deleteProperty: (target: FaceTarget, property: PropertyKey) => !isOwned(target) || Reflect.deleteProperty(target, property),
  // E51: a substitute that mimicks an instance has the instance's enumerable own keys (see mimickedKeys)
  ownKeys: (target: FaceTarget) => isOwned(target) ? Reflect.ownKeys(target) : mimickedKeys(target()),
  getOwnPropertyDescriptor: (target: FaceTarget, property: PropertyKey) =>
    isOwned(target) ? Reflect.getOwnPropertyDescriptor(target, property) : mimickedDescriptor(target(), property),
  apply: function apply(target: FaceTarget, thisArg: unknown, args: any[]) {
    const face = target()
    return faceApply(face, { thisArg, explicit: false }, args, apply, recordsInvocation(face) ? captureStack(apply) : undefined)
  },
  // E23: `new sub(...)` and `new sub.Member(...)` are invocations, recorded as constructions (see faceApply)
  construct: function construct(target: FaceTarget, args: any[], newTarget: Function) {
    const face = target()
    return constructed(faceApply(face, constructing(newTarget), args, construct, recordsInvocation(face) ? captureStack(construct) : undefined))
  }
}

/**
 * E36: whether an assignment reached the substitute through the prototype chain of another object: an instance of a
 * class that extends a substitute (`this.name = name` in its constructor, whose prototype chain leads to `sub.Base` or
 * its `prototype`), or such a class itself (a static field). The receiver is then not a substitute of this copy.
 * E55: decided by identity, not by the prototype, for a substitute whose prototype was replaced (see isFaceProxy).
 */
const inheritsFromSubstitute = (receiver: unknown): receiver is object =>
  (typeof receiver === 'object' && receiver !== null) || (typeof receiver === 'function' && !isFaceProxy(receiver))

const AS_USUAL: unique symbol = Symbol('as usual')

/**
 * E46: what an object that inherits from a substitute (see inheritsFromSubstitute) reads for one of the members that a
 * substitute answers in its own way only for itself (see answersOnlyItself): such an object is an ordinary object to
 * the library and to the code that looks at it, so it reads nothing for the library's own symbols (it is no
 * substitute, matcher or library value: `isSubstituteProxy`, the matcher brand) and for the printing and conversion
 * members (then, toJSON, Symbol.toPrimitive, util.inspect.custom): JSON.stringify, util.inspect, String(), template
 * strings and pretty-format see its own fields. toString and valueOf are those of Object.prototype (Function.prototype's
 * toString for a class that extends a substitute), as for an empty base class, unless the substitute configures or
 * mimicks them (then AS_USUAL: the read is a member read like any other). Nothing is recorded.
 * While the library prints (an argument in a message or a path), any read that reaches a substitute through such an
 * object reads undefined and is not recorded either: util.inspect probes the objects it prints (Node.js 22 reads
 * `href`), and printing never records anything.
 * E57 (R9V-2): the same while the library compares arguments (util.isDeepStrictEqual: Node.js 20 probes the private
 * kKeyType of KeyObjects, and a truthy answer made it call `equals()` as well; then the `href`, `protocol` and `auth` of
 * URLs), and, at any time, for a symbol of the code under test or of the runtime that is not registered (Symbol.for):
 * such a lookup only passes through the substitute. It reads undefined and records nothing, unless the substitute
 * configures or mimicks that key. Other registered symbols read as usual.
 */
const inheritedMember = (face: Face, property: PropertyKey, receiver: unknown): unknown => {
  const conversion = property === 'toString' || property === 'valueOf'
  if (!conversion) {
    if (answersOnlyItself(property) || isPrinting() || isComparing()) return undefined
    if (!isForeignSymbol(property)) return AS_USUAL
  }
  const state = face instanceof AutoEntry ? face.materializedState : face
  if (state !== undefined && configuresMember(state, property)) return AS_USUAL
  if (!conversion) return undefined
  return property === 'toString' && typeof receiver === 'function' ? Function.prototype.toString : (Object.prototype as any)[property]
}

/*
 * E50 (R8FE-6): converting a substitute to a primitive (template strings, String(), `+`, comparisons) gives the
 * printout, unless the test configured or mimicked the conversion: then it follows JavaScript's OrdinaryToPrimitive,
 * as an ordinary object with those methods would. A mimicked instance's Symbol.toPrimitive (a Date, for example) is used
 * as it is. Otherwise toString() and valueOf() are tried in the order of the hint ('string': toString first; 'number'
 * and 'default': valueOf first), each only if it is configured (a call setup that matches `()`, or a property setup
 * whose value is a function) or mimicked (a method of the instance other than Object.prototype's and
 * Function.prototype's); the first primitive result is the answer. Such a call is recorded, as a call made by the code
 * under test (`id.received(1).toString()`). When none answers with a primitive, the printout is the answer.
 */
const NO_PRIMITIVE: unique symbol = Symbol('no primitive')

const isPrimitive = (value: unknown): boolean => value === null || (typeof value !== 'object' && typeof value !== 'function')

const isDefaultConversion = (method: unknown): boolean =>
  method === Object.prototype.toString || method === Object.prototype.valueOf || method === Function.prototype.toString

/** The Symbol.toPrimitive of a substitute or an auto-substitute (see above). */
const toPrimitiveOf = (face: Face): Function => function toPrimitive(this: unknown, hint: unknown) {
  const state = face instanceof AutoEntry ? face.materializedState : face
  if (state !== undefined && (state.mimicked !== undefined || state.isConfiguredKey('toString') || state.isConfiguredKey('valueOf'))) {
    const value = configuredPrimitive(state, hint, this, toPrimitive)
    if (value !== NO_PRIMITIVE) return value
  }
  return printFace(face, false)
}

const configuredPrimitive = (state: SubstituteState, hint: unknown, receiver: unknown, start: Function): unknown => {
  const instance = state.mimicked?.instance
  if (instance !== undefined && (isSubstituteProxy(instance) || hasMember(instance, Symbol.toPrimitive))) {
    const convert = instance[Symbol.toPrimitive]
    if (typeof convert === 'function') return Reflect.apply(convert, instance, [hint])
  }
  for (const key of hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString']) {
    const value = configuredConversion(state, key, instance, receiver, start)
    if (value !== NO_PRIMITIVE && isPrimitive(value)) return value
  }
  return NO_PRIMITIVE
}

/** The result of a configured or mimicked toString() / valueOf(), called as the code under test would (see above). */
const configuredConversion = (state: SubstituteState, key: string, instance: any, receiver: unknown, start: Function): unknown => {
  const property = state.propertySubstitution(key)
  if (property !== undefined) {
    state.addRecord('get', key, undefined, captureStack(start))
    const method = execute(property)
    return typeof method === 'function' ? Reflect.apply(method, receiver, []) : NO_PRIMITIVE
  }
  const call = state.findCallSubstitution(key, new ArgumentHashes([]))
  const mimicked = instance !== undefined && !isSubstituteProxy(instance) && hasMember(instance, key) &&
    typeof instance[key] === 'function' && !isDefaultConversion(instance[key])
  if ((call === undefined || call.method === 'auto') && !mimicked) return NO_PRIMITIVE
  return resolveCall(state, key, [], state.addRecord('call', key, [], captureStack(start)), NO_SELF)
}

/*
 * E51 (R8FE-2): a substitute that mimicks an instance enumerates like it: Object.keys, Object.entries, spread, for-in
 * and Object.assign see the instance's enumerable own keys (reported as configurable properties, so that no Proxy
 * invariant can conflict with the substitute's own target, E25), and reading them goes through the substitute as
 * usual (recorded, configured values first). JSON.stringify uses the instance's toJSON, or serializes the instance
 * (see toJSONOf). A substitute that mimicks another substitute, and one that the code under test has frozen or given
 * properties (E25), keep their own keys.
 */
const mimickedInstanceOf = (face: Face): any => {
  const state = face instanceof AutoEntry ? face.materializedState : face
  const instance = state?.mimicked?.instance
  return instance === undefined || isSubstituteProxy(instance) ? undefined : instance
}

const isEnumerableOwn = (instance: object, key: PropertyKey): boolean => Object.prototype.propertyIsEnumerable.call(instance, key)

const mimickedKeys = (face: Face): Array<string | symbol> => {
  const instance = mimickedInstanceOf(face)
  return instance === undefined ? [] : Reflect.ownKeys(instance).filter(key => isEnumerableOwn(instance, key))
}

const mimickedDescriptor = (face: Face, key: PropertyKey): PropertyDescriptor | undefined => {
  const instance = mimickedInstanceOf(face)
  if (instance === undefined || !isEnumerableOwn(instance, key)) return undefined
  const descriptor = Reflect.getOwnPropertyDescriptor(instance, key)
  return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
}

/** E51: toJSON of a substitute: the mimicked object's (its own toJSON, or the object itself), otherwise the printout. */
const toJSONOf = (face: Face): Function => {
  const instance = mimickedInstanceOf(face)
  if (instance !== undefined && typeof instance === 'object') {
    const toJSON = instance.toJSON
    return typeof toJSON === 'function' ? (key: unknown) => Reflect.apply(toJSON, instance, [key]) : () => instance
  }
  return () => printFace(face, false)
}

/** Whether a member has a setup of its own (as a property or as a method), or the mimicked instance has it. */
const configuresMember = (state: SubstituteState, key: PropertyKey): boolean =>
  state.propertySubstitution(key) !== undefined ||
  state.hasCallSubstitutions(key) ||
  (state.mimicked !== undefined && hasMember(state.mimicked.instance, key))

/**
 * E36: what an ordinary prototype without the property does with such an assignment: the property is created on the
 * object that was assigned to (or set, if it is there by now). Nothing is recorded.
 */
const defineOnReceiver = (receiver: object, property: PropertyKey, value: unknown): boolean => {
  const existing = Reflect.getOwnPropertyDescriptor(receiver, property)
  if (existing !== undefined) return 'value' in existing && existing.writable === true && Reflect.defineProperty(receiver, property, { value })
  return Reflect.defineProperty(receiver, property, { value, writable: true, enumerable: true, configurable: true })
}

// bound to the face: a bound function is smaller than a closure and its context
/*
 * E40 (R7FE-7): util.inspect without custom inspection (node:assert's messages) shows the target of a proxy, a bound
 * function named after the function it is bound to. A neutral name: `[Function: bound substitute]`. (Naming each target
 * after its path, or renaming the function with defineProperty, costs memory for every auto-substitute: 160 to 240
 * bytes per unconfigured call, measured on Node.js 22 and 24.)
 */
const returnThis = function substitute(this: Face): Face { return this }

/**
 * E26: `key in sub` (and Reflect.has) is true for a key with a setup (as a property or a method, or a nested setup
 * through it) and for a key that the mimicked instance has (`key in instance`), and false otherwise: for unconfigured
 * keys, protocol keys and the library's own special members (then, inspect.custom, ...). Nothing is recorded.
 */
const faceHas = (face: Face, key: PropertyKey): boolean => {
  if (isSpecialProperty(key)) return false
  const state = face instanceof AutoEntry ? face.materializedState : face
  if (state === undefined) return false
  // E35: O(1); the 'auto' registrations of nested setups and matcher chains are not setups (see isConfiguredKey)
  return state.isConfiguredKey(key) || (state.mimicked !== undefined && hasMember(state.mimicked.instance, key))
}

const createFaceProxy = (face: Face): any => {
  const target: FaceTarget = returnThis.bind(face)
  Object.setPrototypeOf(target, faceTargetPrototype)
  return new Proxy(target, faceHandler)
}

/**
 * D22: the substitution symbols configure a member or a call. On a substitute itself they cannot mean anything
 * (and would otherwise silently turn into a member keyed by the symbol), so they are a usage error. The string
 * names stay ordinary members there (a member called `returns` is allowed, D11).
 */
const isSubstitutionSymbol = (property: PropertyKey): boolean =>
  typeof property === 'symbol' && substitutionMethodOf(property) !== undefined

const substitutionOnSubstituteError = (property: PropertyKey, start: Function) => SubstituteException.generic(
  `[${substitutionMethodOf(property)}] cannot be used on a substitute itself: it configures a member or a call, ` +
  `e.g. sub.member[${substitutionMethodOf(property)}](value) or sub.method(1)[${substitutionMethodOf(property)}](value). ` +
  `If this substitute is the value of a call that is already configured, configure that call again through sub[configure]().`,
  start
)

/** What faceGet answers when the access is a real read of the member, which the trap records (see faceHandler). */
const REAL_READ: unique symbol = Symbol('real read')

/** A member access on a substitute or an auto-substitute, unless it is a real read (then REAL_READ). */
const faceGet = (face: Face, property: PropertyKey, stackStart: Function): any => {
  if (property === Symbol.toPrimitive) return toPrimitiveOf(face)
  if (property === 'toJSON') return toJSONOf(face)
  if (isSpecialProperty(property)) return special(property, options => printFace(face, colorsOf(options)), face)

  const candidate = adjacentHandOut(face)
  // for the operations that create no record: compared with the frame of this access
  const chainHead = () => continuedChain(candidate, frameAt(stackStart))

  if (!(face instanceof AutoEntry)) {
    if (isSubstitutionSymbol(property)) throw substitutionOnSubstituteError(property, stackStart)
  } else {
    const entry = face
    const stringCheck = entry.kind === 'call' && isStringAssertionKey(entry.key)
    // E48: `sub.received(n)` is followed by something (a check, or a setup of a member called received)
    if (stringCheck) useStringCheck(entry)
    const method = substitutionMethodOf(property)
    if (method !== undefined) return setupFunction(entry, method, chainHead(), stackStart)

    // D11: `sub.received(n)` followed by a member access other than a substitution method is an assertion.
    if (stringCheck) {
      const assertion = resolveStringAssertion(entry, chainHead(), stackStart)
      return assertionMember(assertion.state, property, assertion.count, stackStart)
    }
  }

  // D26: call/apply/bind, unless the member with that name is configured as a property, or the substitute mimicks
  // an instance that has no such member (then it reads like on the instance, D12)
  if (isFunctionHelperKey(property)) {
    const memberState = memberStateOf(face)
    const instance = memberState?.mimicked?.instance
    if (memberState?.propertySubstitution(property) === undefined && (instance === undefined || hasMember(instance, property)))
      return dualHelper(face, property, chainHead())
  }

  const context = contextMethodOf(property)
  if (context !== undefined) return contextFunction(context, () => faceState(face), chainHead())

  // D28: an unconfigured protocol key reads as undefined, and is not recorded
  if (isProtocolKey(property) && !answersProtocolKey(faceState(face), property)) return undefined
  return REAL_READ
}

const faceSet = (face: Face, property: PropertyKey, value: unknown, stackStart: Function): void => {
  const candidate = adjacentHandOut(face)
  if (face instanceof AutoEntry && face.kind === 'call' && isStringAssertionKey(face.key)) {
    const assertion = resolveStringAssertion(face, continuedChain(candidate, frameAt(stackStart)), stackStart)
    assertSet(assertion.state, property, value, assertion.count, stackStart)
    return
  }
  realSet(faceState(face), property, value, candidate, captureStack(stackStart))
}

/** Whether invoking the face is an invocation to record, rather than a string assertion (`sub.received(1)(...)`). */
const recordsInvocation = (face: Face): boolean => !(face instanceof AutoEntry && face.kind === 'call' && isStringAssertionKey(face.key))

/**
 * A direct invocation of a substitute (the proxy apply trap; `site`: its call site, captured by the trap). D26: the
 * `this` of the invocation is passed on to a mimicked function and to mimicks(), so that
 * `obj.add = fnSubstitute; obj.add(1)` runs with `this === obj`. (A mimicked instance's own method keeps running on
 * the instance, D12.)
 */
const faceApply = (face: Face, self: Self, args: any[], stackStart: Function, site?: StackHolder): any => {
  // E39: a substitute handed out as a configured value continues the expression that handed it out
  if (!(face instanceof AutoEntry)) return invoke(face, SELF, args, stackStart, undefined, face.adjacentHandOut(), self, site)
  if (face.kind === 'get') return invoke(face.parent, face.key, args, stackStart, TAKE_PENDING_READ, undefined, self, site)
  // D11 / D26: `fn.received(n)` followed by an invocation asserts a direct call, like a member access after it does
  if (isStringAssertionKey(face.key)) {
    const assertion = resolveStringAssertion(face, continuedChain(face.adjacentHandOut(), frameAt(stackStart)), stackStart)
    assertDirectCall(assertion.state, args, assertion.count, stackStart)
    return undefined
  }
  return invoke(face.state, SELF, args, stackStart, undefined, face.adjacentHandOut(), self, site)
}

// ---- D26: call, apply and bind ----------------------------------------------------------------

/** The substitute whose members `x.call` and friends are under the member reading (undefined: not created yet). */
const memberStateOf = (face: Face): SubstituteState | undefined => face instanceof AutoEntry ? face.materializedState : face

/** Where a direct call of the substitute is recorded and resolved: `fn(...)`, `sub.method(...)` or `sub.f()(...)`. */
type DirectReading = { state: SubstituteState, key: PropertyKey, readSource: ReadSource }
const directReadingOf = (face: Face): DirectReading => {
  if (!(face instanceof AutoEntry)) return { state: face, key: SELF, readSource: undefined }
  if (face.kind === 'get') return { state: face.parent, key: face.key, readSource: TAKE_PENDING_READ }
  return { state: face.state, key: SELF, readSource: undefined }
}

const NOT_CONFIGURED: unique symbol = Symbol('not configured')

/**
 * The member reading answers when a substitution configured on the member named call/apply/bind matches the raw
 * arguments, or when a mimicked instance has such a member of its own (a function's call/apply/bind inherited from
 * Function.prototype is the direct reading itself, recorded as such).
 */
const memberReadingAnswer = (state: SubstituteState, helper: FunctionHelperKey, rawArgs: any[], hashes: ArgumentHashes, record: CallRecord, thisArg: unknown): any => {
  const substitution = state.findCallSubstitution(helper, hashes)
  if (substitution !== undefined) {
    if (substitution.method === 'auto') substitution.entry!.handOut(record)
    return execute(substitution, rawArgs, { thisArg, explicit: true })
  }
  const instance = state.mimicked?.instance
  if (instance !== undefined && hasMember(instance, helper)) {
    const member = instance[helper]
    if (typeof member === 'function' && member !== (Function.prototype as any)[helper]) return Reflect.apply(member, instance, rawArgs)
  }
  return NOT_CONFIGURED
}

/** The arguments `x.apply(thisArg, list)` passes to x, or undefined when the list is not array-like. */
const applyArguments = (list: unknown): any[] | undefined => {
  if (list === undefined || list === null) return []
  if (typeof list !== 'object' && typeof list !== 'function') return undefined
  try {
    return Array.from(list as ArrayLike<unknown>)
  } catch {
    return undefined
  }
}

/**
 * `x.call` / `x.apply` / `x.bind` on any function-like substitute value (D26). Invoking the helper:
 * (a) answers with a substitution configured on x's member of that name, when one matches the raw arguments;
 * (b) otherwise behaves like Function.prototype.call/apply/bind on x: the configured value of x(...arguments) (a
 *     mimicked function or mimicks() receives the thisArg).
 * The invocation is recorded once, with both readings (see CallRecord.twin), so that `x.received().call(t, 1)` and
 * `x.received()(1)` both count it. Setups written through the helper (`.returns` on its result, or arguments with
 * matchers) configure the member reading. For bind, the bind call is only a call of the member `bind`; invoking the
 * bound function is a direct call of x with the bound arguments first.
 */
const dualHelper = (face: Face, helper: FunctionHelperKey, chainHead: CallRecord | undefined): Function => {
  const invokeHelper = (rawArgs: any[], thisArg: unknown, directArgs: any[] | undefined, site: StackHolder): any => {
    const direct = directReadingOf(face)
    const read = direct.readSource === TAKE_PENDING_READ ? direct.state.takePendingRead(direct.key) : undefined
    const memberState = faceState(face)

    if (RecordedArguments.containsMatchers(rawArgs)) {
      retract(read)
      retract(chainHead)
      return configureCall(memberState, helper, RecordedArguments.forSpecification(rawArgs))
    }

    // the direct reading takes over the read of the member (`sub.method.call(...)`), as a direct call would
    let directRecord: CallRecord | undefined
    if (directArgs !== undefined) {
      if (read !== undefined && read.kind === 'get' && !read.retracted) {
        read.convertToCall(directArgs, site)
        directRecord = read
      } else {
        directRecord = direct.state.addRecord('call', direct.key, directArgs, site)
        directRecord.chainPrevious = chainHead
      }
    }
    // the two readings are one invocation: they share its call site
    const memberRecord = memberState.addRecord('call', helper, rawArgs, site)
    memberRecord.chainPrevious = directRecord ?? read ?? chainHead
    if (directRecord !== undefined) pairReadings(memberRecord, directRecord)

    const hashes = new ArgumentHashes(rawArgs)
    const answer = memberReadingAnswer(memberState, helper, rawArgs, hashes, memberRecord, thisArg)
    if (answer !== NOT_CONFIGURED) return answer
    if (directRecord !== undefined) {
      const directAnswer = configuredAnswer(direct.state, direct.key, directArgs!, new ArgumentHashes(directArgs!), directRecord, { thisArg, explicit: true })
      if (directAnswer !== NOT_CONFIGURED) return directAnswer
    }
    const entry = memberState.callEntry(helper, hashes)
    entry.handOut(memberRecord)
    return entryProxy(entry)
  }

  switch (helper) {
    case 'call':
      return function call(thisArg: unknown, ...args: any[]) {
        return invokeHelper([thisArg, ...args], thisArg, args, captureStack(call))
      }
    case 'apply':
      return function apply(thisArg: unknown, list?: unknown) {
        return invokeHelper(arguments.length < 2 ? [thisArg] : [thisArg, list], thisArg, applyArguments(list), captureStack(apply))
      }
    case 'bind':
      return function bind(thisArg: unknown, ...boundArgs: any[]) {
        const rawArgs = [thisArg, ...boundArgs]
        const memberState = faceState(face)
        if (RecordedArguments.containsMatchers(rawArgs)) {
          retract(chainHead)
          return configureCall(memberState, 'bind', RecordedArguments.forSpecification(rawArgs))
        }
        const memberRecord = memberState.addRecord('call', 'bind', rawArgs, captureStack(bind))
        memberRecord.chainPrevious = chainHead
        const hashes = new ArgumentHashes(rawArgs)
        const answer = memberReadingAnswer(memberState, 'bind', rawArgs, hashes, memberRecord, thisArg)
        if (answer !== NOT_CONFIGURED) return answer
        const entry = memberState.callEntry('bind', hashes)
        entry.handOut(memberRecord)
        return createBoundProxy(face, entry, thisArg, boundArgs)
      }
  }
}

/**
 * The function `x.bind(thisArg, ...boundArgs)` returns (D26). Invoking it is a direct call of x with the bound
 * arguments first and thisArg as `this`. Anything else on it is the result of the call of x's member `bind`:
 * `.returns(...)` configures that call (the member reading), other members are those of its auto-substitute.
 */
const createBoundProxy = (face: Face, bindEntry: AutoEntry, thisArg: unknown, boundArgs: any[]): any => {
  const print: Printer = options => printFace(bindEntry, colorsOf(options))
  const proxy: any = createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, bindEntry)
      // a bound function ignores the `this` it is called with
      if (isFunctionHelperKey(property)) return (Function.prototype as any)[property].bind(proxy)
      const value = faceGet(bindEntry, property, get)
      return value === REAL_READ ? realGet(bindEntry.state, property, bindEntry.adjacentHandOut(), captureStack(get)) : value
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      faceSet(bindEntry, property, value, set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      const direct = directReadingOf(face)
      return invoke(direct.state, direct.key, [...boundArgs, ...args], apply, direct.readSource, undefined, { thisArg, explicit: true }, captureStack(apply))
    },
    // `new` on a bound function constructs the function it is bound to, with the bound arguments first (E23)
    construct: function construct(_target: unknown, args: any[], newTarget: Function) {
      const direct = directReadingOf(face)
      return constructed(invoke(direct.state, direct.key, [...boundArgs, ...args], construct, direct.readSource, undefined, constructing(newTarget), captureStack(construct)))
    }
  })
  return proxy
}

/** `.call`, `.apply` and `.bind` on assertions and deferred reads behave like invoking the member (D7). */
const functionHelper = (property: FunctionHelperKey, invokeWith: (args: any[], stackStart: Function) => any): Function => {
  switch (property) {
    case 'call':
      return function call(_thisArg: unknown, ...args: any[]) {
        return invokeWith(args, call)
      }
    case 'apply':
      return function apply(_thisArg: unknown, args?: ArrayLike<unknown> | null) {
        return invokeWith(args === undefined || args === null ? [] : Array.from(args), apply)
      }
    case 'bind':
      return function bind(_thisArg: unknown, ...boundArgs: any[]) {
        const bound = function (...args: any[]) {
          return invokeWith([...boundArgs, ...args], bound)
        }
        return bound
      }
  }
}

const hasMember = (instance: any, key: PropertyKey): boolean =>
  ((typeof instance === 'object' && instance !== null) || typeof instance === 'function') && key in instance

const execute = (substitution: Substitution, args?: any[], self: Self = NO_SELF): any => {
  const value = substitution.nextValue()
  switch (substitution.method) {
    case 'returns':
      return value
    case 'throws':
      throw value
    case 'resolves':
      return Promise.resolve(value)
    case 'rejects':
      return Promise.reject(value)
    case 'mimicks':
      return callOrConstruct(value, self.thisArg, args ?? [], self)
    case 'auto':
      return entryProxy(substitution.entry!)
  }
}

/** D28: whether a protocol key is configured or mimicked, so that reading it answers as usual. */
const answersProtocolKey = (state: SubstituteState, key: PropertyKey): boolean =>
  state.propertySubstitution(key) !== undefined ||
  state.hasCallSubstitutions(key) ||
  state.hasConfiguredPropertyEntry(key) ||
  (state.mimicked !== undefined && hasMember(state.mimicked.instance, key))

/** A real property read by the code under test (`site`: its call site). */
const realGet = (state: SubstituteState, key: PropertyKey, chainCandidate: CallRecord | undefined, site: StackHolder): any => {
  const substitution = state.propertySubstitution(key)
  if (substitution !== undefined) {
    const record = linkChain(state.addRecord('get', key, undefined, site), chainCandidate)
    // Configured both as a property and as a method: whether this read is a property read is only known later.
    if (state.hasCallSubstitutions(key)) return deferredRead(state, key, record, substitution)
    return handOutConfigured(execute(substitution), record, state)
  }

  const mimicked = state.mimicked
  if (mimicked !== undefined) {
    // A member the instance does not have reads as undefined, like on the instance, unless the
    // substitute itself needs it: the string assertion forms, configured calls and nested setups.
    const delegate = hasMember(mimicked.instance, key) ||
      !(isStringAssertionKey(key) || state.hasCallSubstitutions(key) || state.hasConfiguredPropertyEntry(key))
    const value = delegate ? mimicked.instance[key] : undefined
    // a substitute value records and resolves its own calls (D31: nested setups through the member go to it)
    if (delegate && (typeof value !== 'function' || isSubstituteProxy(value))) {
      return handOutConfigured(value, linkChain(state.addRecord('get', key, undefined, site), chainCandidate), state)
    }
  }

  const record = linkChain(state.addRecord('get', key, undefined, site), chainCandidate)
  state.addPendingRead(record)
  const entry = state.propertyEntry(key)
  entry.handOut(record)
  return entryProxy(entry)
}

/** A real property assignment by the code under test (`site`: its call site). */
const realSet = (state: SubstituteState, key: PropertyKey, value: unknown, chainCandidate: CallRecord | undefined, site: StackHolder): void => {
  linkChain(state.addRecord('set', key, [value], site), chainCandidate)
  if (state.mimicked !== undefined) state.mimicked.instance[key] = value
}

/**
 * An invocation. With Arg matchers among the arguments it is a setup (D3): nothing is recorded and no
 * substitution runs. Otherwise it is a real call: it is recorded (taking over the property read of the
 * method, if there is one) and resolved.
 */
const invoke = (
  state: SubstituteState, key: PropertyKey, args: any[], stackStart: Function, readSource: ReadSource,
  chainCandidate?: CallRecord, self: Self = NO_SELF, site?: StackHolder
): any => {
  const read = readSource === TAKE_PENDING_READ ? state.takePendingRead(key) : readSource

  if (RecordedArguments.containsMatchers(args)) {
    // (retracted first: a usage error in the arguments, E49, leaves no record of the expression behind)
    retract(read)
    retract(continuedChain(chainCandidate, frameAt(stackStart)))
    const specification = RecordedArguments.forSpecification(args)
    return configureCall(state, key, specification, isStringAssertionKey(key))
  }

  // the trap captured the call site (E11), unless the invocation comes through a helper of a deferred read
  const callSite = site ?? captureStack(stackStart)
  let record: CallRecord
  if (read !== undefined && read.kind === 'get' && !read.retracted) {
    // E1/E8: the call is made where it is invoked, with the call site of the invocation (see convertToCall)
    read.convertToCall(args, callSite)
    record = read
  } else record = linkChain(state.addRecord('call', key, args, callSite), chainCandidate)
  if (self.construct === true) record.constructed = true

  return resolveCall(state, key, args, record, self)
}

/**
 * The `this` of an invocation. `explicit` when it was given through call/apply/bind: then a mimicked instance's
 * method runs with it as well, instead of with the instance. `construct` for `new` (E23), with the `new.target` of a
 * subclass or of Reflect.construct (E36; undefined when it is the substitute itself).
 */
type Self = { thisArg: unknown, explicit: boolean, construct?: boolean, newTarget?: Function }
const NO_SELF: Self = { thisArg: undefined, explicit: false }

/*
 * E23: `new` on a substitute or on a member (`new sub(url)`, `new ns.Client(url)`) is a call like any other: it is
 * recorded (as a construction, which messages show as `new Client(url)`), and setups and checks written with call
 * syntax apply to it (`ns.Client(Arg.any()).returns(client)`, `ns.received(1).Client(url)`). It answers with the
 * configured value when that is an object or a function, and with the auto-substitute of the call otherwise (`new`
 * always gives an object). A mimicked function, or a function given to mimicks(), is constructed when it is a
 * constructor (a class, an ordinary function or a bound constructor), and called otherwise (an arrow function, a method).
 *
 * E36: `new.target` is honoured. When it is not the substitute itself (`class Derived extends sub.Base`, then
 * `new Derived()`; Reflect.construct(sub, args, Other)), a mimicked constructor is constructed with it
 * (Reflect.construct(RealBase, args, newTarget)), and a construction that nothing answers with an object gives a new
 * object with newTarget.prototype (not the cached auto-substitute of the call). The call is recorded either way.
 */
const CONSTRUCT: Self = { thisArg: undefined, explicit: false, construct: true }

const constructing = (newTarget: unknown): Self => {
  // a substitute as new.target: `new sub(...)` (or one substitute constructed for another), found by its prototype
  // first (a substitute or an auto-substitute), then by its marker (the other values the library hands out). A subclass
  // of a substitute inherits the marker, but it is not a proxy.
  if (typeof newTarget !== 'function' || isFaceProxy(newTarget) ||
    (types.isProxy(newTarget) && isSubstituteProxy(newTarget))) return CONSTRUCT
  return { thisArg: undefined, explicit: false, construct: true, newTarget }
}

const isObjectLike = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function'

/** What `new` gives for the answer of an invocation that is not an object: an empty object (as `new` on a function would). */
const constructed = (answer: unknown): object => isObjectLike(answer) ? answer : {}

/** E36: the object that `new` on a subclass gives when nothing answers with an object: one with newTarget.prototype. */
const instanceOf = (newTarget: Function): object => {
  const prototype = (newTarget as { prototype?: unknown }).prototype
  return Object.create(isObjectLike(prototype) ? prototype : Object.prototype)
}

/**
 * Whether a function can be constructed: a substitute, a class, an ordinary function or (E36) a bound constructor.
 * Arrow functions, methods, async and generator functions cannot. Functions with an own `prototype` are decided without
 * a probe; the others (bound functions, arrow functions, methods) with Reflect.construct's own check of new.target,
 * which constructs nothing for a constructor and throws for anything else.
 */
const isConstructor = (fn: Function): boolean => {
  if (isSubstituteProxy(fn)) return true
  try {
    if (Object.getOwnPropertyDescriptor(fn, 'prototype') !== undefined) return !types.isGeneratorFunction(fn) && !types.isAsyncFunction(fn)
    Reflect.construct(Object, [], fn)
    return true
  } catch {
    return false
  }
}

/** Runs a mimicked function: constructs it for `new` when it is a constructor (with the new.target, E36), calls it otherwise. */
const callOrConstruct = (fn: Function, thisArg: unknown, args: any[], self: Self): any =>
  self.construct === true && isConstructor(fn) ? Reflect.construct(fn, args, self.newTarget ?? fn) : Reflect.apply(fn, thisArg, args)

/** The configured answer to a call: a matching substitution, or the mimicked instance. NOT_CONFIGURED otherwise. */
const configuredAnswer = (state: SubstituteState, key: PropertyKey, args: any[], hashes: ArgumentHashes, record: CallRecord, self: Self): any => {
  const substitution = state.findCallSubstitution(key, hashes)
  if (substitution !== undefined) {
    if (substitution.method === 'auto') substitution.entry!.handOut(record)
    return execute(substitution, args, self)
  }

  const mimicked = state.mimicked
  if (mimicked !== undefined) {
    const instance = mimicked.instance
    if (key === SELF) {
      if (typeof instance === 'function') return callOrConstruct(instance, self.thisArg, args, self)
    } else {
      const member = instance[key]
      if (typeof member === 'function') return callOrConstruct(member, self.explicit ? self.thisArg : instance, args, self)
    }
  }
  return NOT_CONFIGURED
}

const resolveCall = (state: SubstituteState, key: PropertyKey, args: any[], record: CallRecord, self: Self): any => {
  const hashes = new ArgumentHashes(args)
  const answer = configuredAnswer(state, key, args, hashes, record, self)
  // E23: `new` answers with an object; for any other configured value it gives the auto-substitute of the call
  if (answer !== NOT_CONFIGURED && (self.construct !== true || isObjectLike(answer))) return handOutConfigured(answer, record, state)
  // E36: or, for a subclass (new.target), a new instance of it
  if (self.newTarget !== undefined) return instanceOf(self.newTarget)
  const entry = state.callEntry(key, hashes)
  entry.handOut(record)
  if (isStringAssertionKey(key) && self.construct !== true) deferStringCheck(state, key, args, entry, record)
  return entryProxy(entry)
}

/*
 * E48: a check view that nothing follows checks nothing (`next.didNotReceive()`, `res.received(2)`, `sub[received]()`
 * as a statement). It is reported as a usage error from a microtask, as a check that fails later is (D9), unless the
 * view is used before that: a member access (other than the printing members and `then`), an assignment, a call or
 * `new`. The symbol forms are always checks (see createAssertionProxy).
 *
 * The string forms (`sub.received(2)`, `sub.didNotReceive()`) are calls of a member of that name until something
 * follows them (D11). Such a call is reported when it has the arguments of a check (none, or a valid count for
 * received), nothing answered it (no setup, no mimicked instance), and at the time of the report the member still has
 * no setup and has not been checked as a member (`sub[received](1).received(10)`): a type that has a member called
 * received or didNotReceive of its own configures it, or checks it with the symbols.
 */

/** E48: the pending reports of the string-form calls that handed out an auto-substitute, until it is used. */
const danglingStringChecks = new WeakMap<AutoEntry, DeferredAssertion[]>()
/** E48: the members called received or didNotReceive that a check named, per substitute (see deferStringCheck). */
const checkedAssertionMembers = new WeakMap<SubstituteState, Set<PropertyKey>>()

const deferStringCheck = (state: SubstituteState, key: StringAssertionKey, args: any[], entry: AutoEntry, record: CallRecord): void => {
  let count: ExpectedCount
  if (key === 'didNotReceive') {
    if (args.length > 0) return
    count = 0
  } else {
    if (args.length > 1 || (args.length === 1 && !isValidCount(args[0]))) return
    count = args[0]
  }
  const deferred = deferDanglingCheck(state, 'string', count, record.site, () =>
    !record.retracted && !configuresMember(state, key) && checkedAssertionMembers.get(state)?.has(key) !== true)
  const pending = danglingStringChecks.get(entry)
  if (pending === undefined) danglingStringChecks.set(entry, [deferred])
  else pending.push(deferred)
}

const isValidCount = (count: unknown): boolean => count === undefined || (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)

/** E48: the auto-substitute of a string-form call is used: its pending reports are settled. */
const useStringCheck = (entry: AutoEntry): void => {
  const pending = danglingStringChecks.get(entry)
  if (pending === undefined) return
  danglingStringChecks.delete(entry)
  for (const deferred of pending) settle(deferred)
}

/** E48: notes that a check named a member called received or didNotReceive (see deferStringCheck). */
const noteCheckedMember = (state: SubstituteState, key: PropertyKey): void => {
  if (!isStringAssertionKey(key)) return
  const members = checkedAssertionMembers.get(state)
  if (members === undefined) checkedAssertionMembers.set(state, new Set([key]))
  else members.add(key)
}

/** The actual arguments of the call that handed out this auto-substitute, when it is part of the same expression. */
const actualArgumentsOf = (entry: AutoEntry, chainHead: CallRecord | undefined): any[] => {
  if (chainHead !== undefined && chainHead.kind === 'call' && chainHead.args !== undefined) return chainHead.args
  return entry.args?.value ?? []
}

/**
 * E28: mimicks() calls the functions it was given when the member is used, so anything else would only fail later,
 * inside the code under test. It is refused at the setup instead (`describeTarget`: the member or call configured).
 */
const validateSubstitution = (method: SubstitutionMethod, values: readonly unknown[], describeTarget: () => string, stackStart: Function): void => {
  if (method !== 'mimicks') return
  const index = values.findIndex(value => typeof value !== 'function')
  if (values.length > 0 && index === -1) return
  const received = values.length === 0 ? 'no argument' : formatValue(values[index], false)
  const error = new TypeError(`mimicks() expects a function to call for ${describeTarget()}, but received ${received}.`)
  if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(error, stackStart)
  throw error
}

/** The call a setup configures, as messages show it: `@Substitute.getUser(1)`. */
const describeCall = (state: SubstituteState, key: PropertyKey, args: readonly unknown[] | undefined): string =>
  `${state.memberPath(key)}${formatArguments(args ?? [], false)}`

/** `.returns(...)` and friends on a handle: configures the member read or the call that produced the handle. */
const setupFunction = (entry: AutoEntry, method: SubstitutionMethod, chainHead: CallRecord | undefined, stackStart: Function): Function => {
  const specification = entry.kind === 'call' && entry.args!.argumentsClass !== 'plain'
    ? RecordedArguments.from(actualArgumentsOf(entry, chainHead)) // handed out by a matcher setup: configure the actual call
    : entry.args
  retract(chainHead)
  // E49: `repo.find(Arg.any).returns(user)`, a call without matchers whose argument is a matcher function itself
  if (specification !== undefined && specification.value !== undefined) RecordedArguments.rejectMatcherFactories(specification.value, stackStart)
  return function substitution(...values: any[]) {
    validateSubstitution(method, values, () => entry.kind === 'get'
      ? entry.parent.memberPath(entry.key)
      : describeCall(entry.parent, entry.key, specification!.value), substitution)
    if (entry.kind === 'get') entry.parent.setPropertySubstitution(entry.key, method, values)
    else entry.parent.addCallSubstitution(entry.key, specification!, method, values)
  }
}

const resolveStringAssertion = (entry: AutoEntry, chainHead: CallRecord | undefined, stackStart: Function): { state: SubstituteState, count: ExpectedCount } => {
  useStringCheck(entry)
  const args = actualArgumentsOf(entry, chainHead)
  retract(chainHead)
  const count = entry.key === 'didNotReceive' ? 0 : validateExpectedCount(args[0], stackStart)
  return { state: entry.parent, count }
}

const validateMimickInstance = (instance: unknown, stackStart: Function) => {
  if ((typeof instance !== 'object' || instance === null) && typeof instance !== 'function')
    throw SubstituteException.generic(`mimick expects an object or a function to delegate to, but received ${formatValue(instance, false)}.`, stackStart)
}

/** The functions behind the exported symbols: sub[received](n), sub[didNotReceive](), sub[configure](), ... */
const contextFunction = (context: ContextMethod, getState: () => SubstituteState, chainHead: CallRecord | undefined): Function => {
  switch (context) {
    case 'received':
      return function received(count?: unknown) {
        const expected = validateExpectedCount(count, received)
        retract(chainHead)
        return createAssertionProxy(getState(), expected, captureStack(received))
      }
    case 'didNotReceive':
      return function didNotReceive() {
        retract(chainHead)
        return createAssertionProxy(getState(), 0, captureStack(didNotReceive))
      }
    case 'clearReceivedCalls':
      return function clearReceivedCalls() {
        retract(chainHead)
        getState().clearReceivedCalls()
      }
    case 'mimick':
      return function mimick(instance: unknown) {
        validateMimickInstance(instance, mimick)
        retract(chainHead)
        getState().mimicked = { instance }
      }
    case 'configure':
      return function configure() {
        retract(chainHead)
        return createConfigureProxy(getState())
      }
  }
}

/** A read of a member that is configured both as a property and as a method (see issue 178). */
const deferredRead = (state: SubstituteState, key: PropertyKey, record: CallRecord, substitution: Substitution): any => {
  let resolved = false
  let value: any
  const resolve = () => {
    if (!resolved) {
      resolved = true
      value = execute(substitution)
    }
    return value
  }
  const print: Printer = () => state.memberPath(key)
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) {
        if (record.seq === currentSequence()) retract(continuedChain(record, frameAt(get)))
        return function substitution(...values: any[]) {
          validateSubstitution(method, values, () => state.memberPath(key), substitution)
          state.setPropertySubstitution(key, method, values)
        }
      }
      if (isFunctionHelperKey(property)) return functionHelper(property, (args, start) => invoke(state, key, args, start, record))
      // D32: a method of the property value runs with the value as `this`, as `value.method()` would
      // (a substitute value records and resolves its own calls)
      const resolved = resolve()
      const member = resolved[property]
      return typeof member === 'function' && !isSubstituteProxy(resolved) ? member.bind(resolved) : member
    },
    set: function set(_target: unknown, property: PropertyKey, newValue: unknown) {
      resolve()[property] = newValue
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return invoke(state, key, args, apply, record)
    },
    construct: function construct(_target: unknown, args: any[], newTarget: Function) {
      return constructed(invoke(state, key, args, construct, record, undefined, constructing(newTarget)))
    }
  })
}

// ---- assertions -------------------------------------------------------------------------------

const describeCount = (count: ExpectedCount) => count === undefined ? 'received()' : count === 0 ? 'didNotReceive()' : `received(${count})`

/** `sub[received](n)` / `sub[didNotReceive]()` (`site`: where). E48: reported later if nothing uses it (see deferStringCheck). */
const createAssertionProxy = (state: SubstituteState, count: ExpectedCount, site: StackHolder): any => {
  const print: Printer = () => `${state.path}.${describeCount(count)}`
  const dangling = deferDanglingCheck(state, 'symbol', count, site)
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      settle(dangling)
      return assertionMember(state, property, count, get)
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      settle(dangling)
      assertSet(state, property, value, count, set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      settle(dangling)
      assertDirectCall(state, args, count, apply)
      return undefined
    },
    // E23: a check of `new` is a check of the call
    construct: function construct(_target: unknown, args: any[]) {
      settle(dangling)
      assertDirectCall(state, args, count, construct)
      return {}
    }
  }, () => settle(dangling))
}

/**
 * An assertion that a substitute was invoked directly: `fn[received]()(1)`. A member handle (`sub.method`) is never
 * invoked on its own: invoking it is a call of the member, recorded on the parent, so that is what is checked
 * (`sub.method[received]()(1)` is `sub[received]().method(1)`, D26).
 */
const assertDirectCall = (state: SubstituteState, args: any[], count: ExpectedCount, stackStart: Function): void => {
  const owner = state.owner
  if (owner !== undefined && owner.kind === 'get') assertCall(owner.parent, owner.key, args, count, stackStart)
  else assertCall(state, SELF, args, count, stackStart)
}

/** `sub.received(n).member`: a property assertion now, or a method assertion if it is invoked. */
const assertionMember = (state: SubstituteState, key: PropertyKey, count: ExpectedCount, stackStart: Function): any => {
  noteCheckedMember(state, key)
  const deferred = assertPropertyRead(state, key, count, stackStart)
  const assertInvocation = (args: any[], start: Function): undefined => {
    settle(deferred)
    assertCall(state, key, args, count, start)
    return undefined
  }
  const unsupported = (property: PropertyKey, start: Function): never => {
    if (deferred !== undefined && !deferred.settled) {
      settle(deferred)
      throw deferred.error()
    }
    throw SubstituteException.generic(
      `Cannot use "${keyToString(property)}" on the assertion ${state.path}.${describeCount(count)}.${memberLabel(key)}: ` +
      `an assertion ends with a property read, a property assignment or an invocation. ` +
      `To assert on a nested substitute, start the assertion from it, e.g. sub.${memberLabel(key)}.received().member(...)`,
      start
    )
  }
  const print: Printer = () => `${state.path}.${describeCount(count)}.${memberLabel(key)}`
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      if (isFunctionHelperKey(property)) return functionHelper(property, assertInvocation)
      return unsupported(property, get)
    },
    set: function set(_target: unknown, property: PropertyKey) {
      return unsupported(property, set)
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return assertInvocation(args, apply)
    },
    construct: function construct(_target: unknown, args: any[]) {
      assertInvocation(args, construct)
      return {}
    }
  })
}

// ---- configure view: every call is a setup ----------------------------------------------------

const configureSetError = (start: Function) => SubstituteException.generic(
  'Property assignments cannot be configured. Use .returns(...) on the property to configure what it returns.',
  start
)

const createConfigureProxy = (state: SubstituteState): any => {
  const print: Printer = () => `${state.path}[configure]()`
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      if (isSubstitutionSymbol(property)) throw substitutionOnSubstituteError(property, get)
      return configureMember(state, property)
    },
    set: function set() {
      throw configureSetError(set)
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return configureCall(state, SELF, RecordedArguments.forSpecification(args))
    },
    // E23: a setup of `new` is a setup of the call
    construct: function construct(_target: unknown, args: any[]) {
      return configureCall(state, SELF, RecordedArguments.forSpecification(args))
    }
  })
}

/*
 * D31: a nested setup through a member or a call (`sub[configure]().config.port.returns(1)`) that already answers
 * with a value (a configured return value, or the mimicked instance's value) goes to that value when it is a
 * substitute, as in NSubstitute. Members of a real value cannot be configured: that is a usage error, so that the
 * nested setup is never silently ignored and never silently replaces the earlier setup.
 */

/** The configure view of a substitute value: of this copy of the library directly, of another copy through its symbol. */
const configureViewOf = (value: any): any => {
  if (isFaceProxy(value)) {
    const face = value[INTERNAL] as Face | undefined
    if (face !== undefined) return createConfigureProxy(faceState(face))
  }
  return value[constants.CONTEXT.configure.symbol]()
}

const nestedOfRealValueError = (path: string, member: string, reason: string, start: Function) => SubstituteException.generic(
  `Cannot configure ${path}: ${member} ${reason}, which is not a substitute, and members of a real value cannot be ` +
  `configured. Configure ${member} to return a substitute (e.g. Substitute.for()) and configure that one, ` +
  `or configure what ${member} returns as a whole.`,
  start
)

/** The configure view to forward a nested setup to, or undefined when the member or call does not answer yet. */
const forwardNestedSetup = (
  path: string, member: string, substitution: Substitution | undefined, mimicked: { value: unknown } | undefined, start: Function
): any => {
  if (substitution !== undefined && substitution.method !== 'auto') {
    if (substitution.method !== 'returns')
      throw nestedOfRealValueError(path, member, `is configured with ${substitution.method}()`, start)
    const value = substitution.peekValue()
    if (isSubstituteProxy(value)) return configureViewOf(value)
    throw nestedOfRealValueError(path, member, `returns ${formatValue(value, false)}`, start)
  }
  if (mimicked !== undefined) {
    if (isSubstituteProxy(mimicked.value)) return configureViewOf(mimicked.value)
    throw nestedOfRealValueError(path, member, `is mimicked with ${formatValue(mimicked.value, false)}`, start)
  }
  return undefined
}

const configureMember = (state: SubstituteState, key: PropertyKey): any => {
  const context = contextMethodOf(key)
  if (context !== undefined) return contextFunction(context, () => state, undefined)
  const print: Printer = () => `${state.memberPath(key)} (configure)`
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) return function substitution(...values: any[]) {
        validateSubstitution(method, values, () => state.memberPath(key), substitution)
        state.setPropertySubstitution(key, method, values)
      }
      // D31: through a member that answers with a value already
      const substitution = state.propertySubstitution(key)
      const instance = state.mimicked?.instance
      const mimickedValue = substitution === undefined && instance !== undefined && hasMember(instance, key) ? instance[key] : undefined
      // a real method of a mimicked instance reads as a handle (see realGet), so nested setups configure that handle
      const mimicked = mimickedValue !== undefined && (typeof mimickedValue !== 'function' || isSubstituteProxy(mimickedValue))
        ? { value: mimickedValue } : undefined
      const forwarded = forwardNestedSetup(`${state.memberPath(key)}.${keyToString(property)}`, keyToString(key), substitution, mimicked, get)
      if (forwarded !== undefined) return forwarded[property]
      // D26: call/apply/bind are members here like any other: setups through them configure the member reading
      return configureMember(state.propertyEntry(key).state, property)
    },
    set: function set() {
      throw configureSetError(set)
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return configureCall(state, key, RecordedArguments.forSpecification(args))
    },
    construct: function construct(_target: unknown, args: any[]) {
      return configureCall(state, key, RecordedArguments.forSpecification(args))
    }
  })
}

/** The auto-substitute that answers calls matching the specification, registered so that real calls find it. */
const nestedEntry = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments): AutoEntry => {
  const entry = state.specificationEntry(key, specification)
  const existing = state.callSubstitutionFor(key, specification)
  if (existing === undefined || existing.method !== 'auto' || existing.entry !== entry)
    state.addCallSubstitution(key, specification, 'auto', [], entry)
  return entry
}

/**
 * Where a nested setup through a call goes (D31): the substitute that the call already returns, or the
 * auto-substitute registered for the specification. For an argument list without matchers, the substitution that
 * answers that call now counts; for one with matchers, the substitution configured with the same specification.
 */
const nestedSetupTarget = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments, property: PropertyKey | undefined, start: Function): any => {
  const answering = specification.argumentsClass === 'plain'
    ? state.findCallSubstitution(key, new ArgumentHashes(specification.value!))
    : state.callSubstitutionFor(key, specification)
  const call = `${memberLabel(key)}${formatArguments(specification.value, false)}`
  const path = `${state.memberPath(key)}${formatArguments(specification.value, false)}${property === undefined ? '(...)' : `.${keyToString(property)}`}`
  const forwarded = forwardNestedSetup(path, call, answering, undefined, start)
  return forwarded !== undefined ? forwarded : createConfigureProxy(nestedEntry(state, key, specification).state)
}

/**
 * A call in a setup: `.returns(...)` configures it, anything else configures the auto-substitute it returns.
 *
 * `stringAssertion` marks a call of the string `received` / `didNotReceive` with Arg matchers among its
 * arguments, outside a configure() view. Followed by a substitution method it is a setup of a member with that
 * name like any other; followed by any other member access or an assignment it is the assertion API (D11), so
 * `sub.received(Arg.any()).add(1)` reports the invalid count (D10) instead of configuring something silently.
 */
const configureCall = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments, stringAssertion = false): any => {
  const print: Printer = () => `${state.memberPath(key)}${pathArguments(specification.value)} (configure)`
  const assertionCount = (start: Function): ExpectedCount =>
    key === 'didNotReceive' ? 0 : validateExpectedCount(specification.value?.[0], start)
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) return function substitution(...values: any[]) {
        validateSubstitution(method, values, () => describeCall(state, key, specification.value), substitution)
        state.addCallSubstitution(key, specification, method, values)
      }
      if (stringAssertion) return assertionMember(state, property, assertionCount(get), get)
      return nestedSetupTarget(state, key, specification, property, get)[property]
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      if (!stringAssertion) throw configureSetError(set)
      assertSet(state, property, value, assertionCount(set), set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      if (stringAssertion) {
        assertDirectCall(state, args, assertionCount(apply), apply)
        return undefined
      }
      return nestedSetupTarget(state, key, specification, undefined, apply)(...args)
    },
    construct: function construct(_target: unknown, args: any[]) {
      if (stringAssertion) {
        assertDirectCall(state, args, assertionCount(construct), construct)
        return {}
      }
      return constructed(nestedSetupTarget(state, key, specification, undefined, construct)(...args))
    }
  })
}
