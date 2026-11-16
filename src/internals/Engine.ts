import { inspect, InspectOptions } from 'util'

import { substituteMarker } from '../shared'
import { AutoEntry, Substitution, SubstituteState } from './SubstituteState'
import { CallRecord, currentSequence, retract } from './CallRecord'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException } from './SubstituteException'
import { assertCall, assertPropertyRead, assertSet, settle, validateExpectedCount, ExpectedCount } from './Assertions'
import {
  ContextMethod, FunctionHelperKey, INTERNAL, SELF, SpecialProperty, SubstitutionMethod,
  contextMethodOf, isFunctionHelperKey, isSpecialProperty, isStringAssertionKey, keyToString, substitutionMethodOf
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
type Face =
  | { kind: 'root', state: SubstituteState }
  | { kind: 'member', entry: AutoEntry }   // the result of reading an unconfigured member
  | { kind: 'result', entry: AutoEntry }   // the result of an unconfigured call

const TAKE_PENDING_READ = Symbol('take pending read')
type ReadSource = typeof TAKE_PENDING_READ | CallRecord | undefined

const newTarget = (): any => function () { }

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
  switch (face.kind) {
    case 'root': return printState(face.state, colors)
    case 'member': return `property<${memberLabel(face.entry.key)}>: `
    case 'result': return withPrintGuard(() => `method<${memberLabel(face.entry.key)}>: ${formatArguments(face.entry.args?.value, colors)}`)
  }
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

export const createSubstitute = (): any => createFaceProxy({ kind: 'root', state: new SubstituteState() })

const entryProxy = (entry: AutoEntry): any => {
  if (entry.proxy === undefined)
    entry.proxy = createFaceProxy(entry.kind === 'get' ? { kind: 'member', entry } : { kind: 'result', entry })
  return entry.proxy
}

const faceState = (face: Face): SubstituteState => face.kind === 'root' ? face.state : face.entry.state
const faceChainHead = (face: Face): CallRecord | undefined => face.kind === 'root' ? undefined : face.entry.chainHead()

const createFaceProxy = (face: Face): any => new Proxy(newTarget(), {
  get: function get(_target: unknown, property: PropertyKey) {
    return faceGet(face, property, get)
  },
  set: function set(_target: unknown, property: PropertyKey, value: unknown) {
    faceSet(face, property, value, set)
    return true
  },
  apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
    return faceApply(face, args, apply)
  }
})

const faceGet = (face: Face, property: PropertyKey, stackStart: Function): any => {
  if (isSpecialProperty(property)) return special(property, options => printFace(face, colorsOf(options)), face)

  if (face.kind !== 'root') {
    const entry = face.entry
    const method = substitutionMethodOf(property)
    if (method !== undefined) return setupFunction(entry, method)

    if (face.kind === 'member' && isFunctionHelperKey(property))
      return functionHelper(property, (args, start) => invoke(entry.parent, entry.key, args, start, TAKE_PENDING_READ))

    // D11: `sub.received(n)` followed by a member access other than a substitution method is an assertion.
    if (face.kind === 'result' && isStringAssertionKey(entry.key)) {
      const assertion = resolveStringAssertion(entry, stackStart)
      return assertionMember(assertion.state, property, assertion.count, stackStart)
    }
  }

  const context = contextMethodOf(property)
  if (context !== undefined) return contextFunction(context, () => faceState(face), faceChainHead(face))

  const chainHead = faceChainHead(face)
  return realGet(faceState(face), property, chainHead, stackStart)
}

const faceSet = (face: Face, property: PropertyKey, value: unknown, stackStart: Function): void => {
  if (face.kind === 'result' && isStringAssertionKey(face.entry.key)) {
    const assertion = resolveStringAssertion(face.entry, stackStart)
    assertSet(assertion.state, property, value, assertion.count, stackStart)
    return
  }
  const chainHead = faceChainHead(face)
  realSet(faceState(face), property, value, chainHead, stackStart)
}

