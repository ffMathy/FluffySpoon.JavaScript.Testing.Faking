import { inspect, InspectOptions, types } from 'util'

import { isSubstituteProxy, substituteMarker } from '../shared'
import { ArgumentHashes, AutoEntry, Substitution, SubstituteState } from './SubstituteState'
import { CallRecord, currentSequence, retract } from './CallRecord'
import { CallSite, Frame, sameExpression } from './CallSite'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException } from './SubstituteException'
import { assertCall, assertPropertyRead, assertSet, settle, validateExpectedCount, ExpectedCount } from './Assertions'
import {
  ContextMethod, FunctionHelperKey, INTERNAL, SELF, SpecialProperty, SubstitutionMethod,
  contextMethodOf, isFunctionHelperKey, isProtocolKey, isSpecialProperty, isStringAssertionKey, keyToString, substitutionMethodOf
} from './Constants'
import { formatArguments, formatValue, isPrinting, withPrintGuard } from './utilities'

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
 */
const newTarget = (print: Printer): any => {
  const target = function () { }
  Object.defineProperty(target, inspect.custom, {
    value: (_depth: number, options?: InspectOptions) => print(options),
    configurable: true
  })
  return target
}

// ---- printing ---------------------------------------------------------------------------------

const memberLabel = (key: PropertyKey) => key === SELF ? 'call' : keyToString(key)

const printState = (state: SubstituteState, colors: boolean): string => {
  if (isPrinting()) return state.path
  return withPrintGuard(() => {
    const lines: string[] = []
    const records = state.records
    if (records.length > 0) {
      lines.push('  received:')
      for (const record of records) {
        const name = record.key === SELF ? '' : keyToString(record.key)
        const suffix = record.kind === 'call'
          ? formatArguments(record.args, colors)
          : record.kind === 'set' ? ` = ${formatValue(record.args?.[0], colors)}` : ''
        lines.push(`    ${name}${suffix}`)
      }
    }
    const substitutions = state.substitutions()
    if (substitutions.length > 0) {
      lines.push('  configured:')
      for (const substitution of substitutions) {
        const name = substitution.key === SELF ? '' : keyToString(substitution.key)
        const args = substitution.kind === 'call' ? formatArguments(substitution.args?.value, colors) : ''
        const values = substitution.method === 'auto' ? '' : substitution.values.map(value => formatValue(value, colors)).join(', ')
        lines.push(`    ${name}${args} => ${substitution.method}(${values})`)
      }
    }
    return `${state.path} {${lines.length > 0 ? '\n' + lines.join('\n') : ''}\n}`
  })
}

const printFace = (face: Face, colors: boolean): string => {
  if (!(face instanceof AutoEntry)) return printState(face, colors)
  if (face.kind === 'get') return `property<${memberLabel(face.key)}>: `
  return withPrintGuard(() => `method<${memberLabel(face.key)}>: ${formatArguments(face.args?.value, colors)}`)
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
 * test's call with it when the test configures or checks that value. Without stack frames (Error.stackTraceLimit
 * = 0), adjacency alone decides.
 */

/** The frame of the current operation, read only when it is needed (the trap function is the stack start). */
const frameAt = (stackStart: Function) => (): Frame | null => CallSite.capture(stackStart).frame

/** The candidate (an adjacent hand-out) if the current operation continues its expression. */
const continuedChain = (candidate: CallRecord | undefined, current: () => Frame | null): CallRecord | undefined => {
  if (candidate === undefined) return undefined
  const head = candidate.frame
  return head === null || sameExpression(head, current()) ? candidate : undefined
}

/** Links a new record to the candidate if it continues the candidate's expression. */
const linkChain = (record: CallRecord, candidate: CallRecord | undefined): CallRecord => {
  if (continuedChain(candidate, () => record.frame) !== undefined) record.chainPrevious = candidate
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

const faceHandler: ProxyHandler<FaceTarget> = {
  get: function get(target: FaceTarget, property: PropertyKey) {
    return faceGet(target(), property, get)
  },
  set: function set(target: FaceTarget, property: PropertyKey, value: unknown) {
    faceSet(target(), property, value, set)
    return true
  },
  apply: function apply(target: FaceTarget, thisArg: unknown, args: any[]) {
    return faceApply(target(), thisArg, args, apply)
  },
  // like constructing the plain function the target used to be: an empty object, nothing recorded
  construct: () => ({})
}

// bound to the face: a bound function is smaller than a closure and its context
const returnThis = function (this: Face): Face { return this }

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

    if (entry.kind === 'get' && isFunctionHelperKey(property))
      return functionHelper(property, (args, start) => invoke(entry.parent, entry.key, args, start, TAKE_PENDING_READ))

    // D11: `sub.received(n)` followed by a member access other than a substitution method is an assertion.
    if (entry.kind === 'call' && isStringAssertionKey(entry.key)) {
      const assertion = resolveStringAssertion(entry, chainHead(), stackStart)
      return assertionMember(assertion.state, property, assertion.count, stackStart)
    }
  }

  const context = contextMethodOf(property)
  if (context !== undefined) return contextFunction(context, () => faceState(face), chainHead())

  return realGet(faceState(face), property, candidate, stackStart)
}

