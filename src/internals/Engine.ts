import { inspect, InspectOptions, types } from 'util'

import { constants, isSubstituteProxy, substituteMarker } from '../shared'
import { ArgumentHashes, AutoEntry, Substitution, SubstituteState } from './SubstituteState'
import { pathArguments, recordLabelContext, relativePath, relativeRecordPath } from './Paths'
import { CallRecord, currentSequence, pairReadings, retract } from './CallRecord'
import { Frame, StackHolder, captureStack, currentFrame, sameExpression } from './CallSite'
import { RecordedArguments, isComparing } from './RecordedArguments'
import { MAX_LISTED_CALLS, SubstituteException } from './SubstituteException'
import {
  assertCall, assertPropertyRead, assertSet, checkViewSite, deferDanglingCheck, settle, validateExpectedCount, CheckSubject, DeferredAssertion,
  ExpectedCount, SeveralSubstitutes
} from './Assertions'
import {
  ContextMethod, FunctionHelperKey, INTERNAL, SELF, SpecialProperty, StringAssertionKey, SubstitutionMethod,
  answersOnlyItself, contextMethodOf, isForeignSymbol, isFunctionHelperKey, isProtocolKey, isSpecialProperty, isStringAssertionKey, keyToString, substitutionMethodOf
} from './Constants'
import { describeOtherReading, formatArguments, formatValue, isPrinting, withPrintGuard } from './utilities'
import { libraryGuard } from './utilities/Guard'
import { isLooked, lookedPeek } from './utilities/Look'

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
 * target of a proxy (it does not trigger traps), so the target carries the printer: it is a bound function that
 * returns its printer, and its inspect.custom hook is inherited from a shared prototype (E58: cheaper than a hook of its
 * own per view). It can be constructed (E23), and it has no non-configurable `prototype`, so that the traps can hide
 * its own properties (E25, see viewTraps).
 */
/*
 * E40: a neutral name for util.inspect without custom inspection (see returnThis). E64: the declared parameters are never
 * used; they give the targets bound from this function (and from returnThis) the arity that brands them (see
 * isLibraryTarget).
 */
const viewFunction = function substitute(this: Printer, _1?: unknown, _2?: unknown, _3?: unknown, _4?: unknown, _5?: unknown, _6?: unknown, _7?: unknown): Printer { return this }

/**
 * The inspect.custom hook of the views' targets. util.inspect reads it from the target of a proxy, but calls it with the
 * proxy itself as `this`: then it asks the view for its hook (its traps answer inspect.custom with the printer, see
 * special), and never invokes the proxy, which would be a check or a setup. Called on the target itself (util.inspect
 * with showProxy, `util.format('%o', view)`), it asks the target. Any other value that inherits it prints as itself.
 */
const inspectView = function (this: unknown, depth: number, options?: InspectOptions): string {
  if (types.isProxy(this)) {
    const hook = (this as any)[inspect.custom]
    return typeof hook === 'function' && hook !== inspectView ? hook(depth, options) : inspectForeign(this as object, options)
  }
  if (typeof this === 'function' && isLibraryTarget(this)) return (this() as Printer)(options)
  return isObjectLike(this) ? inspectForeign(this, options) : ''
}

/*
 * R10-ADV-3, R10-ADV-4, E64 (R11-ADV-2, R11-ADV-3): a function of the code under test can inherit the shared prototypes of
 * the targets: mimic-fn (used by mem, p-memoize, debounce-fn and onetime) and util.promisify copy the prototype of the
 * function they wrap, and so does Function.prototype.bind, natively (`mem(api.m.bind(api)).bind(null, 1)`,
 * `Function.prototype.bind.call(sub, ctx)`, `util.promisify(fs.readFile).bind(null, path)`). Such a function is not the
 * library's: the inherited inspect.custom hooks print it as an ordinary function and never call it, and it is not taken
 * for a substitute (isFaceProxy requires a proxy).
 *
 * The hooks call `this` only when it is one of the library's own targets, recognised by a brand that binding, wrapping
 * and copying prototypes do not reproduce: a target is a bound function (native source text) bound, with no arguments,
 * from returnThis or viewFunction, so its own `name` is exactly 'bound substitute' and its own `length` is exactly
 * TARGET_LENGTH, their unusual arity. A natively bound function is named after the function it binds ('bound memoized',
 * and 'bound ' for a substitute, whose `name` reads as an auto-substitute, not a string), and gets that function's
 * arity less its bound arguments; a mimic-fn wrapper keeps its own arity, and the `length` that a substitute reports
 * (E65, which util.promisify copies) is 0. The proxies never let the code under test reach a target. A target that the
 * code under test froze or gave properties (E25) has lost its `name` and `length`: it is recognised by identity
 * (ownedTargets). The descriptors are read only from values that are not proxies, so reading them runs no code of the
 * code under test. (No per-target bookkeeping otherwise: D30 keeps an auto-substitute small.)
 */
const TARGET_NAME = 'bound substitute'
const TARGET_LENGTH = 7
const functionToString = Function.prototype.toString
const boundSourceText = functionToString.call(function () { /* empty */ }.bind(null))
const isLibraryTarget = (value: Function): boolean => {
  try {
    if (ownedTargetCount > 0 && ownedTargets.has(value)) return true
    const name = Reflect.getOwnPropertyDescriptor(value, 'name')
    if (name === undefined || name.value !== TARGET_NAME) return false
    const length = Reflect.getOwnPropertyDescriptor(value, 'length')
    return length !== undefined && length.value === TARGET_LENGTH && functionToString.call(value) === boundSourceText
  } catch {
    return false
  }
}

/** An ordinary printout of a value that merely inherits one of the hooks (see isLibraryTarget): never calls it. */
const inspectForeign = (value: object, options?: InspectOptions): string =>
  inspect(value, Object.assign({}, options, { customInspect: false }))

const viewTargetPrototype = Object.create(Function.prototype, {
  [inspect.custom]: { value: inspectView, configurable: true }
})

const viewTarget = (print: Printer): any => {
  const target = viewFunction.bind(print)
  Object.setPrototypeOf(target, viewTargetPrototype)
  return target
}

/** The printer of a view, from its target (see viewTarget). */
const viewPrinter = (target: () => Printer): Printer => target()

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

const definePropertyError = (target: () => Printer, start: Function) =>
  viewChangeError('Object.defineProperty()', viewPrinter(target), start)
const preventExtensionsError = (target: () => Printer, start: Function) =>
  viewChangeError('Object.preventExtensions() (or Object.freeze(), Object.seal())', viewPrinter(target), start)

/*
 * E65 (R11FE-5): every function has own `length` and `name` properties, and code that adapts functions relies on them:
 * Node.js' util.callbackify reads Object.getOwnPropertyDescriptors(fn).length.value, and util.promisify and mimic-fn
 * copy them. So substitutes, auto-substitutes and the views report them as own data properties, non-enumerable and
 * configurable, as for a function: `length` is 0, and `name` is the member of a member handle (`getKey` for
 * `keys.getKey`, `[description]` for a symbol), `bound getKey` for `keys.getKey.bind(keys)` (as Function.prototype.bind
 * names a function), '' otherwise. They are only reported: reading `sub.length` or
 * `sub.name` is a read of a member like any other (recorded, configurable, an auto-substitute when unconfigured), `in`
 * answers as before (E26), and Object.keys, spread, for-in, Object.assign and JSON.stringify see nothing new (the
 * properties are not enumerable). The targets have own `length` and `name` too (bound functions, see isLibraryTarget),
 * but configurable ones, so what the traps report cannot conflict with them. A substitute that is frozen, sealed or
 * made non-extensible (E25) reports the properties of its target from then on, exactly: a proxy whose target is not
 * extensible cannot report a property its target does not have, and its target has only those that the code under
 * test defined (see takeOver).
 */
const FUNCTION_KEYS: readonly string[] = ['length', 'name']

/** The keys with `length` and `name` added (the list is a fresh one, which this changes). */
const withFunctionKeys = (keys: Array<string | symbol>): Array<string | symbol> => {
  for (const key of FUNCTION_KEYS) if (!keys.includes(key)) keys.push(key)
  return keys
}

/** The descriptor of a function's own `length` or `name` (undefined for any other key). */
const functionDescriptor = (property: PropertyKey, name: () => string): PropertyDescriptor | undefined => {
  if (property === 'length') return { value: 0, writable: false, enumerable: false, configurable: true }
  if (property === 'name') return { value: name(), writable: false, enumerable: false, configurable: true }
  return undefined
}

const anonymous = () => ''

/** The traps that every view shares (E58: one set for all of them, see createView). */
const viewTraps = {
  defineProperty: function defineProperty(target: () => Printer): boolean {
    throw definePropertyError(target, defineProperty)
  },
  preventExtensions: function preventExtensions(target: () => Printer): boolean {
    throw preventExtensionsError(target, preventExtensions)
  },
  deleteProperty: (): boolean => true,
  // E65: only the `length` and `name` that every function has
  ownKeys: (): Array<string | symbol> => FUNCTION_KEYS.slice(),
  getOwnPropertyDescriptor: (_target: unknown, property: PropertyKey): PropertyDescriptor | undefined => functionDescriptor(property, anonymous)
}

/**
 * A short-lived proxy (see viewTarget and viewTraps). The handler's own defineProperty, preventExtensions and
 * getOwnPropertyDescriptor traps, if it has them, take the place of the shared ones (E48: an assertion view is told
 * that the code changes it; E65: a bound function has a name of its own).
 */