const faceApply = (face: Face, args: any[], stackStart: Function): any => {
  switch (face.kind) {
    case 'root':
      return invoke(face.state, SELF, args, stackStart, undefined)
    case 'member':
      return invoke(face.entry.parent, face.entry.key, args, stackStart, TAKE_PENDING_READ)
    case 'result': {
      const chainHead = face.entry.chainHead()
      return invoke(face.entry.state, SELF, args, stackStart, undefined, chainHead)
    }
  }
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

/** A real property read by the code under test. */
const realGet = (state: SubstituteState, key: PropertyKey, chainPrevious: CallRecord | undefined, stackStart: Function): any => {
  const substitution = state.propertySubstitution(key)
  if (substitution !== undefined) {
    const record = state.addRecord('get', key, undefined, stackStart, chainPrevious)
    // Configured both as a property and as a method: whether this read is a property read is only known later.
    if (state.hasCallSubstitutions(key)) return deferredRead(state, key, record, substitution)
    return execute(substitution)
  }

  const mimicked = state.mimicked
  if (mimicked !== undefined && hasMember(mimicked.instance, key)) {
    const value = mimicked.instance[key]
    if (typeof value !== 'function') {
      state.addRecord('get', key, undefined, stackStart, chainPrevious)
      return value
    }
  }

  const record = state.addRecord('get', key, undefined, stackStart, chainPrevious)
  state.addPendingRead(record)
  const entry = state.propertyEntry(key)
  entry.handOut(record)
  return entryProxy(entry)
}

/** A real property assignment by the code under test. */
const realSet = (state: SubstituteState, key: PropertyKey, value: unknown, chainPrevious: CallRecord | undefined, stackStart: Function): void => {
  state.addRecord('set', key, [value], stackStart, chainPrevious)
  if (state.mimicked !== undefined) state.mimicked.instance[key] = value
}

/**
 * An invocation. With Arg matchers among the arguments it is a setup (D3): nothing is recorded and no
 * substitution runs. Otherwise it is a real call: it is recorded (taking over the property read of the
 * method, if there is one) and resolved.
 */
const invoke = (state: SubstituteState, key: PropertyKey, args: any[], stackStart: Function, readSource: ReadSource, chainPrevious?: CallRecord): any => {
  const read = readSource === TAKE_PENDING_READ ? state.takePendingRead(key) : readSource

  if (RecordedArguments.containsMatchers(args)) {
    const specification = RecordedArguments.forSpecification(args)
    retract(read)
    retract(chainPrevious)
    return configureCall(state, key, specification)
  }

  let record: CallRecord
  if (read !== undefined && read.kind === 'get' && !read.retracted) {
    read.convertToCall(args, stackStart)
    record = read
  } else record = state.addRecord('call', key, args, stackStart, chainPrevious)

  return resolveCall(state, key, args, record)
}

const resolveCall = (state: SubstituteState, key: PropertyKey, args: any[], record: CallRecord): any => {
  const substitution = state.findCallSubstitution(key, args)
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

  const entry = state.callEntry(key, args)
  entry.handOut(record)
  return entryProxy(entry)
}

/** The actual arguments of the call that handed out this auto-substitute, when that was the previous operation. */
const actualArgumentsOf = (entry: AutoEntry): any[] => {
  const head = entry.chainHead()
  if (head !== undefined && head.kind === 'call' && head.args !== undefined) return head.args
  return entry.args?.value ?? []
}

/** `.returns(...)` and friends on a handle: configures the member read or the call that produced the handle. */
const setupFunction = (entry: AutoEntry, method: SubstitutionMethod): Function => {
  const specification = entry.kind === 'call' && entry.args!.argumentsClass !== 'plain'
    ? RecordedArguments.from(actualArgumentsOf(entry)) // handed out by a matcher setup: configure the actual call
    : entry.args
  retract(entry.chainHead())
  return function substitution(...values: any[]) {
    if (entry.kind === 'get') entry.parent.setPropertySubstitution(entry.key, method, values)
    else entry.parent.addCallSubstitution(entry.key, specification!, method, values)
  }
}

const resolveStringAssertion = (entry: AutoEntry, stackStart: Function): { state: SubstituteState, count: ExpectedCount } => {
  const args = actualArgumentsOf(entry)
  retract(entry.chainHead())
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
  return new Proxy(newTarget(), {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) {
        if (record.seq === currentSequence()) retract(record)
        return function substitution(...values: any[]) {
          state.setPropertySubstitution(key, method, values)
        }
      }
      if (isFunctionHelperKey(property)) return functionHelper(property, (args, start) => invoke(state, key, args, start, record))
      return resolve()[property]
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
  return new Proxy(newTarget(), {
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
  return new Proxy(newTarget(), {
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
  return new Proxy(newTarget(), {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
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
  return new Proxy(newTarget(), {
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

/** A call in a setup: `.returns(...)` configures it, anything else configures the auto-substitute it returns. */
const configureCall = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments): any => {
  const print: Printer = options => withPrintGuard(() => `method<${memberLabel(key)}>: ${formatArguments(specification.value, colorsOf(options))} (configure)`)
  return new Proxy(newTarget(), {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const method = substitutionMethodOf(property)
      if (method !== undefined) return function substitution(...values: any[]) {
        state.addCallSubstitution(key, specification, method, values)
      }
      return configureMember(nestedEntry(state, key, specification).state, property)
    },
    set: function set() {
      throw configureSetError(set)
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return configureCall(nestedEntry(state, key, specification).state, SELF, RecordedArguments.forSpecification(args))
    }
  })
}