const faceSet = (face: Face, property: PropertyKey, value: unknown, stackStart: Function): void => {
  const candidate = adjacentHandOut(face)
  if (face instanceof AutoEntry && face.kind === 'call' && isStringAssertionKey(face.key)) {
    const assertion = resolveStringAssertion(face, continuedChain(candidate, frameAt(stackStart)), stackStart)
    assertSet(assertion.state, property, value, assertion.count, stackStart)
    return
  }
  realSet(faceState(face), property, value, candidate, stackStart)
}

const faceApply = (face: Face, _thisArg: unknown, args: any[], stackStart: Function): any => {
  if (!(face instanceof AutoEntry)) return invoke(face, SELF, args, stackStart, undefined)
  if (face.kind === 'get') return invoke(face.parent, face.key, args, stackStart, TAKE_PENDING_READ)
  return invoke(face.state, SELF, args, stackStart, undefined, face.adjacentHandOut())
}

/** `.call`, `.apply` and `.bind` on a member behave like invoking the member (D7). */
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

const execute = (substitution: Substitution, args?: any[]): any => {
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
      return args === undefined ? value() : value(...args)
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

/** A real property read by the code under test. */
const realGet = (state: SubstituteState, key: PropertyKey, chainCandidate: CallRecord | undefined, stackStart: Function): any => {
  if (isProtocolKey(key) && !answersProtocolKey(state, key)) return undefined

  const substitution = state.propertySubstitution(key)
  if (substitution !== undefined) {
    const record = linkChain(state.addRecord('get', key, undefined, stackStart), chainCandidate)
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
    if (delegate && typeof value !== 'function') {
      linkChain(state.addRecord('get', key, undefined, stackStart), chainCandidate)
      return value
    }
  }

  const record = linkChain(state.addRecord('get', key, undefined, stackStart), chainCandidate)
  state.addPendingRead(record)
  const entry = state.propertyEntry(key)
  entry.handOut(record)
  return entryProxy(entry)
}

/** A real property assignment by the code under test. */
const realSet = (state: SubstituteState, key: PropertyKey, value: unknown, chainCandidate: CallRecord | undefined, stackStart: Function): void => {
  linkChain(state.addRecord('set', key, [value], stackStart), chainCandidate)
  if (state.mimicked !== undefined) state.mimicked.instance[key] = value
}

/**
 * An invocation. With Arg matchers among the arguments it is a setup (D3): nothing is recorded and no
 * substitution runs. Otherwise it is a real call: it is recorded (taking over the property read of the
 * method, if there is one) and resolved.
 */
const invoke = (state: SubstituteState, key: PropertyKey, args: any[], stackStart: Function, readSource: ReadSource, chainCandidate?: CallRecord): any => {
  const read = readSource === TAKE_PENDING_READ ? state.takePendingRead(key) : readSource

  if (RecordedArguments.containsMatchers(args)) {
    const specification = RecordedArguments.forSpecification(args)
    retract(read)
    retract(continuedChain(chainCandidate, frameAt(stackStart)))
    return configureCall(state, key, specification, isStringAssertionKey(key))
  }

  let record: CallRecord
  if (read !== undefined && read.kind === 'get' && !read.retracted) {
    read.convertToCall(args, stackStart)
    record = read
  } else record = linkChain(state.addRecord('call', key, args, stackStart), chainCandidate)

  return resolveCall(state, key, args, record)
}

const resolveCall = (state: SubstituteState, key: PropertyKey, args: any[], record: CallRecord): any => {
  const hashes = new ArgumentHashes(args)
  const substitution = state.findCallSubstitution(key, hashes)
  if (substitution !== undefined) {
    if (substitution.method === 'auto') substitution.entry!.handOut(record)
    return execute(substitution, args)
  }

  const mimicked = state.mimicked
  if (mimicked !== undefined) {
    const instance = mimicked.instance
    if (key === SELF) {
      if (typeof instance === 'function') return Reflect.apply(instance, undefined, args)
    } else {
      const member = instance[key]
      if (typeof member === 'function') return Reflect.apply(member, instance, args)
    }
  }

  const entry = state.callEntry(key, hashes)
  entry.handOut(record)
  return entryProxy(entry)
}

/** The actual arguments of the call that handed out this auto-substitute, when it is part of the same expression. */
const actualArgumentsOf = (entry: AutoEntry, chainHead: CallRecord | undefined): any[] => {
  if (chainHead !== undefined && chainHead.kind === 'call' && chainHead.args !== undefined) return chainHead.args
  return entry.args?.value ?? []
}

/** `.returns(...)` and friends on a handle: configures the member read or the call that produced the handle. */
const setupFunction = (entry: AutoEntry, method: SubstitutionMethod, chainHead: CallRecord | undefined): Function => {
  const specification = entry.kind === 'call' && entry.args!.argumentsClass !== 'plain'
    ? RecordedArguments.from(actualArgumentsOf(entry, chainHead)) // handed out by a matcher setup: configure the actual call
    : entry.args
  retract(chainHead)
  return function substitution(...values: any[]) {
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
  const print: Printer = () => `property<${memberLabel(key)}>: `
  return new Proxy(newTarget(print), {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) {
        if (record.seq === currentSequence()) retract(continuedChain(record, frameAt(get)))
        return function substitution(...values: any[]) {
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
    }
  })
}

// ---- assertions -------------------------------------------------------------------------------

const describeCount = (count: ExpectedCount) => count === undefined ? 'received()' : count === 0 ? 'didNotReceive()' : `received(${count})`

const createAssertionProxy = (state: SubstituteState, count: ExpectedCount): any => {
  const print: Printer = () => `${state.path}.${describeCount(count)}`
  return new Proxy(newTarget(print), {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      return assertionMember(state, property, count, get)
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      assertSet(state, property, value, count, set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      assertCall(state, SELF, args, count, apply)
      return undefined
    }
  })
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
  return new Proxy(newTarget(print), {
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
  return new Proxy(newTarget(print), {
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
    }
  })
}

const configureMember = (state: SubstituteState, key: PropertyKey): any => {
  const context = contextMethodOf(key)
  if (context !== undefined) return contextFunction(context, () => state, undefined)
  const print: Printer = () => `${state.memberPath(key)} (configure)`
  return new Proxy(newTarget(print), {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) return function substitution(...values: any[]) {
        state.setPropertySubstitution(key, method, values)
      }
      if (isFunctionHelperKey(property))
        return functionHelper(property, args => configureCall(state, key, RecordedArguments.forSpecification(args)))
      return configureMember(state.propertyEntry(key).state, property)
    },
    set: function set() {
      throw configureSetError(set)
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
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
 * A call in a setup: `.returns(...)` configures it, anything else configures the auto-substitute it returns.
 *
 * `stringAssertion` marks a call of the string `received` / `didNotReceive` with Arg matchers among its
 * arguments, outside a configure() view. Followed by a substitution method it is a setup of a member with that
 * name like any other; followed by any other member access or an assignment it is the assertion API (D11), so
 * `sub.received(Arg.any()).add(1)` reports the invalid count (D10) instead of configuring something silently.
 */
const configureCall = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments, stringAssertion = false): any => {
  const print: Printer = options => withPrintGuard(() => `method<${memberLabel(key)}>: ${formatArguments(specification.value, colorsOf(options))} (configure)`)
  const assertionCount = (start: Function): ExpectedCount =>
    key === 'didNotReceive' ? 0 : validateExpectedCount(specification.value?.[0], start)
  return new Proxy(newTarget(print), {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) return function substitution(...values: any[]) {
        state.addCallSubstitution(key, specification, method, values)
      }
      if (stringAssertion) return assertionMember(state, property, assertionCount(get), get)
      return configureMember(nestedEntry(state, key, specification).state, property)
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      if (!stringAssertion) throw configureSetError(set)
      assertSet(state, property, value, assertionCount(set), set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return configureCall(nestedEntry(state, key, specification).state, SELF, RecordedArguments.forSpecification(args))
    }
  })
}