const createView = (print: Printer, handler: ProxyHandler<any>): any => {
  if (handler.defineProperty === undefined) handler.defineProperty = viewTraps.defineProperty
  if (handler.preventExtensions === undefined) handler.preventExtensions = viewTraps.preventExtensions
  handler.deleteProperty = viewTraps.deleteProperty
  handler.ownKeys = viewTraps.ownKeys
  if (handler.getOwnPropertyDescriptor === undefined) handler.getOwnPropertyDescriptor = viewTraps.getOwnPropertyDescriptor
  return new Proxy(viewTarget(print), handler)
}

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
  // E99 (R15FE-5): received calls are shown with the call that a substitute shared by a setup with matchers was handed
  // out to, when there is one (see Paths.relativeRecordPath); setups keep the matchers
  const recordPrefixes = new Map<SubstituteState, string>()
  const labels = recordLabelContext(RecordedArguments.literalsEqual)
  const recordPrefixOf = (owner: SubstituteState): string => {
    let prefix = recordPrefixes.get(owner)
    if (prefix === undefined) {
      prefix = relativeRecordPath(owner, state, labels)
      recordPrefixes.set(owner, prefix)
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
      const name = memberWithin(recordPrefixOf(owner), record.key)
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
  return continuesExpression(candidate, current()) ? candidate : undefined
}

/** Links a new record to the candidate if it continues the candidate's expression (the record has its frame). */
const linkChain = (record: CallRecord, candidate: CallRecord | undefined): CallRecord => {
  if (candidate !== undefined && continuesExpression(candidate, record.frame)) record.chainPrevious = candidate
  return record
}

/**
 * D25: whether the operation at `frame` continues the expression of `candidate`, an adjacent hand-out. E111: a hand-out of
 * the substitute that was called itself (see handOutConfigured) only when the operation is on the same line, after the
 * call: such a substitute is where the next statement starts, too (`server.on('close', listener)`, then
 * `server.received(1).on('error', Arg.any())`), and a statement before it is no part of its expression (E39).
 */
const continuesExpression = (candidate: CallRecord, frame: Frame | null): boolean => {
  const from = candidate.frame
  if (!sameExpression(from, frame)) return false
  if (selfHandOutCount === 0 || candidate.handedOutItself !== true) return true
  return from !== null && frame !== null && typeof from.line === 'number' && from.line === frame.line &&
    typeof from.column === 'number' && typeof frame.column === 'number' && from.column < frame.column
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
 *
 * E81, E88, E89: what the call or (E106) the read answered is noted, for checks through a call with matchers (see
 * throughCall and throughRead). E99: a call answered with a substitute that a setup with matchers (or the mimicked
 * instance) gives every matching call is noted as such, with the hand-out (see handOutShared). E111 (R16-ADV-7): such a
 * call hands out the substitute that was called itself, too (`io.to(Arg.any()).returns(io)`, a mimicked `return this`),
 * so that a check through it in the same expression (`io.to('room-b').received(1).emit(...)`) goes through that call.
 */
const handOutConfigured = <T>(value: T, record: CallRecord, owner: SubstituteState): T => {
  const source = takeAnswerSource()
  if (isFaceProxy(value)) {
    const face = (value as any)[INTERNAL] as Face | undefined
    if (face !== undefined) {
      const shared = record.kind === 'call' && sharesAnswer(source)
      if (shared || (face instanceof AutoEntry ? face.materializedState : face) !== owner) handOutShared(face, record, owner, shared)
      owner.noteConfiguredAnswer(record, face)
    }
  } else owner.noteConfiguredAnswer(record, otherAnswer(value, source))
  return value
}

/** E106: notes what a read answered, as handOutConfigured does, for a value it does not hand out (see deferredRead). */
const noteReadAnswer = (state: SubstituteState, record: CallRecord, value: unknown): void => {
  const source = takeAnswerSource()
  const face = isFaceProxy(value) ? (value as any)[INTERNAL] as Face | undefined : undefined
  state.noteConfiguredAnswer(record, face ?? otherAnswer(value, source))
}

/**
 * E81 with E82: a call/apply invocation (see dualHelper) is one call, counted under both readings (D26): the member
 * call/apply, and the direct call of x. Notes what it answered for the record of each reading given, as
 * handOutConfigured does for other calls, so that a check through a call with matchers under either reading
 * (`api.getUser(Arg.any())[received](1).save()`, `client.rpc.call('getUser', Arg.any())[received](1).save()`) counts the
 * calls of that substitute, however the code under test made the call. E111 (R16-ADV-5): a substitute is handed out as
 * handOutConfigured hands it out (until then, the call/apply path handed out none), from the reading that answered
 * (`directAnswered`: the direct one), so that a check through a concrete call made so goes through that call when a
 * setup with matchers (or the mimicked instance) shares its answer (`rpc.call('getUser', 2).received(1).save()`,
 * `io.to.call(io, 'room-b')[received](1).emit()`, see concreteRoute), and leaves the call out (D25, E39). E88, E89: a
 * value that is not a substitute of this copy is noted as handOutConfigured notes it. Returns the value.
 */
const noteHelperAnswer = <T>(
  value: T, memberRecord: CallRecord, memberState: SubstituteState, directRecord: CallRecord | undefined, directState: SubstituteState,
  directAnswered: boolean
): T => {
  const source = takeAnswerSource()
  const isFace = isFaceProxy(value)
  const face = isFace ? (value as any)[INTERNAL] as Face | undefined : undefined
  const answer: object | undefined = isFace ? face : otherAnswer(value, source)
  if (answer !== undefined) {
    memberState.noteConfiguredAnswer(memberRecord, answer)
    if (directRecord !== undefined && directRecord.kind === 'call') directState.noteConfiguredAnswer(directRecord, answer)
  }
  if (face !== undefined) {
    // (from the reading that answered)
    const record = directAnswered && directRecord !== undefined ? directRecord : memberRecord
    const owner = record === memberRecord ? memberState : directState
    const shared = sharesAnswer(source)
    if (record.kind === 'call' && (shared || (face instanceof AutoEntry ? face.materializedState : face) !== owner)) handOutShared(face, record, owner, shared)
  }
  return value
}

/*
 * E88 (R14-ADV-5): a check through a call with matchers cannot count the calls made on a value that is not a substitute
 * (a promise from resolves(), a plain object from returns(), a thrown error), so it must know which of the matching calls
 * were answered so: every call answered with a configured value is noted, with what answered it (see throughCall).
 * E89 (R14-ADV-4): a substitute of another copy of the library is noted as the value itself.
 */

/** E88: answered by the mimicked instance (see fromMimicked). */
const MIMICKED: object = Object.freeze({ answeredBy: 'the mimicked instance' })
/** E88: the call threw, from mimicks() or a mimicked method (a throws() setup of the member is noted itself, see resolveCall). */
const THREW: object = Object.freeze({ answeredBy: 'an error' })
/** E88: answered by a configured value whose setup is not known. */
const CONFIGURED: object = Object.freeze({ answeredBy: 'a configured value' })

/**
 * E88: what gave the configured answer that was given last: its setup (set by execute once it has its value, after the
 * setup's own code ran, which can give answers of its own) or MIMICKED (see fromMimicked). Read right after the answer,
 * and E110 (the docs agent's E99 retention) taken then (see takeAnswerSource): a setup kept here would keep its values
 * alive, and a substitute among them the records it handed out last, until the next configured answer anywhere.
 */
let answerSource: Substitution | object | undefined

/** E110: what gave the configured answer that was given last (see answerSource), which is forgotten here. */
const takeAnswerSource = (): Substitution | object | undefined => {
  const source = answerSource
  answerSource = undefined
  return source
}

/**
 * E88, E89: what a call answered with a value that is not a substitute of this copy is noted with: a function that is a
 * proxy (it may be a substitute of another copy, which the check finds out, see throughCall; nothing is asked of it here,
 * on every call), or else what gave the value (`source`, see answerSource). E104: a function bound from a substitute of
 * this copy (see boundProxies) is no substitute: what gave it.
 */
const otherAnswer = (value: unknown, source: Substitution | object | undefined): object =>
  typeof value === 'function' && types.isProxy(value) && !isBoundFunction(value) ? value : source ?? CONFIGURED

/**
 * E104 (R15-ADV-8): the functions that `x.bind(...)` gave on a substitute of this copy (see createBoundProxy), with the
 * substitute or auto-substitute they are bound from. They answer the library's substitute marker, but they are no
 * substitute of another copy, and no substitute at all to a check through a call with matchers: their calls are those of
 * the member they are bound from.
 */
const boundProxies = new WeakMap<object, Face>()

/**
 * E113 (R16V-3): the functions that `x.bind(...)` gave on a substitute of any copy of the library that marks them (see
 * LibraryGuard.boundFunctions), these among them: kept on the guard that the copies share, so that a function bound from a
 * substitute of another copy is no substitute either, which is found out without touching it.
 */
const boundFunctions: WeakSet<object> = ((): WeakSet<object> => {
  const shared = libraryGuard.boundFunctions
  if (shared instanceof WeakSet) return shared
  const own = new WeakSet<object>()
  try {
    libraryGuard.boundFunctions = own
  } catch { /* a guard that cannot take it: this copy's own */ }
  return own
})()

/** E104, E113: whether a value is a function that `x.bind(...)` gave on a substitute (of any copy that marks them). */
const isBoundFunction = (value: unknown): boolean => typeof value === 'function' && boundFunctions.has(value)

/** E89, E104, E113: whether a value is a substitute of another copy of the library (the caller knows it is no face of this one). */
const isOtherCopySubstitute = (value: unknown): value is Function =>
  typeof value === 'function' && isSubstituteProxy(value) && !boundFunctions.has(value)

/*
 * E99 (R15FE-5): after a nested setup through a call with matchers (`io.to(Arg.any()).emit(Arg.all()).returns(true)`), or
 * a setup with matchers that returns a substitute, every matching call answers the same substitute (NSubstitute's
 * semantics). A check through a CONCRETE call (`io.to('room-b').received(1).emit(...)`) cannot count that substitute's
 * calls as if they all came through that call. So the calls of a check expression that such a setup answered (the setup
 * that answered them has matchers, or the mimicked instance answered them: the call has no setup of its own) are found,
 * and the check counts along the route of the expression (see concreteRoute), deciding from the answers noted for the
 * calls which calls the shared substitute was returned to (see throughCall).
 * E110 (R16V-2, the docs agent's E99 retention): such a hand-out is noted with the substitute handed out, for its latest
 * hand-out only (see SubstituteState.ConfiguredHandOut), not per call: no cost per call, and nothing that keeps the
 * substitute the call was made on alive once it is dropped. Nothing is noted for other calls before the first such
 * hand-out: no cost when no such substitute is involved.
 */
let sharedHandOutCount = 0

/** E99: whether what gave an answer (answerSource) gives it to every call that matches: a setup with matchers, or the mimicked instance. */
const sharesAnswer = (source: Substitution | object | undefined): boolean =>
  source === MIMICKED || (source instanceof Substitution && source.args !== undefined && hasMatchers(source.args))

/**
 * E39, E99, E110: `record` (of `owner`) hands out the substitute `face` as a configured value, which `shared` says a setup
 * with matchers or the mimicked instance gives every call that it matches (see ConfiguredHandOut).
 */
const handOutShared = (face: Face, record: CallRecord, owner: SubstituteState, shared: boolean): void => {
  face.handOut(record)
  if (shared) sharedHandOutCount++
  face.noteConfiguredHandOut(record, owner, shared)
  // E111: the substitute itself (see continuesExpression)
  if ((face instanceof AutoEntry ? face.materializedState : face) === owner) {
    record.handedOutItself = true
    selfHandOutCount++
  }
}

/** E111: how many hand-outs of the substitute that was called itself were made (see continuesExpression), none as a rule. */
let selfHandOutCount = 0

/*
 * D30: a substitute, and every auto-substitute (one per distinct unconfigured call), is a proxy. To keep them small,
 * all of them share one handler, and the target of each one is a function that returns its face. util.inspect looks
 * at the target of a proxy without triggering traps, so the printer is inherited from a shared prototype.
 */
type FaceTarget = () => Face

/**
 * The face of the value that util.inspect calls the hook below with: a substitute or an auto-substitute (the proxy), or
 * the target of one (util.inspect with showProxy, `util.format('%o', sub)`). E64: anything else that inherits the hook is
 * never called (see isLibraryTarget).
 */
const faceOfInspected = (value: unknown): Face | undefined => {
  if (typeof value !== 'function') return undefined
  try {
    if (!types.isProxy(value)) return isLibraryTarget(value) ? (value as FaceTarget)() : undefined
    return (value as any)[INTERNAL]
  } catch {
    return undefined
  }
}

const faceTargetPrototype = Object.create(Function.prototype, {
  [inspect.custom]: {
    value: function (this: unknown, _depth: number, options?: InspectOptions) {
      const face = faceOfInspected(this)
      if (face !== undefined) return printFace(face, colorsOf(options))
      return isObjectLike(this) ? inspectForeign(this, options) : ''
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
  ((Object.getPrototypeOf(value) === faceTargetPrototype && types.isProxy(value)) ||
    (reprototypedCount > 0 && reprototyped.has(value)))

/*
 * E25: Object.freeze / seal / preventExtensions and Object.defineProperty work on a substitute. The target of its proxy
 * is a bound function whose only own properties, `length` and `name`, the proxy hides (ownKeys and
 * getOwnPropertyDescriptor report a function's `length` and `name` of their own instead, E65). The first such change
 * removes them from the target ("takes it over"), so that from then on the target's own properties are exactly the ones
 * the code under test defined, and the proxy's answers cannot conflict with them (a frozen target without own
 * properties constrains nothing; frozen `length` and `name` would bind what reading them answers). A defined property is
 * a real property: reads and assignments use it, and are not recorded. Everything else works as before, frozen or not.
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

/**
 * E62 (R10V-3): the prototype of a frozen, sealed or non-extensible substitute cannot change, as for any non-extensible
 * object: Object.setPrototypeOf (and the Object.prototype.__proto__ setter called on it) throws a TypeError that names
 * the substitute (a trap that returned false would give V8's text about the proxy trap instead). A trap cannot tell
 * Reflect.setPrototypeOf apart from them, so Reflect.setPrototypeOf throws it too, where it returns false for an
 * ordinary object. Setting the prototype it already has succeeds. (`sub.__proto__ = value` is an assignment of a member
 * of that name, like any other.)
 */
const notExtensibleError = (face: Face, start: Function): TypeError => {
  const error = new TypeError(`${face.path} is not extensible: its prototype cannot be changed after Object.freeze(), Object.seal() or Object.preventExtensions()`)
  if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(error, start)
  return error
}

/**
 * E100 (R15-ADV-4): whether an operation on a substitute (a substitute or an auto-substitute, its state, or a proxy the
 * library handed out) is part of the look at the arguments of the real call being matched against setups (see Look):
 * the substitute is among those arguments, or something looked at answered it. Asked only while such a look is under way.
 */
const looksAt = (subject: Face | object): boolean =>
  isLooked(subject instanceof AutoEntry ? subject.proxy : subject instanceof SubstituteState ? proxyOfState(subject) : subject)

/*
 * E11: capturing a call site is what an operation costs most, and the cost grows with every frame between the capture
 * and the trap function it starts from, so the traps capture it themselves, and only for operations that are recorded.
 */
const faceHandler: ProxyHandler<FaceTarget> = {
  get: function get(target: FaceTarget, property: PropertyKey, receiver: unknown) {
    if (isDefined(target, property)) return Reflect.get(target, property, receiver)
    if ((typeof property === 'symbol' || answersOnlyItself(property) || isPrinting() || isComparing() || isFunctionHelperKey(property)) &&
      inheritsFromSubstitute(receiver)) {
      const inherited = inheritedMember(target(), property, receiver)
      if (inherited !== AS_USUAL) return inherited
    }
    const face = target()
    const value = faceGet(face, property, get)
    if (value !== REAL_READ) return value
    // E95: a matcher's look leaves no trace (see peekGet); E100: when a real call is matched, a look at its arguments
    if (libraryGuard.matching > 0) return peekGet(faceState(face), property)
    if (libraryGuard.looking !== undefined && looksAt(face)) return lookedGet(faceState(face), property)
    return realGet(faceState(face), property, adjacentHandOut(face), captureStack(get))
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
  setPrototypeOf: function setPrototypeOf(target: FaceTarget, prototype: object | null) {
    if (!Reflect.setPrototypeOf(target, prototype)) throw notExtensibleError(target(), setPrototypeOf)
    const proxy = proxyOf(target())
    if (proxy !== undefined && !reprototyped.has(proxy)) {
      reprototyped.add(proxy)
      reprototypedCount++
    }
    return true
  },
  deleteProperty: (target: FaceTarget, property: PropertyKey) => !isOwned(target) || Reflect.deleteProperty(target, property),
  // E51: a substitute that mimicks an instance has the instance's enumerable own keys (see mimickedKeys);
  // E65: and every substitute has the `length` and `name` of a function, while it is extensible (see FUNCTION_KEYS)
  ownKeys: (target: FaceTarget) => {
    if (!isOwned(target)) return withFunctionKeys(mimickedKeys(target()))
    const keys = Reflect.ownKeys(target)
    return Reflect.isExtensible(target) ? withFunctionKeys(keys) : keys
  },
  getOwnPropertyDescriptor: (target: FaceTarget, property: PropertyKey) => {
    if (!isOwned(target)) return mimickedDescriptor(target(), property) ?? functionDescriptor(property, () => functionName(target()))
    const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
    return descriptor !== undefined || !Reflect.isExtensible(target) ? descriptor : functionDescriptor(property, () => functionName(target()))
  },
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
 * E80 (R12-ADV-3): a function that inherits from a substitute (`class Plugin extends sdk.Base`) has the call, apply and
 * bind of Function.prototype, as in JavaScript, so that `new (Plugin.bind(null, x))()` constructs a Plugin and
 * `Plugin.call(...)` calls Plugin (the substitute's own helpers, D26, would call or construct the substitute). A setup of
 * the substitute's member of that name, or a mimicked instance's own one (not Function.prototype's), is used instead.
 */
const inheritedMember = (face: Face, property: PropertyKey, receiver: unknown): unknown => {
  const conversion = property === 'toString' || property === 'valueOf'
  const helper = typeof receiver === 'function' && isFunctionHelperKey(property)
  if (!conversion) {
    if (answersOnlyItself(property) || isPrinting() || isComparing()) return undefined
    if (!helper && !isForeignSymbol(property)) return AS_USUAL
  }
  const state = face instanceof AutoEntry ? face.materializedState : face
  if (helper) return state !== undefined && configuresOwnHelper(state, property as FunctionHelperKey) ? AS_USUAL : (Function.prototype as any)[property]
  if (state !== undefined && configuresMember(state, property)) return AS_USUAL
  if (!conversion) return undefined
  return property === 'toString' && typeof receiver === 'function' ? Function.prototype.toString : (Object.prototype as any)[property]
}

/** E80: whether a substitute configures call, apply or bind itself, or mimicks an instance with its own (see inheritedMember). */
const configuresOwnHelper = (state: SubstituteState, key: FunctionHelperKey): boolean => {
  if (state.propertySubstitution(key) !== undefined || state.hasCallSubstitutions(key)) return true
  const instance = state.mimicked?.instance
  return instance !== undefined && hasMember(instance, key) && instance[key] !== (Function.prototype as any)[key]
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
  // E95 (see peekGet); E100: a look at the arguments of a real call (see looksAt), whose answers are looked at too
  const looking = libraryGuard.matching > 0 || (libraryGuard.looking !== undefined && looksAt(state))
  const property = state.propertySubstitution(key)
  if (property !== undefined) {
    if (!looking) state.addRecord('get', key, undefined, captureStack(start))
    const method = !looking ? execute(property) : libraryGuard.matching > 0 ? peekExecute(property) : lookedExecute(property)
    return typeof method === 'function' ? Reflect.apply(method, receiver, []) : NO_PRIMITIVE
  }
  const call = state.findCallSubstitution(key, new ArgumentHashes([]), !looking)
  const mimicked = instance !== undefined && !isSubstituteProxy(instance) && hasMember(instance, key) &&
    typeof instance[key] === 'function' && !isDefaultConversion(instance[key])
  if ((call === undefined || call.method === 'auto') && !mimicked) return NO_PRIMITIVE
  if (looking) return libraryGuard.matching > 0 ? peekCall(state, key, [], NO_SELF) : lookedCall(state, key, [], NO_SELF)
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

/**
 * E65: the `name` a substitute reports as its own: a member handle is named after its member, as a method is (`getKey`,
 * `[description]` for a symbol), so that what util.promisify, util.callbackify and mimic-fn make of it is named as for a
 * real method; a substitute itself and the result of a call are anonymous. (The `length` reported with it, 0, keeps
 * what binding or wrapping it gives apart from the library's targets, even for a member called `substitute`: see
 * isLibraryTarget.)
 */
const functionName = (face: Face): string => {
  if (!(face instanceof AutoEntry) || face.kind !== 'get') return ''
  const key = face.key
  // (String(symbol) is `Symbol(description)`; Node.js 10 has no Symbol.prototype.description)
  return typeof key === 'symbol' ? `[${String(key).slice(7, -1)}]` : String(key)
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
const returnThis = function substitute(this: Face, _1?: unknown, _2?: unknown, _3?: unknown, _4?: unknown, _5?: unknown, _6?: unknown, _7?: unknown): Face { return this }

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
    if (stringCheck) return stringCheckMember(entry, property, chainHead(), stackStart)
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
  if (context !== undefined) return faceContextFunction(face, context, chainHead())

  // D28: an unconfigured protocol key reads as undefined, and is not recorded
  if (isProtocolKey(property) && !answersProtocolKey(faceState(face), property)) return undefined
  return REAL_READ
}

/** `sub.received(n).member` (see faceGet; a function of its own, which keeps faceGet small for the hot path). */
const stringCheckMember = (entry: AutoEntry, property: PropertyKey, chainHead: CallRecord | undefined, stackStart: Function): any => {
  const assertion = resolveStringAssertion(entry, chainHead, stackStart)
  return assertion.other !== undefined ? assertion.other[property] : assertionMember(useOf(assertion.state), property, assertion.count, stackStart)
}

/**
 * The function behind a symbol of the library read on a substitute (see contextFunction). E99: a check through a concrete
 * call that a setup with matchers answered counts along its expression (see concreteRoute).
 */
const faceContextFunction = (face: Face, context: ContextMethod, head: CallRecord | undefined): Function => {
  const check = (context === 'received' || context === 'didNotReceive') && head !== undefined
  // E111: the check view uses the hand-out up: the next statement does not continue its expression (a substitute that a
  // setup with matchers answers with itself, `io.to(Arg.any()).returns(io)`, is where the next statement starts as well)
  if (check) face.forgetHandOut(head!)
  const subject = check && sharedHandOutCount > 0 ? () => concreteSubject(faceState(face), head) : undefined
  return contextFunction(context, () => faceState(face), head, subject)
}

const faceSet = (face: Face, property: PropertyKey, value: unknown, stackStart: Function): void => {
  const candidate = adjacentHandOut(face)
  if (face instanceof AutoEntry && face.kind === 'call' && isStringAssertionKey(face.key)) {
    useStringCheck(face)
    const assertion = resolveStringAssertion(face, continuedChain(candidate, frameAt(stackStart)), stackStart)
    if (assertion.other !== undefined) assertion.other[property] = value
    else assertSet(useOf(assertion.state), property, value, assertion.count, stackStart)
    return
  }
  // E95: an assignment made by a matcher's look is neither recorded nor made (see peekGet); E100: see looksAt
  if (libraryGuard.matching > 0 || (libraryGuard.looking !== undefined && looksAt(face))) return
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
  if (!(face instanceof AutoEntry)) return invoke(face, SELF, args, stackStart, undefined, face.adjacentHandOut(), self, site, face)
  if (face.kind === 'get') return invoke(face.parent, face.key, args, stackStart, TAKE_PENDING_READ, undefined, self, site, face)
  // D11 / D26: `fn.received(n)` followed by an invocation asserts a direct call, like a member access after it does
  if (isStringAssertionKey(face.key)) {
    useStringCheck(face)
    const assertion = resolveStringAssertion(face, continuedChain(face.adjacentHandOut(), frameAt(stackStart)), stackStart)
    if (assertion.other !== undefined) assertion.other(...args)
    else assertDirectCall(useOf(assertion.state), args, assertion.count, stackStart)
    return undefined
  }
  return invoke(face.state, SELF, args, stackStart, undefined, face.adjacentHandOut(), self, site, face)
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
 * E91 (R14-ADV-2): whether the first argument of a call/apply invocation can be the `this` that a wrapper passes on
 * (`fn.apply(this, args)`, `fn.call(undefined, ...args)`, sinon.spy, jest.fn, mem, lodash): undefined, null, an object or a
 * function. A primitive first argument (`rpc.call('getUser', 1)`, `redis.call('get', 'k')`) is an argument of a member
 * of that name that the code under test's own API has (JSON-RPC, ioredis), and the invocation then answers as the member
 * reading only: its own auto-substitute per raw arguments, so that `rpc.call('getUser', 1)` and `rpc.call('getOrder', 1)`
 * are different substitutes. (An object first argument, web3's `.call({ from })`, still shares the direct call's.)
 */
const wrapperThis = (thisArg: unknown): boolean =>
  thisArg === undefined || thisArg === null || typeof thisArg === 'object' || typeof thisArg === 'function'

/**
 * The member reading answers when a substitution configured on the member named call/apply/bind matches the raw
 * arguments, or when a mimicked instance has such a member of its own (a function's call/apply/bind inherited from
 * Function.prototype is the direct reading itself, recorded as such).
 */
const memberReadingAnswer = (state: SubstituteState, helper: FunctionHelperKey, rawArgs: any[], hashes: ArgumentHashes, record: CallRecord | undefined, thisArg: unknown): any => {
  // (E100: a real call is matched in the look of its arguments, see configuredAnswer)
  const substitution = state.findCallSubstitution(helper, hashes, record !== undefined)
  if (substitution !== undefined) {
    // (no record: a matcher's look, E95)
    if (record === undefined) return peekExecute(substitution, rawArgs, { thisArg, explicit: true })
    if (substitution.method === 'auto') substitution.entry!.handOut(record)
    return execute(substitution, rawArgs, { thisArg, explicit: true })
  }
  const instance = state.mimicked?.instance
  if (instance !== undefined && hasMember(instance, helper)) {
    const member = instance[helper]
    if (typeof member === 'function' && member !== (Function.prototype as any)[helper]) return fromMimicked(Reflect.apply(member, instance, rawArgs), instance, state)
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
 * E82 (R13FE-5): the member records of call/apply invocations that answered with the auto-substitute of the direct call
 * (see dualHelper), with the substitute whose member call/apply they are (the member reading's).
 */
const directAnswers = new WeakMap<CallRecord, SubstituteState>()

/**
 * E82: the entry that a setup method (`.returns`, ...) read on an auto-substitute configures. Right after a call/apply
 * invocation that answered with the direct call's auto-substitute, in the same expression (`chainHead`: the
 * invocation's member record), that is the member reading's entry, as D26 says: `x.apply(t, [1]).returns(u)` configures
 * x's member apply for (t, [1]), not x(1). Otherwise the entry itself.
 */
const setupEntryOf = (entry: AutoEntry, chainHead: CallRecord | undefined): AutoEntry => {
  const memberState = chainHead === undefined ? undefined : directAnswers.get(chainHead)
  return memberState === undefined ? entry : memberState.callEntry(chainHead!.key, new ArgumentHashes(chainHead!.args!))
}

/**
 * `x.call` / `x.apply` / `x.bind` on any function-like substitute value (D26). Invoking the helper:
 * (a) answers with a substitution configured on x's member of that name, when one matches the raw arguments;
 * (b) otherwise behaves like Function.prototype.call/apply/bind on x: it answers what x(...arguments) answers, the
 *     configured value (a mimicked function or mimicks() receives the thisArg) or, E82 (R13FE-5), the same
 *     auto-substitute as x(...arguments) (D2), so that what a wrapper calling `fn.apply(this, args)` gets has the
 *     nested setups made on `x(...arguments)` and its calls are checked there. (Not for a member called received or
 *     didNotReceive, whose direct call would be a check, D11, nor, E91, for a primitive first argument, see
 *     wrapperThis: the member reading's auto-substitute.)
 * The invocation is recorded once, with both readings (see CallRecord.twin), so that `x.received().call(t, 1)` and
 * `x.received()(1)` both count it. Setups written through the helper (`.returns` on its result, see setupEntryOf, or
 * arguments with matchers) configure the member reading. For bind, the bind call is only a call of the member `bind`;
 * invoking the bound function is a direct call of x with the bound arguments first.
 */
const dualHelper = (face: Face, helper: FunctionHelperKey, chainHead: CallRecord | undefined): Function => {
  const invokeHelper = (rawArgs: any[], thisArg: unknown, directArgs: any[] | undefined, site: StackHolder): any => {
    if (libraryGuard.matching > 0 || (libraryGuard.looking !== undefined && looksAt(face))) {
      // E95 (see peekCall): with Arg matchers among the arguments it is a setup or a check, which records nothing
      if (RecordedArguments.containsMatchers(rawArgs)) return configureCall(faceState(face), helper, RecordedArguments.forSpecification(rawArgs))
      // E100: a look at the arguments of a real call (see looksAt)
      if (libraryGuard.matching === 0) return lookedHelper(face, helper, rawArgs, thisArg, directArgs)
      return peekHelper(face, helper, rawArgs, thisArg, directArgs)
    }
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
    let directHashes: ArgumentHashes | undefined
    let answer: any
    answerSource = undefined
    // E103 (R15V-3): an answer that throws (a throws() setup, a throwing mimicks() function or mimicked method) is noted
    // under both readings, as the direct call notes it (E101: without catching, see noteThrew)
    let answered = false
    try {
      answer = memberReadingAnswer(memberState, helper, rawArgs, hashes, memberRecord, thisArg)
      if (answer === NOT_CONFIGURED && directRecord !== undefined) {
        directHashes = new ArgumentHashes(directArgs!)
        answer = configuredAnswer(direct.state, direct.key, directArgs!, directHashes, directRecord, { thisArg, explicit: true })
      }
      answered = true
    } finally {
      if (!answered) noteHelperThrew(memberRecord, memberState, directRecord, direct.state, direct.key)
    }
    if (answer !== NOT_CONFIGURED) return noteHelperAnswer(answer, memberRecord, memberState, directRecord, direct.state, directHashes !== undefined)
    if (directRecord !== undefined) {
      // E82: the auto-substitute of x(...directArgs), handed out by the invocation (see setupEntryOf). E91: only when the
      // invocation can be a wrapper's (see wrapperThis); otherwise the member reading's own auto-substitute, below.
      if (!isStringAssertionKey(direct.key)) {
        if (wrapperThis(thisArg)) {
          const directEntry = direct.state.callEntry(direct.key, directHashes!)
          directEntry.handOut(memberRecord)
          directAnswers.set(memberRecord, memberState)
          // E81: the direct reading finds this auto-substitute again from its arguments, the member reading by this note
          memberState.noteConfiguredAnswer(memberRecord, directEntry)
          return entryProxy(directEntry)
        }
        // E91 with E81: the direct reading answers the member reading's auto-substitute, so that a check through a
        // direct call with matchers (`redis(Arg.any())[received](1).toString()`) counts the calls made on it
        const entry = memberState.callEntry(helper, hashes)
        entry.handOut(memberRecord)
        if (directRecord.kind === 'call') direct.state.noteConfiguredAnswer(directRecord, entry)
        return entryProxy(entry)
      }
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
        if (libraryGuard.matching > 0 || (libraryGuard.looking !== undefined && looksAt(face))) {
          // E95: a matcher's look (see peekGet); with Arg matchers among the arguments, a setup (see peekCall)
          if (RecordedArguments.containsMatchers(rawArgs)) return configureCall(memberState, 'bind', RecordedArguments.forSpecification(rawArgs))
          // E100: a look at the arguments of a real call (see looksAt)
          return libraryGuard.matching === 0 ? lookedBind(face, rawArgs, thisArg, boundArgs) : peekBind(face, rawArgs, thisArg, boundArgs)
        }
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
 * E95: an invocation of `x.call` / `x.apply` that a matcher's look makes (see peekGet): it answers as dualHelper's
 * invocation would, without recording it, using up a sequence value or handing anything out.
 */
const peekHelper = (face: Face, helper: FunctionHelperKey, rawArgs: any[], thisArg: unknown, directArgs: any[] | undefined): any => {
  const memberState = faceState(face)
  const hashes = new ArgumentHashes(rawArgs)
  const answer = memberReadingAnswer(memberState, helper, rawArgs, hashes, undefined, thisArg)
  if (answer !== NOT_CONFIGURED) return answer
  if (directArgs !== undefined) {
    const direct = directReadingOf(face)
    const directHashes = new ArgumentHashes(directArgs)
    const directAnswer = configuredAnswer(direct.state, direct.key, directArgs, directHashes, undefined, { thisArg, explicit: true })
    if (directAnswer !== NOT_CONFIGURED) return directAnswer
    if (!isStringAssertionKey(direct.key) && wrapperThis(thisArg)) return entryProxy(direct.state.callEntry(direct.key, directHashes))
  }
  return entryProxy(memberState.callEntry(helper, hashes))
}

/** E95: `x.bind(...)` that a matcher's look makes (see peekGet): answered as dualHelper's bind would, leaving no trace. */
const peekBind = (face: Face, rawArgs: any[], thisArg: unknown, boundArgs: any[]): any => {
  const memberState = faceState(face)
  const hashes = new ArgumentHashes(rawArgs)
  const answer = memberReadingAnswer(memberState, 'bind', rawArgs, hashes, undefined, thisArg)
  return answer !== NOT_CONFIGURED ? answer : createBoundProxy(face, memberState.callEntry('bind', hashes), thisArg, boundArgs)
}

/*
 * E100: the peeks of a substitute that the look at the arguments of a real call looks at (see lookedPeek), as functions
 * of their own: a closure in the traps, invoke and the call/apply helpers themselves would make every operation allocate
 * its context, also when nothing is looked at.
 */
const lookedGet = (state: SubstituteState, key: PropertyKey): any => lookedPeek(() => peekGet(state, key))
const lookedCall = (state: SubstituteState, key: PropertyKey, args: any[], self: Self): any => lookedPeek(() => peekCall(state, key, args, self))
const lookedExecute = (substitution: Substitution): any => lookedPeek(() => peekExecute(substitution))
const lookedHelper = (face: Face, helper: FunctionHelperKey, rawArgs: any[], thisArg: unknown, directArgs: any[] | undefined): any =>
  lookedPeek(() => peekHelper(face, helper, rawArgs, thisArg, directArgs))
const lookedBind = (face: Face, rawArgs: any[], thisArg: unknown, boundArgs: any[]): any => lookedPeek(() => peekBind(face, rawArgs, thisArg, boundArgs))

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
      if (value !== REAL_READ) return value
      if (libraryGuard.matching > 0) return peekGet(bindEntry.state, property)
      if (libraryGuard.looking !== undefined && isLooked(proxy)) return lookedGet(bindEntry.state, property) // E100
      return realGet(bindEntry.state, property, bindEntry.adjacentHandOut(), captureStack(get))
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      // (E100: an assignment that a look at the arguments of a real call makes is not made, see faceSet)
      if (libraryGuard.looking === undefined || libraryGuard.matching > 0 || !isLooked(proxy)) faceSet(bindEntry, property, value, set)
      return true
    },
    // E65: named as Function.prototype.bind names a bound function (`bound getUser`)
    getOwnPropertyDescriptor: (_target: unknown, property: PropertyKey) => functionDescriptor(property, () => `bound ${functionName(face)}`),
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      const direct = directReadingOf(face)
      return invoke(direct.state, direct.key, [...boundArgs, ...args], apply, direct.readSource, undefined, { thisArg, explicit: true }, captureStack(apply), proxy)
    },
    // `new` on a bound function constructs the function it is bound to, with the bound arguments first (E23)
    construct: function construct(_target: unknown, args: any[], newTarget: Function) {
      const direct = directReadingOf(face)
      return constructed(invoke(direct.state, direct.key, [...boundArgs, ...args], construct, direct.readSource, undefined, constructing(newTarget), captureStack(construct), proxy))
    }
  })
  boundProxies.set(proxy, face) // E104
  boundFunctions.add(proxy) // E113
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

/** The proxy of a substitute or of an auto-substitute, from its state. */
const proxyOfState = (state: SubstituteState): any => state.owner !== undefined ? entryProxy(state.owner) : rootProxies.get(state)

/**
 * E76 (R12FE-3): what the substitute answers with for a value of the instance it mimicks (D12). The instance itself (a
 * method that returns `this`, as EventEmitter.on/once, stream.setEncoding/pipe and builders do, or a getter that
 * returns the instance) is answered with the substitute that received the call or the read instead, so that the code
 * under test stays on the substitute for the rest of a fluent chain, and the calls of the chain are recorded and
 * configurable. The method still runs with the instance as `this`. Only the instance itself, by identity: a promise of
 * it, or another object that holds it, is answered as it is.
 */
const fromMimicked = (value: unknown, instance: unknown, state: SubstituteState): any => {
  answerSource = MIMICKED // E88
  return value === instance && isObjectLike(value) ? proxyOfState(state) ?? value : value
}

const execute = (substitution: Substitution, args?: any[], self: Self = NO_SELF): any => {
  const value = substitution.nextValue()
  let answer: any
  switch (substitution.method) {
    case 'returns':
      answer = value
      break
    case 'throws':
      answerSource = substitution // E88 (see resolveCall)
      throw value
    case 'resolves':
      answer = Promise.resolve(value)
      break
    case 'rejects':
      answer = Promise.reject(value)
      break
    case 'mimicks':
      answer = callOrConstruct(value, self.thisArg, args ?? [], self)
      break
    case 'auto':
      answer = entryProxy(substitution.entry!)
      break
  }
  answerSource = substitution // E88
  return answer
}

/**
 * E95: what a substitution answers when a matcher's look uses it (see peekGet): the value that the next real use
 * would get, which stays the next one. A rejected promise is marked as handled, so that a look that does not await
 * it leaves no unhandled rejection behind (whoever awaits it still sees the rejection).
 */
const peekExecute = (substitution: Substitution, args?: any[], self: Self = NO_SELF): any => {
  const value = substitution.peekValue()
  switch (substitution.method) {
    case 'returns':
      return value
    case 'throws':
      throw value
    case 'resolves':
      return Promise.resolve(value)
    case 'rejects': {
      const rejected = Promise.reject(value)
      rejected.catch(ignoreRejection)
      return rejected
    }
    case 'mimicks':
      return callOrConstruct(value, self.thisArg, args ?? [], self)
    case 'auto':
      return entryProxy(substitution.entry!)
  }
}

const ignoreRejection = (): void => undefined

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
    // E106: a read that throws() answers is noted as such, before it throws (nothing is caught, E101)
    if (substitution.method === 'throws') state.noteConfiguredAnswer(record, substitution)
    return handOutConfigured(execute(substitution), record, state)
  }

  const mimicked = state.mimicked
  if (mimicked !== undefined) {
    // A member the instance does not have reads as undefined, like on the instance, unless the
    // substitute itself needs it: the string assertion forms, configured calls and nested setups.
    const delegate = hasMember(mimicked.instance, key) ||
      !(isStringAssertionKey(key) || state.hasCallSubstitutions(key) || state.hasConfiguredPropertyEntry(key))
    const value = delegate ? readMimicked(state, mimicked.instance, key, chainCandidate, site) : undefined
    // a substitute value records and resolves its own calls (D31: nested setups through the member go to it)
    if (delegate && (typeof value !== 'function' || isSubstituteProxy(value))) {
      return handOutConfigured(fromMimicked(value, mimicked.instance, state), linkChain(state.addRecord('get', key, undefined, site), chainCandidate), state)
    }
  }

  const record = linkChain(state.addRecord('get', key, undefined, site), chainCandidate)
  state.addPendingRead(record)
  const entry = state.propertyEntry(key)
  entry.handOut(record)
  return entryProxy(entry)
}

/**
 * E119 (R16V-4): a read of a member of the mimicked instance (see realGet). When the instance's getter throws, the read is
 * recorded and noted as THREW, as a mimicked method that throws is (E103), so that a check through it is E88's usage
 * error (E106); E101: without catching, so that the error goes on from where it was thrown.
 */
const readMimicked = (state: SubstituteState, instance: any, key: PropertyKey, chainCandidate: CallRecord | undefined, site: StackHolder): unknown => {
  let read = false
  try {
    const value = instance[key]
    read = true
    return value
  } finally {
    if (!read) state.noteConfiguredAnswer(linkChain(state.addRecord('get', key, undefined, site), chainCandidate), THREW)
  }
}

/**
 * E95 (R14FE-1): a read made while a matcher looks at a value (an Arg.is predicate, a test runner's asymmetricMatch or
 * a sinon matcher's test, in a check or when a call is matched against setups; see evaluateArgument). It answers what
 * a real read (realGet) would, and leaves no trace: nothing is recorded or handed out, no sequence value is used up
 * (peekExecute), and no pending read is left for an invocation. The same goes for the calls and assignments it makes
 * (see peekCall, peekHelper, faceSet). An auto-substitute it reaches is the one the code under test gets for that
 * member (D2); one that did not exist yet has nothing to show.
 */
const peekGet = (state: SubstituteState, key: PropertyKey): any => {
  const substitution = state.propertySubstitution(key)
  if (substitution !== undefined) return state.hasCallSubstitutions(key) ? peekDeferredRead(state, key, substitution) : peekExecute(substitution)
  const mimicked = state.mimicked
  if (mimicked !== undefined) {
    // (as realGet)
    const delegate = hasMember(mimicked.instance, key) ||
      !(isStringAssertionKey(key) || state.hasCallSubstitutions(key) || state.hasConfiguredPropertyEntry(key))
    const value = delegate ? mimicked.instance[key] : undefined
    if (delegate && (typeof value !== 'function' || isSubstituteProxy(value))) return fromMimicked(value, mimicked.instance, state)
  }
  return entryProxy(state.propertyEntry(key))
}

/**
 * E95: deferredRead for a matcher's look (see peekGet): a member configured both as a property and as a method answers
 * an invocation with its call setups and other uses with its property value (D32), leaving no trace.
 */
const peekDeferredRead = (state: SubstituteState, key: PropertyKey, substitution: Substitution): any => {
  const print: Printer = () => state.memberPath(key)
  return createView(print, {
    get: (_target: unknown, property: PropertyKey) => {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      if (isFunctionHelperKey(property)) return functionHelper(property, args => peekCall(state, key, args, NO_SELF))
      const value = peekExecute(substitution)
      const member = value[property]
      return typeof member === 'function' && !isSubstituteProxy(value) ? member.bind(value) : member
    },
    set: () => true,
    apply: (_target: unknown, _thisArg: unknown, args: any[]) => peekCall(state, key, args, NO_SELF),
    construct: (_target: unknown, args: any[], newTarget: Function) => constructed(peekCall(state, key, args, constructing(newTarget)))
  })
}

/**
 * E95: an invocation made while a matcher looks at a value (see peekGet), answered as resolveCall would. With Arg
 * matchers among its arguments it is a setup or a check, as anywhere else (D3, E81: `bus.on('saved', Arg.any())[received](1)()`
 * made inside a predicate counts the calls of what the matching calls answered); that records nothing either, and no
 * pending read is taken.
 */
const peekCall = (state: SubstituteState, key: PropertyKey, args: any[], self: Self): any => {
  if (RecordedArguments.containsMatchers(args)) return configureCall(state, key, RecordedArguments.forSpecification(args), isStringAssertionKey(key))
  const hashes = new ArgumentHashes(args)
  const answer = configuredAnswer(state, key, args, hashes, undefined, self)
  if (answer !== NOT_CONFIGURED && (self.construct !== true || isObjectLike(answer))) return answer
  if (self.newTarget !== undefined) return instanceOf(self.newTarget)
  return entryProxy(state.callEntry(key, hashes))
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
  chainCandidate?: CallRecord, self: Self = NO_SELF, site?: StackHolder, subject: Face | object = state
): any => {
  if (libraryGuard.matching > 0) return peekCall(state, key, args, self) // E95
  // E100: a look at the arguments of a real call (`subject`: the substitute invoked, see looksAt)
  if (libraryGuard.looking !== undefined && looksAt(subject)) return lookedCall(state, key, args, self)
  const read = readSource === TAKE_PENDING_READ ? state.takePendingRead(key) : readSource

  if (RecordedArguments.containsMatchers(args)) {
    // (retracted first: a usage error in the arguments, E49, leaves no record of the expression behind)
    const chained = continuedChain(chainCandidate, frameAt(stackStart))
    retract(read)
    retract(chained)
    return callWithMatchers(state, key, RecordedArguments.forSpecification(args), read !== undefined ? read.chainPrevious : chained)
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
 * An invocation with Arg matchers among its arguments (see invoke): a setup or a check (D3), see configureCall. E99: when it
 * continues an expression that went through a concrete call that a setup with matchers answered (`head`: the record that
 * handed out the substitute invoked), a check further down follows that expression (see concreteRoute).
 */
const callWithMatchers = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments, head: CallRecord | undefined): any => {
  const stringAssertion = isStringAssertionKey(key)
  const route = sharedHandOutCount > 0 && !stringAssertion ? concreteRoute(state, head) : undefined
  if (route !== undefined) return routedView(() => configureCall(state, key, specification), extendRoute(route, callStep(key, specification)), false)
  return configureCall(state, key, specification, stringAssertion)
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

/**
 * E88: a call that threw answered no substitute either (see throughCall): notes that it threw, with the throws() setup of
 * the member if that is what threw (answerSource, set by execute), else THREW (mimicks(), a mimicked method).
 * E101 (R15V-1): called from a `finally` once the answer did not complete, never from a `catch` that throws the error
 * again: a debugger set to pause on caught exceptions then stops once per call, where the error was thrown, and an
 * uncaught error points there, not into the library.
 */
const noteThrew = (state: SubstituteState, key: PropertyKey, record: CallRecord): void => {
  const source = takeAnswerSource()
  state.noteConfiguredAnswer(record, source instanceof Substitution && source.method === 'throws' && source.key === key ? source : THREW)
}

/**
 * E103 (R15V-3): noteThrew for a call/apply invocation (see dualHelper), which is one call under both readings (D26), as
 * noteHelperAnswer notes what it answered: the throws() setup that threw (of the member call/apply, or of the direct
 * call), else THREW, for the record of each reading given.
 */
const noteHelperThrew = (memberRecord: CallRecord, memberState: SubstituteState, directRecord: CallRecord | undefined, directState: SubstituteState, directKey: PropertyKey): void => {
  const source = takeAnswerSource()
  const note = source instanceof Substitution && source.method === 'throws' && (source.key === memberRecord.key || source.key === directKey) ? source : THREW
  memberState.noteConfiguredAnswer(memberRecord, note)
  if (directRecord !== undefined && directRecord.kind === 'call') directState.noteConfiguredAnswer(directRecord, note)
}

/** The configured answer to a call: a matching substitution, or the mimicked instance. NOT_CONFIGURED otherwise. */
const configuredAnswer = (state: SubstituteState, key: PropertyKey, args: any[], hashes: ArgumentHashes, record: CallRecord | undefined, self: Self): any => {
  // E100: a real call is matched in the look of its arguments (see Look); a matcher's look (no record) as a look
  const substitution = state.findCallSubstitution(key, hashes, record !== undefined)
  if (substitution !== undefined) {
    // (no record: a matcher's look, E95)
    if (record === undefined) return peekExecute(substitution, args, self)
    if (substitution.method === 'auto') substitution.entry!.handOut(record)
    return execute(substitution, args, self)
  }

  const mimicked = state.mimicked
  if (mimicked !== undefined) {
    const instance = mimicked.instance
    if (key === SELF) {
      if (typeof instance === 'function') return fromMimicked(callOrConstruct(instance, self.thisArg, args, self), instance, state)
    } else {
      const member = instance[key]
      if (typeof member === 'function') return fromMimicked(callOrConstruct(member, self.explicit ? self.thisArg : instance, args, self), instance, state)
    }
  }
  return NOT_CONFIGURED
}

const resolveCall = (state: SubstituteState, key: PropertyKey, args: any[], record: CallRecord, self: Self): any => {
  const hashes = new ArgumentHashes(args)
  let answer: any
  answerSource = undefined
  // E101 (R15V-1): noted without catching (see noteThrew)
  let answered = false
  try {
    answer = configuredAnswer(state, key, args, hashes, record, self)
    answered = true
  } finally {
    if (!answered) noteThrew(state, key, record)
  }
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

/**
 * E48: the pending reports of the string-form calls that handed out an auto-substitute, in the order of the calls, until
 * it is used. E56: one per call, because calls with the same arguments hand out the same auto-substitute (D2).
 */
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

/**
 * E48: the auto-substitute of a string-form call is used (the caller is the trap of the use). E56 (R9-ADV-4): that
 * settles one report, the latest one still pending, so that a dangling `repo.didNotReceive()` followed by a complete
 * `repo.didNotReceive().delete(Arg.all())` is still reported. The use of a view right after the call that handed it
 * out is a use of that call's view, whose report is the latest one. A view that was stored and is used later cannot be
 * told apart from another view of the same call, so its use settles the latest pending report as well: every view
 * that is used settles a report, so no view that is used is reported, while a view used twice can leave a dangling
 * one unreported.
 */
const useStringCheck = (entry: AutoEntry): void => {
  const reports = danglingStringChecks.get(entry)
  if (reports === undefined) return
  // (reports that were due by now are settled: they were thrown, or did not apply)
  let pending = 0
  for (const report of reports) if (!report.settled) reports[pending++] = report
  reports.length = pending
  if (pending > 0) settle(reports.pop())
  if (reports.length === 0) danglingStringChecks.delete(entry)
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
  entry = setupEntryOf(entry, chainHead) // E82
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

/**
 * `sub.received(n)` followed by a member access, an assignment or an invocation (the caller has called useStringCheck).
 * E99: through a concrete call that a setup with matchers answered, what the check counts follows the expression (see
 * concreteRoute), and `other` is the check view of another copy that stands for it (E89), if any.
 */
const resolveStringAssertion = (entry: AutoEntry, chainHead: CallRecord | undefined, stackStart: Function): { state: CheckSubject, count: ExpectedCount, other?: any } => {
  const args = actualArgumentsOf(entry, chainHead)
  retract(chainHead)
  const count = entry.key === 'didNotReceive' ? 0 : validateExpectedCount(args[0], stackStart)
  // (the call of received or didNotReceive continues the expression of the substitute it is a member of)
  const subject = chainHead === undefined || sharedHandOutCount === 0 ? entry.parent : concreteSubject(entry.parent, chainHead.chainPrevious)
  const other = subject instanceof MatchedSubstitutes ? subject.open(entry.key as StringAssertionKey, count, stackStart) : undefined
  return { state: subject, count, other }
}

const validateMimickInstance = (instance: unknown, stackStart: Function) => {
  if ((typeof instance !== 'object' || instance === null) && typeof instance !== 'function')
    throw SubstituteException.generic(`mimick expects an object or a function to delegate to, but received ${formatValue(instance, false)}.`, stackStart)
}

/**
 * The functions behind the exported symbols: sub[received](n), sub[didNotReceive](), sub[configure](), ...
 * `getSubject`: what the checks count the calls of (E81: the substitutes behind a call with matchers, see
 * MatchedSubstitutes), the substitute itself unless given.
 */
const contextFunction = (
  context: ContextMethod, getState: () => SubstituteState, chainHead: CallRecord | undefined, getSubject: () => CheckSubject = getState
): Function => {
  switch (context) {
    case 'received':
      return function received(count?: unknown) {
        const expected = validateExpectedCount(count, received)
        retract(chainHead)
        const subject = getSubject()
        // E88, E89: a check through a call with matchers finds what it counts when it is opened
        const delegated = subject instanceof MatchedSubstitutes ? subject.open('received', expected, received) : undefined
        return delegated !== undefined ? delegated : createAssertionProxy(subject, expected, checkViewSite(received))
      }
    case 'didNotReceive':
      return function didNotReceive() {
        retract(chainHead)
        const subject = getSubject()
        const delegated = subject instanceof MatchedSubstitutes ? subject.open('didNotReceive', 0, didNotReceive) : undefined
        return delegated !== undefined ? delegated : createAssertionProxy(subject, 0, checkViewSite(didNotReceive))
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
      // E106: what the read answered, while it is a read (invoked, it is a call, whose answer resolveCall notes)
      const read = record.kind === 'get'
      if (read && substitution.method === 'throws') state.noteConfiguredAnswer(record, substitution)
      value = execute(substitution)
      if (read) noteReadAnswer(state, record, value)
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
const createAssertionProxy = (state: CheckSubject, count: ExpectedCount, site: StackHolder): any => {
  const print: Printer = () => `${state.path}.${describeCount(count)}`
  const dangling = deferDanglingCheck(state, 'symbol', count, site)
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      settle(dangling)
      return assertionMember(useOf(state), property, count, get)
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      settle(dangling)
      assertSet(useOf(state), property, value, count, set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      settle(dangling)
      assertDirectCall(useOf(state), args, count, apply)
      return undefined
    },
    // E23: a check of `new` is a check of the call
    construct: function construct(_target: unknown, args: any[]) {
      settle(dangling)
      assertDirectCall(useOf(state), args, count, construct)
      return {}
    },
    // a usage error on the view itself is reported instead (E48)
    defineProperty: function defineProperty(target: () => Printer): boolean {
      settle(dangling)
      throw definePropertyError(target, defineProperty)
    },
    preventExtensions: function preventExtensions(target: () => Printer): boolean {
      settle(dangling)
      throw preventExtensionsError(target, preventExtensions)
    }
  })
}

/**
 * An assertion that a substitute was invoked directly: `fn[received]()(1)`. A member handle (`sub.method`) is never
 * invoked on its own: invoking it is a call of the member, recorded on the parent, so that is what is checked
 * (`sub.method[received]()(1)` is `sub[received]().method(1)`, D26).
 */
const assertDirectCall = (state: CheckSubject, args: any[], count: ExpectedCount, stackStart: Function): void => {
  // E81: several substitutes give the records of their direct calls this way themselves (see MatchedSubstitutes)
  if (!(state instanceof SubstituteState)) return assertCall(state, SELF, args, count, stackStart)
  const owner = state.owner
  if (owner !== undefined && owner.kind === 'get') assertCall(owner.parent, owner.key, args, count, stackStart)
  else assertCall(state, SELF, args, count, stackStart)
}

/** `sub.received(n).member`: a property assertion now, or a method assertion if it is invoked. */
const assertionMember = (state: CheckSubject, key: PropertyKey, count: ExpectedCount, stackStart: Function): any => {
  if (state instanceof SubstituteState) noteCheckedMember(state, key)
  const deferred = assertPropertyRead(state, key, count, stackStart)
  const assertInvocation = (args: any[], start: Function): undefined => {
    settle(deferred)
    assertCall(state, key, args, count, start)
    return undefined
  }
  const unsupported = (property: PropertyKey, start: Function): never => {
    if (deferred !== undefined && !deferred.settled) {
      const error = deferred.error()
      settle(deferred)
      throw error
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

// ---- E81: checks through a call with matchers ---------------------------------------------------

/*
 * E81 (R13FE-3): a call with matchers is a setup or a check (D3), and what follows it is a nested setup
 * (`repo.find(Arg.any()).name.returns('x')`), except for a check: `bus.on('saved', Arg.any())[received](1)()`, also with
 * the string forms (`bus.on('saved', Arg.any()).received(1)()`, see stringCheckThroughMatchers) and further down
 * (`repo.find(Arg.any()).items[didNotReceive]().clear()`, through the configure views). Such a check counts the calls of
 * the substitutes that the received calls matching the call with matchers answered: their auto-substitutes, or the
 * configured values that are substitutes, in the order of the calls (and so on for every step after it). With no
 * matching received call it counts none. It registers no nested setup, and it changes nothing that later calls answer:
 * a nested setup registered by a read through such a call (`repo.find(Arg.any()).items`, on the way to a check) only
 * answers calls once something below it is configured (see SubstituteState).
 */

const hasMatchers = (specification: RecordedArguments): boolean =>
  specification.argumentsClass === 'with-predicate' || specification.argumentsClass === 'wildcard'

/**
 * A substitute that a check through a call with matchers counts the calls of: a substitute itself, or an auto-substitute
 * (its entry: it may have no state, and a member handle's direct calls are recorded on its parent). E89 (R14-ADV-4): or a
 * substitute of another copy of the library (its proxy, a function), whose calls only that copy can count.
 */
type Checked = SubstituteState | AutoEntry | Function

/** The one value that stands for a substitute (an auto-substitute's state stands for its entry). */
const checkedOf = (face: Face): Checked => face instanceof AutoEntry ? face : face.owner ?? face

/** E89: whether a substitute that a check counts is one of another copy of the library. */
const isForeign = (checked: Checked): checked is Function => typeof checked === 'function'

/** Where the calls of `key` on a checked substitute are recorded (a direct call of a member handle is a call of the member). */
const recordedAt = (checked: SubstituteState | AutoEntry, key: PropertyKey): { state: SubstituteState, key: PropertyKey } | undefined => {
  if (!(checked instanceof AutoEntry)) return { state: checked, key }
  if (key === SELF && checked.kind === 'get') return { state: checked.parent, key: checked.key }
  const state = checked.materializedState
  return state === undefined ? undefined : { state, key }
}

/** The state of a checked substitute, if it has one (it has received nothing and has no setups otherwise). */
const stateOf = (checked: SubstituteState | AutoEntry): SubstituteState | undefined => checked instanceof AutoEntry ? checked.materializedState : checked

/** Collects substitutes without repeats, in the order they are added. */
class CheckedList {
  readonly items: Checked[] = []
  // (E110: only once there are several, as a step mostly leads to one substitute, over and over)
  private seen?: Set<Checked>
  add(checked: Checked | undefined): void {
    if (checked === undefined) return
    const items = this.items
    if (items.length === 0) {
      items.push(checked)
      return
    }
    if (items[0] === checked) return
    const seen = this.seen ?? (this.seen = new Set(items))
    if (seen.has(checked)) return
    seen.add(checked)
    items.push(checked)
  }
}

/*
 * E90 (R14-ADV-1): what a check through a call with matchers counts is found along a route: from the substitute that
 * the call with matchers is made on (`origin`), step by step, through each call (the substitutes that the received calls
 * matching it answered) and through each member (the substitutes that its reads answered), down to where the check is
 * opened. The steps are those of the expression, however its nested setups are forwarded (D31): a check further down a
 * call with matchers whose setup returns a substitute (`api.client(Arg.any()).returns(client)`, then
 * `api.client(Arg.any()).items[received](1).clear()`) counts along the same route as one at the first step, never the
 * configured substitute alone (see routedView).
 * E99 (R15FE-5): a check through a concrete call whose answer a setup with matchers shares follows a route too: that of
 * its expression, from the topmost such call (see concreteRoute).
 */

/** A step of a route: a member read, or a call whose arguments match (an AutoEntry is one, too). */
type RouteStep = {
  readonly kind: 'get' | 'call'
  readonly key: PropertyKey
  /** The arguments of a call, as its path shows them. */
  readonly argumentList: readonly unknown[] | undefined
  matchesCall(actualArguments: readonly unknown[]): boolean
  /**
   * E99: when the step is the call of the check expression itself, and a concrete call that a setup with matchers (or the
   * mimicked instance) answered with a substitute that it gives every call it matches (see sharedHandOutCount), that
   * substitute.
   */
  readonly shared?: SubstituteState
}
type CheckRoute = { readonly origin: SubstituteState, readonly steps: readonly RouteStep[] }

const memberStep = (key: PropertyKey): RouteStep => ({ kind: 'get', key, argumentList: undefined, matchesCall: () => false })
const callStep = (key: PropertyKey, specification: RecordedArguments): RouteStep =>
  ({ kind: 'call', key, argumentList: specification.value, matchesCall: actualArguments => specification.matches(actualArguments) })
const extendRoute = (route: CheckRoute, step: RouteStep): CheckRoute => ({ origin: route.origin, steps: [...route.steps, step] })

/**
 * E99: the step of a record of a check expression: its read, or its call with the arguments it was made with (`shared`:
 * the substitute that it answered, when a setup with matchers or the mimicked instance shares that, see RouteStep).
 */
const concreteStep = (record: CallRecord, shared: SubstituteState | undefined): RouteStep => {
  if (record.kind !== 'call') return memberStep(record.key)
  const args: readonly unknown[] = record.args ?? []
  return {
    kind: 'call',
    key: record.key,
    argumentList: args,
    matchesCall: actualArguments => sameArguments(args, actualArguments),
    shared
  }
}

/**
 * E110: whether the arguments of a received call are those of a call of a check expression (RecordedArguments.literalsEqual),
 * the same values first (as for the calls of a loop that a check goes through, call after call).
 */
const sameArguments = (expected: readonly unknown[], actual: readonly unknown[]): boolean => {
  if (expected.length === actual.length) {
    let index = 0
    while (index < expected.length && Object.is(expected[index], actual[index])) index++
    if (index === expected.length) return true
  }
  return RecordedArguments.literalsEqual(expected, actual)
}

/** `.on('saved', Arg.any{any})`, `.items`, `('a')`: a step as a path shows it. */
const stepText = (step: RouteStep): string => {
  const member = step.key === SELF ? '' : `.${keyToString(step.key)}`
  return step.kind === 'call' ? `${member}${pathArguments(step.argumentList)}` : member
}

/** `@Substitute.on('saved', Arg.any{any})`, `@Substitute.find(Arg.any{any}).items` */
const routePath = (route: CheckRoute, steps = route.steps.length): string => {
  let path = route.origin.path
  for (let index = 0; index < steps; index++) path += stepText(route.steps[index])
  return path
}

/** E99: at most this many records of a check expression are looked at, from where the check is opened up. */
const MAX_EXPRESSION_STEPS = 1000

/**
 * E110: what a record of a check expression handed out (`answered`, the substitute the next step of the expression was
 * made on, or the one the check is opened on) tells about it: the substitute it was made on (`owner`), the record that is
 * its step (D26/E82: the direct reading of a call/apply invocation, see below), and whether a setup with matchers (or the
 * mimicked instance) shares that answer. Undefined when that is not known any more (the configured value was handed out
 * again since), so that the route stops there.
 */
type HandOutStep = { readonly record: CallRecord, readonly owner: SubstituteState, readonly shared: boolean }

const handOutStepOf = (answered: SubstituteState, record: CallRecord): HandOutStep | undefined => {
  const entry = answered.owner
  // a configured value, noted with the substitute that answered it (see handOutShared)
  const configured = (entry ?? answered).configuredHandOut(record)
  if (configured !== undefined) return { record, owner: configured.from, shared: configured.shared }
  if (entry === undefined) return undefined
  // an auto-substitute, of the substitute that the call or the read was made on (E99: that of a nested setup through a
  // call with matchers is one that every call matching it gets). E82: the auto-substitute of the direct call, which a
  // call/apply invocation hands out from its member reading, is that of its direct reading (which comes right before it).
  const twin = record.twin
  const step = twin !== undefined && twin === record.chainPrevious && twin.key === entry.key && record.key !== entry.key ? twin : record
  return { record: step, owner: entry.parent, shared: entry.specifiesMatchers }
}

/**
 * E99 (R15FE-5): the route of a check expression that went through a concrete call whose answer a setup with matchers
 * shares (`io.to('room-b')` after `io.to(Arg.any()).emit(Arg.all()).returns(true)`), from the topmost such call down to
 * where the check is opened, along the records of the expression (`head`: the record that handed out `state`, the
 * substitute the check is opened on). Undefined when the expression went through no such call: the check then counts
 * the calls of that substitute, as always.
 * E110 (R16V-2): found from the bottom up, from what each record handed out (see handOutStepOf), with nothing noted per
 * call. The records of the expression, which the check has retracted, are then forgotten where they are the latest of
 * their member (see SubstituteState.dropRetracted), so that later checks do not look at them again.
 */
const concreteRoute = (state: SubstituteState, head: CallRecord | undefined): CheckRoute | undefined => {
  if (head === undefined || sharedHandOutCount === 0) return undefined
  const found: HandOutStep[] = []
  const answers: SubstituteState[] = []
  let top = 0
  let answered = state
  for (let record: CallRecord | undefined = head; record !== undefined && found.length < MAX_EXPRESSION_STEPS;) {
    const step = handOutStepOf(answered, record)
    if (step === undefined) break
    found.push(step)
    answers.push(answered)
    if (step.shared) top = found.length
    answered = step.owner
    const made = step.record
    // D26: a call/apply invocation is one step (its direct reading comes right before its member reading)
    record = made.twin !== undefined && made.twin === made.chainPrevious ? made.twin.chainPrevious : made.chainPrevious
  }
  if (top === 0) return undefined
  const steps: RouteStep[] = []
  for (let index = top - 1; index >= 0; index--) steps.push(concreteStep(found[index].record, found[index].shared ? answers[index] : undefined))
  // (from the bottom up: each is the latest record of its member then)
  for (const step of found) step.owner.dropRetracted(step.record)
  return { origin: found[top - 1].owner, steps }
}

/** E99: what a check opened on `state` counts, when its expression reached `state` from `head` (see concreteRoute). */
const concreteSubject = (state: SubstituteState, head: CallRecord | undefined): CheckSubject => {
  const route = concreteRoute(state, head)
  return route === undefined ? state : new MatchedSubstitutes(route)
}

/**
 * The route to a substitute reached through the configure views below a call with matchers, if it is below one: from
 * the substitute above the topmost auto-substitute of a nested setup through a call with matchers, along the members and
 * calls of the auto-substitutes down to `state`.
 */
const routeOf = (state: SubstituteState): CheckRoute | undefined => {
  const steps: AutoEntry[] = []
  let top = -1
  for (let current = state; current.owner !== undefined; current = current.owner.parent) {
    if (current.owner.specifiesMatchers) top = steps.length
    steps.push(current.owner)
  }
  if (top < 0) return undefined
  return { origin: steps[top].parent, steps: steps.slice(0, top + 1).reverse() }
}

/** The route through a call (with matchers, or below one) made on `state`; undefined when neither. */
const routeThroughCall = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments): CheckRoute | undefined => {
  const route = routeOf(state)
  if (route === undefined && !hasMatchers(specification)) return undefined
  return extendRoute(route ?? { origin: state, steps: [] }, callStep(key, specification))
}

/** What a check view opened on `state` (in a configure view) counts the calls of (see MatchedSubstitutes). */
const checkSubjectOf = (state: SubstituteState): CheckSubject => {
  const route = routeOf(state)
  return route === undefined ? state : new MatchedSubstitutes(route)
}

/** E88: why what a setup answered is no substitute (see notSubstituteError). */
const configuredAnswerText: Partial<Record<SubstitutionMethod, string>> = {
  returns: ', and that value is not a substitute',
  resolves: ', so it answered a promise, which is not a substitute',
  rejects: ', so it answered a rejected promise, which is not a substitute',
  throws: ', so it threw instead of answering a substitute',
  mimicks: ', whose result is not a substitute'
}

/** `sub.items`, `sub.getUser(1)`: a substitute as it would be written in a test (from its path). */
const asExpression = (path: string): string => path.replace(/^@Substitute/, 'sub')

/** `.process`, '' for the substitute itself: a member as an expression names it after the substitute. */
const memberText = (key: PropertyKey): string => key === SELF ? '' : `.${keyToString(key)}`

/** E104: the check of the member a bound function is bound from: `sub.received(1).process(...)`. */
const boundMemberCheck = (face: Face): string => {
  const direct = directReadingOf(face)
  return `${asExpression(direct.state.path)}.received(1)${memberText(direct.key)}(...)`
}

/**
 * E88 (R14-ADV-5): a check through a call with matchers cannot count the calls made on what a matching received call
 * answered when that is not a substitute. It is a usage error, as before E81 (a nested setup through such a call is one,
 * D31): it names the call with matchers and what answered the received call. E106 (R15-ADV-2): the same for a read of a
 * member step below it, which `record` is then. E104 (R15-ADV-8): a function bound from a substitute of this copy is named
 * as such.
 */
const notSubstituteError = (through: string, state: SubstituteState, record: CallRecord, answer: object, start: Function | undefined) => {
  let how: string
  // E104: what to check instead of a function bound from a substitute's member
  let instead = 'Check that value directly instead (for example user.received(1).save(), for a substitute user that it holds or resolves to)'
  if (answer instanceof Substitution) {
    const values = answer.values.map(value => formatValue(value, false)).join(', ')
    const bound = answer.method === 'returns' && answer.values.length === 1 ? boundProxies.get(answer.values[0]) : undefined
    if (bound !== undefined) instead = `Check the calls of the member it is bound from instead (for example ${boundMemberCheck(bound)})`
    const why = bound !== undefined || (answer.method === 'returns' && answer.values.length === 1 && isBoundFunction(answer.values[0]))
      ? ', a bound function, which is not a substitute'
      : answer.method === 'returns' && answer.values.length > 1
        ? ', and the value it answered is not a substitute' // (a sequence: the call got one of them)
        : configuredAnswerText[answer.method as SubstitutionMethod] ?? ''
    how = `is configured with ${answer.method}(${values})${why}`
  } else if (answer === MIMICKED) how = 'is answered by the mimicked instance with a value that is not a substitute'
  else if (answer === THREW) how = 'threw an error instead of answering a substitute'
  else if (answer === CONFIGURED) how = 'is answered by a configured value that is not a substitute'
  else how = `returned ${formatValue(answer, false)}, which is not a substitute`
  const what = record.kind === 'call'
    ? `the received call ${describeCall(state, record.key, record.args)}, which it matches,`
    : `the read of ${state.memberPath(record.key)}, which it goes through,`
  return SubstituteException.generic(
    `Cannot check through ${through}: ${what} ${how}. ` +
    `A check through a call with matchers counts the calls of the substitutes that the matching calls answered, and the calls ` +
    `made on that value are not recorded there. ${instead}, or check a concrete call.`,
    start
  )
}

/** E89: several substitutes to count, and one of them is of another copy of the library (whose calls it counts itself). */
const severalCopiesError = (through: string, start: Function | undefined) => SubstituteException.generic(
  `Cannot check through ${through}: the received calls that it matches answered several substitutes, and at least one ` +
  `of them belongs to another copy of @fluffy-spoon/substitute (another install of the package), so their calls cannot be ` +
  `counted together. Check each of those substitutes directly instead (for example job.received(1).run()), or check a ` +
  `concrete call.`,
  start
)

/**
 * E105 (R15-ADV-1): the substitute of another copy that a check counts is not where the check is opened: the steps after it
 * (`rest`) are that copy's to follow, and it follows them as nested setups (D31), not as a check (E90). A usage error.
 */
const otherCopyAboveError = (through: string, rest: string, start: Function | undefined) => SubstituteException.generic(
  `Cannot check through ${through}${rest}: the received calls that ${through} matches answered a substitute of another copy ` +
  `of @fluffy-spoon/substitute (another install of the package), and the check goes on below it (${rest}), where only that ` +
  `copy knows what the calls and reads answered. Check that substitute directly instead, with its own copy's check (for ` +
  `example job${rest}.received(1)..., for a substitute job that it is), or check a concrete call.`,
  start
)

/** E99: the setup with matchers on `state` that gives every matching call of `key` the substitute `answer`, if there is one. */
const sharingSetup = (state: SubstituteState, key: PropertyKey, answer: object): Substitution | undefined => {
  let found: Substitution | undefined
  for (const substitution of state.substitutions()) {
    if (substitution.kind !== 'call' || substitution.key !== key || substitution.args === undefined || !hasMatchers(substitution.args)) continue
    const gives = substitution.method === 'auto'
      ? substitution.entry === answer
      : substitution.method === 'returns' && substitution.values.some(value => isFaceProxy(value) && (value as any)[INTERNAL] === answer)
    if (gives) found = substitution // (the most recent one)
  }
  return found
}

/** E99: at most this many of the other calls that a shared substitute was returned to are named. */
const OTHER_CALLS_NAMED = 3

/**
 * E99 (R15FE-5): a check through a concrete call whose answer a setup with matchers shares, while that substitute was also
 * returned to calls that do not match the concrete one: which of its calls came through which call cannot be told. A
 * usage error, naming the concrete call, the setup that shares the substitute, some of the other calls, and what to do.
 */
const sharedSubstituteError = (
  through: string, state: SubstituteState, step: RouteStep, answer: object, others: readonly CallRecord[], start: Function | undefined
) => {
  const key = step.key
  const call = describeCall(state, key, step.argumentList)
  const setup = sharingSetup(state, key, answer)
  // (each call once, however often it was made)
  const distinct: CallRecord[] = []
  for (const record of others) if (!distinct.some(seen => RecordedArguments.literalsEqual(seen.args ?? [], record.args ?? []))) distinct.push(record)
  const shown = distinct.slice(0, OTHER_CALLS_NAMED).map(record => describeCall(state, key, record.args))
  const more = distinct.length - shown.length
  const listed = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  const sharedBy = setup === undefined ? 'the mimicked instance' : `the setup ${describeCall(state, key, setup.args!.value)}`
  const owner = asExpression(state.path)
  const throughMatchers = setup === undefined ? '' : `, or check through the call with matchers, which counts the calls that came through every call it matches (${asExpression(describeCall(state, key, setup.args!.value))}.received(n)...)`
  return SubstituteException.generic(
    `Cannot check through ${through}: ${call} has no setup of its own, so it answered the substitute ${printAnswer(answer)}, which ${sharedBy} ` +
    `gives every call that it matches, and that substitute was also returned to ${listed}. Which of its calls came through ` +
    `${call} cannot be told apart. Check the call itself instead (${owner}.received(1)${memberText(key)}${formatArguments(step.argumentList ?? [], false)}), ` +
    `configure the concrete calls so that each answers a substitute of its own${throughMatchers}.`,
    start
  )
}

/** E99: a substitute that calls answered, as messages show it. */
const printAnswer = (answer: object): string => answer instanceof AutoEntry || answer instanceof SubstituteState ? answer.path : formatValue(answer, false)

/**
 * How a route is followed: 'count' for what a check counts (E88, E89 and E99 usage errors are thrown), 'list' (E99) for
 * what it would count without E99's rule, whose records a failing check lists without counting them (see uncountedFor):
 * at a step that E99 narrows, the substitute that the call of the check expression itself answered. No usage errors then.
 */
type Follow = 'count' | 'list'

/**
 * The substitutes that the received calls of a step's member on `checked` whose arguments match answered: the configured
 * value noted for a call (see handOutConfigured), or else the auto-substitute of its arguments, if it has been created.
 * E88: a call answered with a value that is not a substitute is a usage error (`through`: the route so far, `start`: where).
 * E99: at a concrete step whose answer is shared (step.shared), a substitute that matching calls answered and calls that do
 * not match were returned as well is a usage error (see sharedSubstituteError); one that only calls that do not match
 * were returned is not counted (nothing came through the step).
 */
const throughCall = (checked: readonly Checked[], step: RouteStep, through: () => string, start: Function | undefined, follow: Follow): Checked[] => {
  const answered = new CheckedList()
  for (const item of checked) {
    if (isForeign(item)) continue
    const at = recordedAt(item, step.key)
    if (at === undefined) continue
    if (follow === 'list' && step.shared !== undefined) {
      answered.add(checkedOf(step.shared))
      continue
    }
    // E110: one pass over the received calls, with what each answered by position (no map of them)
    const records = at.state.receivedRecordsOf(at.key)
    const answers = at.state.configuredAnswersByPosition(at.key)
    const sharing = step.shared !== undefined && follow === 'count'
    let shared: Set<object> | undefined
    // E99: the calls that do not match the step and answered a substitute, which may be one that matching calls answered
    let others: number[] | undefined
    for (let position = 0; position < records.length; position++) {
      const record = records[position]
      if (record.retracted || record.kind !== 'call') continue
      const answer = answers === undefined ? undefined : answers[position]
      if (!step.matchesCall(record.args ?? [])) {
        if (sharing && (answer instanceof AutoEntry || answer instanceof SubstituteState)) (others ?? (others = [])).push(position)
        continue
      }
      if (answer === undefined) answered.add(at.state.existingCallEntry(at.key, new ArgumentHashes(record.args ?? [])))
      else if (answer instanceof AutoEntry || answer instanceof SubstituteState) {
        answered.add(checkedOf(answer))
        if (sharing) (shared ?? (shared = new Set())).add(answer)
      }
      // E89: a proxy that is a substitute of another copy (E104: not a function bound from one of this copy)
      else if (isOtherCopySubstitute(answer)) answered.add(answer)
      else if (follow === 'count') throw notSubstituteError(through(), at.state, record, answer, start)
    }
    if (shared === undefined || others === undefined) continue
    // E99: the calls that do not match the step, which a substitute that matching calls answered was returned to as well
    const returnedTo: CallRecord[] = []
    let sharedAnswer: object | undefined
    for (const position of others) {
      const answer = answers![position]!
      if (!shared.has(answer)) continue
      if (sharedAnswer === undefined) sharedAnswer = answer
      if (answer === sharedAnswer) returnedTo.push(records[position])
    }
    if (sharedAnswer !== undefined) throw sharedSubstituteError(through(), at.state, step, sharedAnswer, returnedTo, start)
  }
  return answered.items
}

/**
 * The substitutes that reads of `key` on `checked` answered: E106 (R15-ADV-2), what each read answered when a setup or a
 * mimicked instance answered it (noted when it was answered, see handOutConfigured: reconfiguring the member later changes
 * nothing, and of returns(y1, y2) only the values that reads got count), and the auto-substitute of the member, which
 * every other read answered. A read answered with a value that is not a substitute is E88's usage error.
 */
const throughRead = (checked: readonly Checked[], key: PropertyKey, through: () => string, start: Function | undefined, follow: Follow): Checked[] => {
  const answered = new CheckedList()
  for (const item of checked) {
    if (isForeign(item)) continue
    const state = stateOf(item)
    if (state === undefined) continue
    const configured = state.configuredAnswers(key)
    if (configured !== undefined) {
      for (const record of state.recordsFor(key)) {
        if (record.kind !== 'get') continue
        const answer = configured.get(record)
        if (answer === undefined) continue
        if (answer instanceof AutoEntry || answer instanceof SubstituteState) answered.add(checkedOf(answer))
        else if (isOtherCopySubstitute(answer)) answered.add(answer)
        else if (follow === 'count') throw notSubstituteError(through(), state, record, answer, start)
      }
    }
    answered.add(state.existingPropertyEntry(key))
  }
  return answered.items
}

/**
 * What a route leads to: the substitutes of this copy to count, or (E89) one substitute of another copy (`foreign`, with
 * none to count here), which is where the check is opened (E105).
 */
type RouteEnd = { readonly checked: readonly Checked[], readonly foreign?: Function }

/** Follows a route (see above). E88, E89, E99, E105: a usage error when it cannot be followed (`start`: where). */
const followRoute = (route: CheckRoute, start: Function | undefined, follow: Follow = 'count'): RouteEnd => {
  let checked: Checked[] = [checkedOf(route.origin)]
  const steps = route.steps
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    const through = () => routePath(route, index + 1)
    checked = step.kind === 'get' ? throughRead(checked, step.key, through, start, follow) : throughCall(checked, step, through, start, follow)
    if (follow !== 'count') continue
    const foreign = checked.find(isForeign)
    if (foreign === undefined) continue
    if (checked.length > 1) throw severalCopiesError(through(), start)
    // E105: only where the check is opened; the steps after it are not that copy's check to follow
    if (index < steps.length - 1) throw otherCopyAboveError(through(), steps.slice(index + 1).map(stepText).join(''), start)
    return { checked: [], foreign: foreign as Function }
  }
  return { checked }
}

/**
 * E89: the check of another copy's substitute that a check through a call with matchers stands for, when that substitute
 * is the only one it counts and (E105) the check is opened on it: made with that copy's own API (the symbols are shared,
 * see Constants).
 */
const delegateCheck = (foreign: any, context: 'received' | 'didNotReceive', count: ExpectedCount): any =>
  context === 'didNotReceive' ? foreign[constants.CONTEXT.didNotReceive.symbol]() : foreign[constants.CONTEXT.received.symbol](count)

/**
 * The substitutes behind a check through a call with matchers (see above): those that the route leads to. Found when the
 * check is opened (see open), so that a usage error (E88, E89, E99, E105) is reported there.
 */
class MatchedSubstitutes implements SeveralSubstitutes {
  /**
   * E92 (R14-ADV-6), E107 (R15-ADV-3): the substitutes whose records were listed so far, with those records, for this use
   * of the check view only (see use), so that a report made from it and thrown later (D9) names each record's substitute,
   * and another use counts afresh. (Created when records are first listed: the check itself, before a use, lists none.)
   * E110: which substitute a record belongs to is only looked up when a message shows it (see ownerOf).
   */
  private _listed?: { readonly checked: Checked, records: readonly CallRecord[] }[]
  private _owners?: Map<CallRecord, Checked>

  constructor(private readonly route: CheckRoute, private _end?: RouteEnd) { }

  /** `@Substitute.on('saved', Arg.any{any})`, `@Substitute.find(Arg.any{any}).items` */
  public get path(): string {
    return routePath(this.route)
  }

  /**
   * Opens the check: finds what it counts (`start`: where a usage error is reported from). E89: when that is a substitute
   * of another copy, the check view of that copy that stands for this one; otherwise undefined.
   */
  public open(context: 'received' | 'didNotReceive', count: ExpectedCount, start: Function): any {
    const end = this.end(start)
    return end.foreign === undefined ? undefined : delegateCheck(end.foreign, context, count)
  }

  /**
   * E107 (R15-ADV-3): one use of the check view (a member read, an assignment or an invocation of it): it counts what the
   * check counts, and lists its records with owners of its own, so that a view used again counts exactly as a fresh one.
   */
  public use(): MatchedSubstitutes {
    return new MatchedSubstitutes(this.route, this.end())
  }

  private end(start?: Function): RouteEnd {
    if (this._end === undefined) this._end = followRoute(this.route, start)
    return this._end
  }

  private get checked(): readonly Checked[] {
    return this.end().checked
  }

  /** The states of the substitutes (those without one have received nothing and have no setups). */
  public get states(): readonly SubstituteState[] {
    const states: SubstituteState[] = []
    for (const checked of this.checked) {
      const state = isForeign(checked) ? undefined : stateOf(checked)
      if (state !== undefined) states.push(state)
    }
    return states
  }

  public memberPath(key: PropertyKey): string {
    return key === SELF ? this.path : `${this.path}.${keyToString(key)}`
  }

  public recordsFor(key: PropertyKey): CallRecord[] {
    return this.listRecords(this.checked, key, undefined)
  }

  /**
   * E99: the records that a failing check lists without counting them: those of the substitutes that the check would count
   * without E99's rule (see Follow), when they are not counted, e.g. the calls of the substitute that a setup with matchers
   * shares, made through other calls than the concrete one the check goes through.
   */
  public uncountedFor(key: PropertyKey): CallRecord[] {
    if (!this.route.steps.some(step => step.shared !== undefined)) return []
    const counted = new Set(this.checked)
    const uncounted = followRoute(this.route, undefined, 'list').checked.filter(checked => !counted.has(checked))
    return uncounted.length === 0 ? [] : this.listRecords(uncounted, key, new Set(this.recordsFor(key)))
  }

  /** The records of `key` of the substitutes (not those in `except`), each with its owner, in the order they were received. */
  /*
   * (No record is listed twice: the substitutes are distinct, and no two of them have their calls of a member recorded at
   * the same substitute and member, see recordedAt. In one use every listing is of the same member, so a record always
   * has the same owner.)
   */
  private listRecords(checkedList: readonly Checked[], key: PropertyKey, except: ReadonlySet<CallRecord> | undefined): CallRecord[] {
    const listed = this._listed ?? (this._listed = [])
    let records: CallRecord[] | undefined
    let several = false
    for (const checked of checkedList) {
      if (isForeign(checked)) continue
      const at = recordedAt(checked, key)
      if (at === undefined) continue
      let own = at.state.recordsFor(at.key)
      if (except !== undefined) own = own.filter(record => !except.has(record))
      if (own.length === 0) continue
      // (a check lists the records of the same member again when it is invoked, see assertionMember)
      const known = listed.find(group => group.checked === checked)
      if (known !== undefined) known.records = own
      else listed.push({ checked, records: own })
      if (records === undefined) records = own
      else {
        if (!several) records = [...records]
        several = true
        for (const record of own) records.push(record)
      }
    }
    this._owners = undefined
    if (records === undefined) return []
    return several ? records.sort((a, b) => a.seq - b.seq) : records
  }

  public ownerOf(record: CallRecord): { readonly path: string } | undefined {
    const listed = this._listed
    if (listed === undefined || listed.length === 0) return undefined
    let owner: Checked | undefined
    // (the records listed are those of one substitute, as a rule)
    if (listed.length === 1) owner = listed[0].checked
    else {
      let owners = this._owners
      if (owners === undefined) {
        owners = this._owners = new Map()
        for (const { checked, records } of listed) for (const own of records) owners.set(own, checked)
      }
      owner = owners.get(record)
    }
    return owner === undefined || isForeign(owner) ? undefined : owner
  }
}

/** E107: what one use of a check view counts (see MatchedSubstitutes.use). */
const useOf = (subject: CheckSubject): CheckSubject => subject instanceof MatchedSubstitutes ? subject.use() : subject

/** Whether a call of received / didNotReceive has the arguments of a check (see deferStringCheck). */
const checkArguments = (name: StringAssertionKey, args: readonly unknown[]): boolean =>
  name === 'didNotReceive' ? args.length === 0 : args.length === 0 || (args.length === 1 && isValidCount(args[0]))

/**
 * E81 (c): `received` / `didNotReceive`, the string forms, read on the result of a call with matchers (outside the
 * configure view). As on any other substitute (D11): invoked and then followed by anything but a substitution method, it
 * is a check of the same substitutes as the symbol forms; followed by a substitution method
 * (`repo.find(Arg.any()).received(1).returns(x)`), or used without being invoked, it is a nested setup of a member of
 * that name, as before. `subject`: what the check counts (see MatchedSubstitutes). Further down such a call, the string
 * forms are checks the same way (see configureMember and routedView).
 */
const stringCheckThroughMatchers = (
  state: SubstituteState, key: PropertyKey, specification: RecordedArguments, name: StringAssertionKey, subject: () => MatchedSubstitutes
): any => {
  // E48: the member of that name has a setup (a nested setup through the call), so such a call is no check
  const configured = (): boolean => {
    const existing = state.callSubstitutionFor(key, specification)
    const nested = existing?.method === 'auto' ? existing.entry!.materializedState : undefined
    return nested !== undefined && configuresMember(nested, name)
  }
  // the member of that name of the auto-substitute that a nested setup through the call configures
  return stringCheckOn(
    start => nestedSetupTarget(state, key, specification, name, start, false)[name],
    () => `${state.memberPath(key)}${pathArguments(specification.value)}.${name}`, name, subject, configured
  )
}

/**
 * The string form `name` read where a check counts `subject` (see stringCheckThroughMatchers): `member(start)` is the
 * member of that name that a nested setup configures, `path()` the path of the member.
 */
const stringCheckOn = (
  member: (start: Function) => any, path: () => string, name: StringAssertionKey, subject: () => CheckSubject, configured: () => boolean
): any => {
  const print: Printer = () => path()
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      return member(get)[property]
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      member(set)[property] = value
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return stringCheckView(name, args, subject(), start => member(start)(...args), () => `${path()}${pathArguments(args)}`, configured, apply)
    },
    construct: function construct(_target: unknown, args: any[]) {
      const constructor = member(construct)
      return new constructor(...args)
    }
  })
}

/**
 * E81: `repo.find(Arg.any()).received(1)`, `repo.find(Arg.any()).items.received(1)`: a check view of `subject` (with the
 * count from the arguments), unless a substitution method follows: then `setupCall` gives the setup of the member of that
 * name that it configures. E48: reported when nothing follows and the arguments are those of a check, unless
 * `configured()` (the member of that name has a setup, see deferStringCheck). E88, E89: the check is opened when it is
 * used (see MatchedSubstitutes.open); a check of another copy's substitute that stands for it gets the use instead.
 */
const stringCheckView = (
  name: StringAssertionKey, args: any[], subject: CheckSubject, setupCall: (start: Function) => any, path: () => string,
  configured: () => boolean, stackStart: Function
): any => {
  const print: Printer = () => path()
  const dangling = checkArguments(name, args)
    ? deferDanglingCheck(subject, 'string', name === 'didNotReceive' ? 0 : args[0], checkViewSite(stackStart), () => !configured())
    : undefined
  const count = (start: Function): ExpectedCount => {
    settle(dangling)
    return name === 'didNotReceive' ? 0 : validateExpectedCount(args[0], start)
  }
  const delegated = (expected: ExpectedCount, start: Function): any =>
    subject instanceof MatchedSubstitutes ? subject.open(name, expected, start) : undefined
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      if (substitutionMethodOf(property) !== undefined) {
        settle(dangling)
        return setupCall(get)[property]
      }
      const expected = count(get)
      const other = delegated(expected, get)
      return other !== undefined ? other[property] : assertionMember(useOf(subject), property, expected, get)
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      const expected = count(set)
      const other = delegated(expected, set)
      if (other !== undefined) other[property] = value
      else assertSet(useOf(subject), property, value, expected, set)
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, callArgs: any[]) {
      const expected = count(apply)
      const other = delegated(expected, apply)
      if (other !== undefined) other(...callArgs)
      else assertDirectCall(useOf(subject), callArgs, expected, apply)
      return undefined
    },
    construct: function construct(_target: unknown, callArgs: any[]) {
      const expected = count(construct)
      const other = delegated(expected, construct)
      if (other !== undefined) new other(...callArgs) // eslint-disable-line no-new
      else assertDirectCall(useOf(subject), callArgs, expected, construct)
      return {}
    },
    defineProperty: function defineProperty(target: () => Printer): boolean {
      settle(dangling)
      throw definePropertyError(target, defineProperty)
    },
    preventExtensions: function preventExtensions(target: () => Printer): boolean {
      settle(dangling)
      throw preventExtensionsError(target, preventExtensions)
    }
  })
}

// ---- configure view: every call is a setup ----------------------------------------------------

const configureSetError = (start: Function) => SubstituteException.generic(
  'Property assignments cannot be configured. Use .returns(...) on the property to configure what it returns.',
  start
)

/**
 * `configuring`: an explicit configure view (`sub[configure]()`), where every call is a setup (D5), also of a member called
 * received or didNotReceive. Otherwise (E81) the view is part of a nested setup that started with a call with matchers
 * outside it (`repo.find(Arg.any()).items...`), where the string forms are checks, as on any other substitute (D11).
 */
const createConfigureProxy = (state: SubstituteState, configuring = true): any => {
  const print: Printer = () => `${state.path}[configure]()`
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      if (isSubstitutionSymbol(property)) throw substitutionOnSubstituteError(property, get)
      return configureMember(state, property, configuring)
    },
    set: function set() {
      throw configureSetError(set)
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      return configureCall(state, SELF, RecordedArguments.forSpecification(args), false, configuring)
    },
    // E23: a setup of `new` is a setup of the call
    construct: function construct(_target: unknown, args: any[]) {
      return configureCall(state, SELF, RecordedArguments.forSpecification(args), false, configuring)
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
const configureViewOf = (value: any, configuring: boolean): any => {
  if (isFaceProxy(value)) {
    const face = value[INTERNAL] as Face | undefined
    if (face !== undefined) return createConfigureProxy(faceState(face), configuring)
  }
  return value[constants.CONTEXT.configure.symbol]()
}

const nestedOfRealValueError = (path: string, member: string, reason: string, start: Function) => SubstituteException.generic(
  `Cannot configure ${path}: ${member} ${reason}, which is not a substitute, and members of a real value cannot be ` +
  `configured. Configure ${member} to return a substitute (e.g. Substitute.for()) and configure that one, ` +
  `or configure what ${member} returns as a whole.`,
  start
)

/** Whether a nested setup through a member or a call that answers so is forwarded (see forwardNestedSetup). */
const forwards = (substitution: Substitution | undefined, mimicked: { value: unknown } | undefined): boolean =>
  (substitution !== undefined && substitution.method !== 'auto') || mimicked !== undefined

/** The configure view to forward a nested setup to, or undefined when the member or call does not answer yet. */
const forwardNestedSetup = (
  path: string, member: string, substitution: Substitution | undefined, mimicked: { value: unknown } | undefined, start: Function,
  configuring: boolean
): any => {
  if (substitution !== undefined && substitution.method !== 'auto') {
    if (substitution.method !== 'returns')
      throw nestedOfRealValueError(path, member, `is configured with ${substitution.method}()`, start)
    const value = substitution.peekValue()
    if (isSubstituteProxy(value)) return configureViewOf(value, configuring)
    throw nestedOfRealValueError(path, member, `returns ${formatValue(value, false)}`, start)
  }
  if (mimicked !== undefined) {
    if (isSubstituteProxy(mimicked.value)) return configureViewOf(mimicked.value, configuring)
    throw nestedOfRealValueError(path, member, `is mimicked with ${formatValue(mimicked.value, false)}`, start)
  }
  return undefined
}

const configureMember = (state: SubstituteState, key: PropertyKey, configuring = true): any => {
  const context = contextMethodOf(key)
  if (context !== undefined) return contextFunction(context, () => state, undefined, () => checkSubjectOf(state))
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
      // (E76: a member that answers with the instance itself reads as the substitute, so nested setups configure it)
      const mimickedValue = substitution === undefined && instance !== undefined && hasMember(instance, key)
        ? fromMimicked(instance[key], instance, state) : undefined
      // a real method of a mimicked instance reads as a handle (see realGet), so nested setups configure that handle
      const mimicked = mimickedValue !== undefined && (typeof mimickedValue !== 'function' || isSubstituteProxy(mimickedValue))
        ? { value: mimickedValue } : undefined
      if (forwards(substitution, mimicked)) {
        const forward = (start: Function) =>
          forwardNestedSetup(`${state.memberPath(key)}.${keyToString(property)}`, keyToString(key), substitution, mimicked, start, configuring)
        // E90: below a call with matchers, only nested setups are forwarded; checks count along the route
        const route = routeOf(state)
        return route === undefined ? forward(get)[property] : routedView(forward, extendRoute(route, memberStep(key)), configuring)[property]
      }
      // D26: call/apply/bind are members here like any other: setups through them configure the member reading
      return configureMember(state.propertyEntry(key).state, property, configuring)
    },
    set: function set() {
      throw configureSetError(set)
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      // E81: below a call with matchers, outside a configure view, `received(n)` is a check (see createConfigureProxy)
      if (!configuring && isStringAssertionKey(key)) {
        const setupCall = () => configureCall(state, key, RecordedArguments.forSpecification(args), false, false)
        return stringCheckView(key, args, checkSubjectOf(state), setupCall, () => `${state.memberPath(key)}${pathArguments(args)}`,
          () => configuresMember(state, key), apply)
      }
      return configureCall(state, key, RecordedArguments.forSpecification(args), false, configuring)
    },
    construct: function construct(_target: unknown, args: any[]) {
      return configureCall(state, key, RecordedArguments.forSpecification(args), false, configuring)
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
const nestedSetupTarget = (
  state: SubstituteState, key: PropertyKey, specification: RecordedArguments, property: PropertyKey | undefined, start: Function, configuring: boolean
): any => {
  const answering = specification.argumentsClass === 'plain'
    ? state.findCallSubstitution(key, new ArgumentHashes(specification.value!))
    : state.callSubstitutionFor(key, specification)
  const call = `${memberLabel(key)}${formatArguments(specification.value, false)}`
  const path = `${state.memberPath(key)}${formatArguments(specification.value, false)}${property === undefined ? '(...)' : `.${keyToString(property)}`}`
  if (!forwards(answering, undefined)) return createConfigureProxy(nestedEntry(state, key, specification).state, configuring)
  const forward = (stackStart: Function) => forwardNestedSetup(path, call, answering, undefined, stackStart, configuring)
  // E90: through a call with matchers (or below one), only nested setups are forwarded; checks count along the route
  const route = routeThroughCall(state, key, specification)
  return route === undefined ? forward(start) : routedView(forward, route, configuring)
}

/**
 * E90 (R14-ADV-1): a point of a nested setup below a call with matchers that D31 forwards to a configured value (or
 * further down from one). Nested setups go on in the configure view that they are forwarded to (`target(start)`, which
 * throws D31's usage error when the value is not a substitute, see forwardNestedSetup); a check opened here or further
 * down counts the substitutes along `route` (see MatchedSubstitutes), as one at the first step does, never the configured
 * value alone, and it evaluates nothing of the forwarded views. `member`: a member of the point, read but not known yet
 * to be read or called. The string forms are checks here as below any call with matchers (outside an explicit configure
 * view, `configuring`).
 */
const routedView = (target: (start: Function) => any, route: CheckRoute, configuring: boolean, member?: PropertyKey): any => {
  const own = member === undefined ? target : (start: Function) => target(start)[member]
  const here = member === undefined ? route : extendRoute(route, memberStep(member))
  const print: Printer = () => `${routePath(here)} (configure)`
  const invoked = (args: any[], construct: boolean): { target: (start: Function) => any, route: CheckRoute } => {
    const specification = RecordedArguments.forSpecification(args)
    return {
      target: start => {
        if (member === undefined) {
          const callee = target(start)
          return construct ? new callee(...args) : callee(...args)
        }
        const parent = target(start)
        return construct ? new parent[member](...args) : parent[member](...args)
      },
      route: extendRoute(route, callStep(member ?? SELF, specification))
    }
  }
  return createView(print, {
    get: function get(_target: unknown, property: PropertyKey) {
      if (isSpecialProperty(property)) return special(property, print, undefined)
      const context = contextMethodOf(property)
      if (context === 'received' || context === 'didNotReceive') return contextFunction(context, () => route.origin, undefined, () => new MatchedSubstitutes(here))
      if (context !== undefined || substitutionMethodOf(property) !== undefined) return own(get)[property]
      if (!configuring && isStringAssertionKey(property))
        return stringCheckOn(start => own(start)[property], () => `${routePath(here)}.${property}`, property, () => new MatchedSubstitutes(here), () => false)
      return routedView(own, here, configuring, property)
    },
    set: function set(_target: unknown, property: PropertyKey, value: unknown) {
      own(set)[property] = value
      return true
    },
    apply: function apply(_target: unknown, _thisArg: unknown, args: any[]) {
      const next = invoked(args, false)
      return routedView(next.target, next.route, configuring)
    },
    construct: function construct(_target: unknown, args: any[]) {
      const next = invoked(args, true)
      return routedView(next.target, next.route, configuring)
    }
  })
}

/**
 * A call in a setup: `.returns(...)` configures it, anything else configures the auto-substitute it returns.
 *
 * `stringAssertion` marks a call of the string `received` / `didNotReceive` with Arg matchers among its
 * arguments, outside a configure() view. Followed by a substitution method it is a setup of a member with that
 * name like any other; followed by any other member access or an assignment it is the assertion API (D11), so
 * `sub.received(Arg.any()).add(1)` reports the invalid count (D10) instead of configuring something silently.
 */
const configureCall = (state: SubstituteState, key: PropertyKey, specification: RecordedArguments, stringAssertion = false, configuring = false): any => {
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
      // E81: a check through a call with matchers (it registers no nested setup, see MatchedSubstitutes)
      if (hasMatchers(specification)) {
        const context = contextMethodOf(property)
        const subject = () => new MatchedSubstitutes(routeThroughCall(state, key, specification)!)
        if (context === 'received' || context === 'didNotReceive') return contextFunction(context, () => state, undefined, subject)
        if (!configuring && isStringAssertionKey(property)) return stringCheckThroughMatchers(state, key, specification, property, subject)
      }
      return nestedSetupTarget(state, key, specification, property, get, configuring)[property]
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
      return nestedSetupTarget(state, key, specification, undefined, apply, configuring)(...args)
    },
    construct: function construct(_target: unknown, args: any[]) {
      if (stringAssertion) {
        assertDirectCall(state, args, assertionCount(construct), construct)
        return {}
      }
      return constructed(nestedSetupTarget(state, key, specification, undefined, construct, configuring)(...args))
    }
  })
}
