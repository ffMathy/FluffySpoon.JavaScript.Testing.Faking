import { inspect, InspectOptions, types } from 'util'

import { constants, isSubstituteProxy, substituteMarker } from '../shared'
import { ArgumentHashes, AutoEntry, Substitution, SubstituteState, pathArguments } from './SubstituteState'
import { CallRecord, currentSequence, pairReadings, retract } from './CallRecord'
import { Frame, StackHolder, captureStack, currentFrame, sameExpression } from './CallSite'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException } from './SubstituteException'
import { assertCall, assertPropertyRead, assertSet, settle, validateExpectedCount, ExpectedCount } from './Assertions'
import {
  ContextMethod, FunctionHelperKey, INTERNAL, SELF, SpecialProperty, SubstitutionMethod,
  contextMethodOf, isFunctionHelperKey, isProtocolKey, isSpecialProperty, isStringAssertionKey, keyToString, substitutionMethodOf
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
const viewFunction = function () { }
const newTarget = (print: Printer): any => {
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

const viewTraps = (print: Printer): ProxyHandler<any> => ({
  defineProperty: function defineProperty() {
    throw viewChangeError('Object.defineProperty()', print, defineProperty)
  },
  preventExtensions: function preventExtensions() {
    throw viewChangeError('Object.preventExtensions() (or Object.freeze(), Object.seal())', print, preventExtensions)
  },
  deleteProperty: () => true,
  ownKeys: () => [],
  getOwnPropertyDescriptor: () => undefined
})

/** A short-lived proxy (see newTarget and viewTraps). */
const createView = (print: Printer, handler: ProxyHandler<any>): any => new Proxy(newTarget(print), { ...viewTraps(print), ...handler })

// ---- printing ---------------------------------------------------------------------------------

const memberLabel = (key: PropertyKey) => key === SELF ? 'call' : keyToString(key)

/** A member relative to the printed substitute: `info`, `logger.info`, `getUser(1).name` ('' for the substitute itself). */
const memberWithin = (prefix: string, key: PropertyKey): string =>
  key === SELF ? prefix : prefix === '' ? keyToString(key) : `${prefix}.${keyToString(key)}`

/** An auto-substitute relative to the printed substitute: `logger`, `getUser(1)`, `logger.child('x')`. */
const entryWithin = (prefix: string, entry: AutoEntry): string => {
  const member = memberWithin(prefix, entry.key)
  return entry.kind === 'get' ? member : `${member}${pathArguments(entry.argumentList)}`
}

/**
 * The received calls and setups of a substitute and (E24) of its auto-substitutes, which are shown under their paths
 * relative to it (`logger.info('started')`, `logger.level => returns(3)`): the calls in the order they were made, the
 * setups in the order they were configured. An empty list means that there is nothing to show.
 */
const stateLines = (state: SubstituteState, colors: boolean): string[] => {
  const records: Array<{ record: CallRecord, prefix: string }> = []
  const substitutions: Array<{ substitution: Substitution, prefix: string }> = []
  const visit = (current: SubstituteState, prefix: string) => {
    for (const record of current.records) records.push({ record, prefix })
    // 'auto' substitutions only register an auto-substitute for a nested setup, which is shown under its path
    for (const substitution of current.substitutions()) if (substitution.method !== 'auto') substitutions.push({ substitution, prefix })
    for (const entry of current.entries()) {
      const nested = entry.materializedState
      if (nested !== undefined) visit(nested, entryWithin(prefix, entry))
    }
  }
  visit(state, '')

  const lines: string[] = []
  // D26: an invocation through call/apply is shown once, as its direct-call reading
  const directReadings = new Set(records.filter(({ record }) => record.directReading === true).map(({ record }) => record))
  const shown = records.filter(({ record }) => record.twin === undefined || record.directReading === true || !directReadings.has(record.twin))
  if (shown.length > 0) {
    lines.push('  received:')
    shown.sort((a, b) => a.record.seq - b.record.seq)
    for (const { record, prefix } of shown) {
      const name = memberWithin(prefix, record.key)
      const suffix = record.kind === 'call'
        ? formatArguments(record.args, colors) + describeOtherReading(record, colors)
        : record.kind === 'set' ? ` = ${formatValue(record.args?.[0], colors)}` : ''
      // E23: a construction of the substitute itself names it: `new @Substitute(url)`
      lines.push(`    ${record.constructed === true ? `new ${name === '' ? state.path : name}` : name}${suffix}`)
    }
  }
  if (substitutions.length > 0) {
    lines.push('  configured:')
    substitutions.sort((a, b) => a.substitution.order - b.substitution.order)
    for (const { substitution, prefix } of substitutions) {
      const name = memberWithin(prefix, substitution.key)
      const args = substitution.kind === 'call' ? formatArguments(substitution.args?.value, colors) : ''
      const values = substitution.values.map(value => formatValue(value, colors)).join(', ')
      lines.push(`    ${name}${args} => ${substitution.method}(${values})`)
    }
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

export const createSubstitute = (): any => createFaceProxy(new SubstituteState())

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

const adjacentHandOut = (face: Face): CallRecord | undefined => face instanceof AutoEntry ? face.adjacentHandOut() : undefined

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
    const face = target()
    const value = faceGet(face, property, get)
    return value === REAL_READ ? realGet(faceState(face), property, adjacentHandOut(face), captureStack(get)) : value
  },
  set: function set(target: FaceTarget, property: PropertyKey, value: unknown, receiver: unknown) {
    if (isDefined(target, property)) return Reflect.set(target, property, value, receiver)
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
  deleteProperty: (target: FaceTarget, property: PropertyKey) => !isOwned(target) || Reflect.deleteProperty(target, property),
  ownKeys: (target: FaceTarget) => isOwned(target) ? Reflect.ownKeys(target) : [],
  getOwnPropertyDescriptor: (target: FaceTarget, property: PropertyKey) =>
    isOwned(target) ? Reflect.getOwnPropertyDescriptor(target, property) : undefined,
  apply: function apply(target: FaceTarget, thisArg: unknown, args: any[]) {
    const face = target()
    return faceApply(face, { thisArg, explicit: false }, args, apply, recordsInvocation(face) ? captureStack(apply) : undefined)
  },
  // E23: `new sub(...)` and `new sub.Member(...)` are invocations, recorded as constructions (see faceApply)
  construct: function construct(target: FaceTarget, args: any[]) {
    const face = target()
    return constructed(faceApply(face, CONSTRUCT, args, construct, recordsInvocation(face) ? captureStack(construct) : undefined))
  }
}

// bound to the face: a bound function is smaller than a closure and its context
const returnThis = function (this: Face): Face { return this }

/**
 * E26: `key in sub` (and Reflect.has) is true for a key with a setup (as a property or a method, or a nested setup
 * through it) and for a key that the mimicked instance has (`key in instance`), and false otherwise: for unconfigured
 * keys, protocol keys and the library's own special members (then, inspect.custom, ...). Nothing is recorded.
 */
const faceHas = (face: Face, key: PropertyKey): boolean => {
  if (isSpecialProperty(key)) return false
  const state = face instanceof AutoEntry ? face.materializedState : face
  if (state === undefined) return false
  return state.propertySubstitution(key) !== undefined ||
    state.hasCallSubstitutions(key) ||
    (state.mimicked !== undefined && hasMember(state.mimicked.instance, key)) ||
    hasNestedSetup(state, key)
}

/** Whether an auto-substitute of the member (of the property, or of one of its calls) has a setup of its own. */
const hasNestedSetup = (state: SubstituteState, key: PropertyKey): boolean => {
  for (const entry of state.entries()) {
    const nested = entry.key === key ? entry.materializedState : undefined
    if (nested !== undefined && isConfigured(nested)) return true
  }
  return false
}

/** Whether a substitute, or one of its auto-substitutes, has a setup or mimicks an instance. */
const isConfigured = (state: SubstituteState): boolean => {
  if (state.mimicked !== undefined || state.substitutions().some(substitution => substitution.method !== 'auto')) return true
  for (const entry of state.entries()) {
    const nested = entry.materializedState
    if (nested !== undefined && isConfigured(nested)) return true
  }
  return false
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
  if (isSpecialProperty(property)) return special(property, options => printFace(face, colorsOf(options)), face)

  const candidate = adjacentHandOut(face)
  // for the operations that create no record: compared with the frame of this access
  const chainHead = () => continuedChain(candidate, frameAt(stackStart))

  if (!(face instanceof AutoEntry)) {
    if (isSubstitutionSymbol(property)) throw substitutionOnSubstituteError(property, stackStart)
  } else {
    const entry = face
    const method = substitutionMethodOf(property)
    if (method !== undefined) return setupFunction(entry, method, chainHead())

    // D11: `sub.received(n)` followed by a member access other than a substitution method is an assertion.
    if (entry.kind === 'call' && isStringAssertionKey(entry.key)) {
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
  if (!(face instanceof AutoEntry)) return invoke(face, SELF, args, stackStart, undefined, undefined, self, site)
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
    return execute(substitution, rawArgs, thisArg)
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
      const specification = RecordedArguments.forSpecification(rawArgs)
      retract(read)
      retract(chainHead)
      return configureCall(memberState, helper, specification)
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
          const specification = RecordedArguments.forSpecification(rawArgs)
          retract(chainHead)
          return configureCall(memberState, 'bind', specification)
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
    construct: function construct(_target: unknown, args: any[]) {
      const direct = directReadingOf(face)
      return constructed(invoke(direct.state, direct.key, [...boundArgs, ...args], construct, direct.readSource, undefined, CONSTRUCT, captureStack(construct)))
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

const execute = (substitution: Substitution, args?: any[], thisArg?: unknown, construct = false): any => {
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
      return callOrConstruct(value, thisArg, args ?? [], construct)
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
    return execute(substitution)
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
      linkChain(state.addRecord('get', key, undefined, site), chainCandidate)
      return value
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
    const specification = RecordedArguments.forSpecification(args)
    retract(read)
    retract(continuedChain(chainCandidate, frameAt(stackStart)))
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
  if (self === CONSTRUCT) record.constructed = true

  return resolveCall(state, key, args, record, self)
}

/**
 * The `this` of an invocation. `explicit` when it was given through call/apply/bind: then a mimicked instance's
 * method runs with it as well, instead of with the instance. CONSTRUCT for `new` (E23).
 */
type Self = { thisArg: unknown, explicit: boolean }
const NO_SELF: Self = { thisArg: undefined, explicit: false }

/*
 * E23: `new` on a substitute or on a member (`new sub(url)`, `new ns.Client(url)`) is a call like any other: it is
 * recorded (as a construction, which messages show as `new Client(url)`), and setups and checks written with call
 * syntax apply to it (`ns.Client(Arg.any()).returns(client)`, `ns.received(1).Client(url)`). It answers with the
 * configured value when that is an object or a function, and with the auto-substitute of the call otherwise (`new`
 * always gives an object). A mimicked function, or a function given to mimicks(), is constructed when it is a
 * constructor (a class or an ordinary function), and called otherwise (an arrow function, a method).
 */
const CONSTRUCT: Self = { thisArg: undefined, explicit: false }

const isObjectLike = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function'

/** What `new` gives for the answer of an invocation that is not an object: an empty object (as `new` on a function would). */
const constructed = (answer: unknown): object => isObjectLike(answer) ? answer : {}

/**
 * Whether a function can be constructed: a substitute, a class or an ordinary function (they have an own `prototype`;
 * arrow functions, methods and async functions do not, and generator functions cannot be constructed).
 */
const isConstructor = (fn: Function): boolean => {
  if (isSubstituteProxy(fn)) return true
  try {
    return Object.getOwnPropertyDescriptor(fn, 'prototype') !== undefined && !types.isGeneratorFunction(fn)
  } catch {
    return false
  }
}

/** Runs a mimicked function: constructs it for `new` when it is a constructor, calls it otherwise. */
const callOrConstruct = (fn: Function, thisArg: unknown, args: any[], construct: boolean): any =>
  construct && isConstructor(fn) ? Reflect.construct(fn, args) : Reflect.apply(fn, thisArg, args)

/** The configured answer to a call: a matching substitution, or the mimicked instance. NOT_CONFIGURED otherwise. */
const configuredAnswer = (state: SubstituteState, key: PropertyKey, args: any[], hashes: ArgumentHashes, record: CallRecord, self: Self): any => {
  const construct = self === CONSTRUCT
  const substitution = state.findCallSubstitution(key, hashes)
  if (substitution !== undefined) {
    if (substitution.method === 'auto') substitution.entry!.handOut(record)
    return execute(substitution, args, self.thisArg, construct)
  }

  const mimicked = state.mimicked
  if (mimicked !== undefined) {
    const instance = mimicked.instance
    if (key === SELF) {
      if (typeof instance === 'function') return callOrConstruct(instance, self.thisArg, args, construct)
    } else {
      const member = instance[key]
      if (typeof member === 'function') return callOrConstruct(member, self.explicit ? self.thisArg : instance, args, construct)
    }
  }
  return NOT_CONFIGURED
}

const resolveCall = (state: SubstituteState, key: PropertyKey, args: any[], record: CallRecord, self: Self): any => {
  const hashes = new ArgumentHashes(args)
  const answer = configuredAnswer(state, key, args, hashes, record, self)
  // E23: `new` answers with an object; for any other configured value it gives the auto-substitute of the call
  if (answer !== NOT_CONFIGURED && (self !== CONSTRUCT || isObjectLike(answer))) return answer
  const entry = state.callEntry(key, hashes)
  entry.handOut(record)
  return entryProxy(entry)
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
const setupFunction = (entry: AutoEntry, method: SubstitutionMethod, chainHead: CallRecord | undefined): Function => {
  const specification = entry.kind === 'call' && entry.args!.argumentsClass !== 'plain'
    ? RecordedArguments.from(actualArgumentsOf(entry, chainHead)) // handed out by a matcher setup: configure the actual call
    : entry.args
  retract(chainHead)
  return function substitution(...values: any[]) {
    validateSubstitution(method, values, () => entry.kind === 'get'
      ? entry.parent.memberPath(entry.key)
      : describeCall(entry.parent, entry.key, specification!.value), substitution)
    if (entry.kind === 'get') entry.parent.setPropertySubstitution(entry.key, method, values)
    else entry.parent.addCallSubstitution(entry.key, specification!, method, values)
  }
}

const resolveStringAssertion = (entry: AutoEntry, chainHead: CallRecord | undefined, stackStart: Function): { state: SubstituteState, count: ExpectedCount } => {
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
        return createAssertionProxy(getState(), expected)
      }
    case 'didNotReceive':
      return function didNotReceive() {
        retract(chainHead)
        return createAssertionProxy(getState(), 0)
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
    construct: function construct(_target: unknown, args: any[]) {
      return constructed(invoke(state, key, args, construct, record, undefined, CONSTRUCT))
    }
  })
}

// ---- assertions -------------------------------------------------------------------------------

const describeCount = (count: ExpectedCount) => count === undefined ? 'received()' : count === 0 ? 'didNotReceive()' : `received(${count})`

const createAssertionProxy = (state: SubstituteState, count: ExpectedCount): any => {
  const print: Printer = () => `${state.path}.${describeCount(count)}`
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      return assertionMember(state, property, count, get)
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      assertSet(state, property, value, count, set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      assertDirectCall(state, args, count, apply)
      return undefined
    },
    // E23: a check of `new` is a check of the call
    construct: function construct(_target: unknown, args: any[]) {
      assertDirectCall(state, args, count, construct)
      return {}
    }
  })
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
  if (Object.getPrototypeOf(value) === faceTargetPrototype) {
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
