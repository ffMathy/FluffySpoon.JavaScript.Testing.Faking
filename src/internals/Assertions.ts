import { inspect, types } from 'util'

import { AutoEntry, SubstituteState } from './SubstituteState'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException, ListedCall, ExpectedKind, RecordLabels } from './SubstituteException'
import { RecordLabelContext, SameArguments, codeMember, codePath, recordLabelContext, recordPath, sharedNotes } from './Paths'
import { CallRecord } from './CallRecord'
import { NO_FRAMES, StackHolder, captureStack, currentFrame, frameOfStack, sameExpression, sameLineAfter, stackText } from './CallSite'
import { SELF, isStringAssertionKey, keyToString } from './Constants'
import { isSubstituteProxy } from '../shared'
import { plural, truncateText } from './utilities'

/** undefined means "1 or more" */
export type ExpectedCount = number | undefined

/**
 * E81 (R13FE-3): what a check through the result of a call with matchers counts the calls of: the substitutes that the
 * received calls matching it answered (`bus.on('saved', Arg.any())[received](1)()` checks what every `bus.on('saved',
 * handler)` returned). Its path is that of the call with matchers (`@Substitute.on('saved', Arg.any{any})`), its records
 * those of all of them, in the order they were received, and each record names the substitute it belongs to.
 */
export interface SeveralSubstitutes {
  readonly path: string
  /** The substitutes, in the order of the received calls that answered them. */
  readonly states: readonly SubstituteState[]
  memberPath(key: PropertyKey): string
  recordsFor(key: PropertyKey): CallRecord[]
  /** The substitute that a record of recordsFor belongs to, as messages name it. */
  ownerOf(record: CallRecord): { readonly path: string } | undefined
  /** E99: records that a failing check lists after those of recordsFor, without counting them. */
  uncountedFor?(key: PropertyKey): CallRecord[]
}

/** What a check counts the calls of: a substitute, or several (E81). */
export type CheckSubject = SubstituteState | SeveralSubstitutes

const ownerOf = (subject: CheckSubject, record: CallRecord): { readonly path: string } | undefined =>
  subject instanceof SubstituteState ? undefined : subject.ownerOf(record)

/** E99: the records that a failing check lists without counting them (sets, or reads and calls), never marked as matching. */
const uncountedOf = (subject: CheckSubject, key: PropertyKey, sets: boolean): ListedCall[] => {
  if (subject instanceof SubstituteState || subject.uncountedFor === undefined) return []
  const listed: ListedCall[] = []
  for (const record of subject.uncountedFor(key)) if ((record.kind === 'set') === sets) listed.push({ record, matches: false, owner: subject.ownerOf(record) })
  return listed
}

/** E99: whether two received calls were made with equal arguments (see Paths.handOuts). */
const sameArguments: SameArguments = (a, b) => RecordedArguments.literalsEqual(a, b)

/** E99: the entry of an auto-substitute (its own, or its state's), undefined for a root or anything else. */
const entryOf = (substitute: { readonly path: string } | undefined): AutoEntry | undefined =>
  substitute instanceof AutoEntry ? substitute : substitute instanceof SubstituteState ? substitute.owner : undefined

/**
 * E99 (R15FE-5): the path of a substitute as its received calls are shown: with the call that a substitute shared by a
 * nested setup through a call with matchers was handed out to, when there is one (see Paths.recordPath).
 */
const recordPathOf = (substitute: { readonly path: string }, context: RecordLabelContext): string => {
  const entry = entryOf(substitute)
  return entry === undefined ? substitute.path : recordPath(entry, context)
}

/** E99: how a failure message shows the substitutes of the records it lists (see SubstituteException.RecordLabels). */
const recordLabels = (subject: CheckSubject): RecordLabels => {
  const context = recordLabelContext(sameArguments)
  return {
    path: owner => recordPathOf(owner ?? subject, context),
    notes: owners => sharedNotes(owners.map(owner => entryOf(owner ?? subject)), context)
  }
}

/** received(n): n must be omitted or be a non-negative safe integer. received(0) is didNotReceive(). */
export const validateExpectedCount = (count: unknown, stackStart?: Function): ExpectedCount => {
  if (count === undefined) return undefined
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    let printed: string
    try { printed = inspect(count) } catch { printed = typeof count }
    throw SubstituteException.generic(
      `Expected count has to be a non-negative integer (or omitted for "1 or more"), but received ${printed}.`,
      stackStart
    )
  }
  return count
}

const countMatches = (count: ExpectedCount, actual: number) => count === undefined ? actual >= 1 : actual === count

const receivedText = (matches: number) => matches === 0 ? 'none' : matches.toString()

const times = (count: number) => `${count} ${plural('time', count)}`

/** A method assertion found too few calls, and the member was also read without being invoked. */
const readWithoutCallHint = (state: CheckSubject, key: PropertyKey, reads: number): string =>
  `${state.memberPath(key)} was read ${times(reads)} without being called; reading a method does not count as calling it.`

/**
 * E98 (R14-ADV-3): a method assertion found too few calls of a member whose reads answered values that cannot be called
 * (see answersValues), so it is no method: its reads are what can be checked, by a check that does not call it.
 */
const readValuesHint = (state: CheckSubject, key: PropertyKey, reads: number, count: ExpectedCount): string =>
  `${state.memberPath(key)} was read ${times(reads)}, and its reads answered a value that cannot be called, so they are ` +
  `property reads, not method calls. To check them, leave out the call: ` +
  `${asExpression(state)}.received(${count === undefined ? '' : count})${memberAccess(key)}`

/**
 * didNotReceive().m(...) on a member that was only read (A:RT-3). The property-style half of the assertion is
 * decided when the member is read (D9), so the reads fail it even when an invocation follows.
 */
const onlyReadHint = (state: CheckSubject, key: PropertyKey, reads: number): string => {
  const name = keyToString(key)
  return `${state.memberPath(key)} was read ${times(reads)} but never called. ` +
    `If it is a method that was only read, for example passed as a callback, these reads still fail didNotReceive().${name}(...): ` +
    `the assertion is decided when ${name} is read, before it is known whether it is called. ` +
    `Call sub[clearReceivedCalls]() after the arrange step to reset the reads.`
}

/** `sub`, `sub.logger`, `sub.getCalc()`, ...: the substitute as it would be written in a test. */
const asExpression = (state: { readonly path: string }): string => state.path.replace(/^@Substitute/, 'sub')

const memberAccess = (key: PropertyKey): string =>
  typeof key === 'string' && /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${typeof key === 'symbol' ? keyToString(key) : inspect(key)}]`

const asHints = (hint: string | undefined): string[] | undefined => hint === undefined ? undefined : [hint]

/**
 * E97: how many auto-substitutes (and received calls on them) the search of fluentChainHint looks at, at most, and how
 * many places it names. Like a printout of a substitute (E35), it walks the auto-substitutes without recursion and
 * builds only the paths it shows (bounded, see Paths), so a deep or wide tree of them costs little; it runs only when
 * a check fails.
 */
const FLUENT_SEARCH_BUDGET = 10000
const FLUENT_PATHS_SHOWN = 3
/** E97: and the characters of each path it names, at most (each argument in a path is bounded, but a path has many). */
const FLUENT_PATH_CHARACTERS = 1000
/** E108: how many of the methods on the way to that place the fluent remedy names, at most. */
const FLUENT_METHODS_SHOWN = 3

/**
 * E97 (R14FE-5): a check that found no record of the member on the checked substitute, while a member of that name was
 * called on auto-substitutes further down (the code under test made an unconfigured fluent call, as in
 * `reply.code(404).send(...)` or `span.setAttribute(...).setStatus(...)`, whose result is a new substitute): a hint that
 * names up to FLUENT_PATHS_SHOWN of them, nearest first, and the remedy. Undefined when there are none (within the
 * search's bounds).
 *
 * E108 (R15-ADV-6): the remedy is for the first place named, and works when it is followed. When every step from the
 * checked substitute down to it is a call (`reply.code(404).header(...).send(...)`), it names each of those methods
 * (up to FLUENT_METHODS_SHOWN, and says that the others likewise): once all of them return the substitute, the member
 * is called on the substitute itself. When a step is a member read (`db.users.where({ id: 1 }).limit(1).exec()`), making
 * methods return the substitute cannot bring the calls back to it, so the remedy is to check the substitute the member
 * was called on, named by its whole path (`sub.users.where({ id: 1 }).limit(1).received(1).exec(...)`).
 *
 * E112 (R16-ADV-4, R16-ADV-6): both remedies are written as code that does what they say when it is run (see codePath):
 * members as JavaScript accesses them (`sub['my-key']`, `sub[0]`, `sub[Symbol.for('k')]`), the whole path, and a
 * substitute shared by a nested setup through a call with matchers as the concrete call it was returned to
 * (`sub.to('room-a').compress(Arg.all()).returns(sub.to('room-a'))`: written with the matchers, the call in returns()
 * would be a setup, not that substitute). When the path cannot be written as code (a symbol that is not registered, or
 * more than FLUENT_PATH_CHARACTERS characters), the remedy is worded without it. Arguments are written as paths print
 * them. E132 (R17-ADV-5): the check remedy is code only when every argument on its path prints as code that gives an
 * equal value (see Paths.codePath); otherwise it names the substitute as messages print it, to be reached with the same
 * arguments. In the fluent remedy, arguments that do not print as code (functions, values that are cut) are written by
 * hand.
 */
const fluentChainHint = (subject: CheckSubject, key: PropertyKey, count: ExpectedCount): string | undefined => {
  if (key === SELF) return undefined
  const roots: readonly SubstituteState[] = subject instanceof SubstituteState ? [subject] : subject.states
  const found: SubstituteState[] = []
  let more = false
  let budget = FLUENT_SEARCH_BUDGET
  // breadth first, so that the nearest places come first; each auto-substitute is looked at when it is reached, so that
  // the first ones of a substitute with more of them than the budget are looked at, too
  const queue: SubstituteState[] = [...roots]
  search: for (let index = 0; index < queue.length; index++) {
    for (const entry of queue[index].entries()) {
      if (--budget < 0) break search
      const nested = entry.materializedState
      if (nested === undefined) continue
      const records = nested.recordsFor(key)
      budget -= records.length
      if (records.some(record => record.kind === 'call')) {
        if (found.length === FLUENT_PATHS_SHOWN) {
          more = true
          break search
        }
        found.push(nested)
      }
      queue.push(nested)
    }
  }
  if (found.length === 0) return undefined
  // (E99: as their records are shown, with the call that a substitute shared by a setup with matchers was handed out to)
  const context = recordLabelContext(sameArguments)
  const paths = found.map(state => `${truncateText(`${recordPathOf(state, context)}.${keyToString(key)}`, FLUENT_PATH_CHARACTERS)}(...)`)
  if (more) paths.push('more')
  const lead = `${keyToString(key)} was not called on ${subject.path} itself, but on ${paths.length === 1 ? 'a substitute' : 'substitutes'} further down: ${andList(paths)}.`
  // E108: the steps from the checked substitute (one of the roots) down to the first place named
  const place = found[0]
  const rootSet = new Set<SubstituteState>(roots)
  const steps: AutoEntry[] = []
  let state = place
  do {
    steps.push(state.owner!)
    state = state.owner!.parent
  } while (!rootSet.has(state))
  // (a call with matchers on the way is a nested setup that every matching call answers with one substitute: a setup of
  // that method with Arg.all() would not answer them, as the one with matchers is more specific, D4)
  const received = `received(${count === undefined ? '' : count})`
  if (steps.some(step => step.kind !== 'call' || step.specifiesMatchers)) {
    // E112: written as code, with the call a shared substitute was handed out to when there was one (see codePath)
    const expression = codePath(place.owner, context, false, FLUENT_PATH_CHARACTERS, true)
    const member = codeMember(key)
    // E132 (R17-ADV-5): arguments that are not code (see codePath): the path as messages print it, without code
    if (typeof expression !== 'string' && expression.notCode === 'arguments' && member !== undefined) {
      return `${lead} To check calls there, check that substitute, ${truncateText(recordPathOf(place, context), FLUENT_PATH_CHARACTERS)}, ` +
        `reached with the same arguments, with ${received} on it; its arguments cannot be written as code.`
    }
    if (typeof expression !== 'string' || member === undefined) {
      return `${lead} To check calls there, check that substitute itself, with ${received} on it; its path cannot be ` +
        `written as code (a symbol that is not registered with Symbol.for(), or more than ${FLUENT_PATH_CHARACTERS} characters).`
    }
    return `${lead} To check calls there, check that substitute: ${expression}.${received}${member}(...)`
  }
  // every step is a call: each of those methods (once each, from the top) returns the checked substitute (E112: written
  // as code, with the call that a shared substitute was handed out to, the first of several: all of them answered it;
  // its arguments as paths print them, E132 is for the check remedy above)
  const parent = state.owner === undefined ? 'sub' : codePath(state.owner, context, true, FLUENT_PATH_CHARACTERS, false)
  const methods: PropertyKey[] = []
  for (let index = steps.length - 1; index >= 0; index--) if (!methods.includes(steps[index].key)) methods.push(steps[index].key)
  const shown = methods.slice(0, FLUENT_METHODS_SHOWN)
  const members = shown.map(method => method === SELF ? '' : codeMember(method))
  if (typeof parent !== 'string' || members.some(member => member === undefined)) {
    return `${lead} A call that is not configured answers a new substitute. For a fluent API, make ` +
      `${methods.length === 1 ? 'the method' : 'each method on the way'} return the substitute it is called on (a setup ` +
      `with Arg.all() whose value is that substitute) or mimick an instance whose methods return this.`
  }
  const setups = members.map(member => `${parent}${member}(Arg.all()).returns(${parent})`)
  const others = methods.length - setups.length
  if (setups.length === 1) {
    return `${lead} A call that is not configured answers a new substitute. For a fluent API, make the method return the ` +
      `substitute (${setups[0]}) or mimick an instance whose methods return this.`
  }
  const listedSetups = others > 0 ? `${setups.join(', ')} and likewise for the ${others} other ${others === 1 ? 'method' : 'methods'} on the way` : andList(setups)
  return `${lead} A call that is not configured answers a new substitute. For a fluent API, make each method on the way ` +
    `return the substitute (${listedSetups}) or mimick an instance whose methods return this.`
}

/** `a`, `a and b`, `a, b and c` */
const andList = (items: readonly string[]): string =>
  items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * The amended D9 case: a property-style assertion on a member that has only ever been invoked, never read as a
 * property, and the assertion was not invoked either. A method assertion was most likely intended.
 */
const onlyInvokedExplanation = (state: CheckSubject, key: PropertyKey, calls: number, count: number): string =>
  `${keyToString(key)} was never read as a property; it was called ${times(calls)} as a method. ` +
  `To assert calls, invoke it: ${asExpression(state)}.received(${count})${memberAccess(key)}(...)`

/** Method assertion: counts invocations whose arguments match. Property reads never count. */
export const assertCall = (state: CheckSubject, key: PropertyKey, args: any[], count: ExpectedCount, stackStart?: Function): void => {
  const specification = RecordedArguments.forSpecification(args)
  const records = state.recordsFor(key).filter(record => record.kind !== 'set')
  const listed: ListedCall[] = []
  let matches = 0
  let reads = 0
  for (const record of records) {
    if (record.kind !== 'call') {
      reads++
      listed.push({ record, matches: false, owner: ownerOf(state, record) })
      continue
    }
    const match = specification.matchDetailed(record.args)
    if (match.matches) matches++
    listed.push({ record, matches: match.matches, predicateThrew: match.predicateThrew, predicateError: match.predicateError, owner: ownerOf(state, record) })
  }
  if (countMatches(count, matches)) return
  const tooFew = matches < (count ?? 1)
  listed.push(...uncountedOf(state, key, false))
  throw SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    subject: state,
    recordLabels: recordLabels(state),
    key,
    expected: { count, kind: 'method', specification },
    receivedText: receivedText(matches),
    listed,
    // E98: no method hint for a member that is no method (decided as E85 decides it)
    hints: tooFew && reads > 0
      ? [answersValues(state, key) ? readValuesHint(state, key, reads, count) : readWithoutCallHint(state, key, reads)]
      // E97: no record of the member at all (a direct-call check of a member, `sub.m[received]()(1)`), but calls of it
      // further down a fluent chain
      : tooFew && records.length === 0 ? asHints(fluentChainHint(state, key, count)) : undefined
  }, stackStart)
}

/** Property assignment assertion: counts assignments whose value matches (Arg matchers allowed). */
export const assertSet = (state: CheckSubject, key: PropertyKey, value: unknown, count: ExpectedCount, stackStart?: Function): void => {
  const specification = RecordedArguments.forSpecification([value])
  const records = state.recordsFor(key).filter(record => record.kind === 'set')
  const listed: ListedCall[] = []
  let matches = 0
  for (const record of records) {
    const match = specification.matchDetailed(record.args)
    if (match.matches) matches++
    listed.push({ record, matches: match.matches, predicateThrew: match.predicateThrew, predicateError: match.predicateError, owner: ownerOf(state, record) })
  }
  if (countMatches(count, matches)) return
  listed.push(...uncountedOf(state, key, true))
  throw SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    subject: state,
    recordLabels: recordLabels(state),
    key,
    expected: { count, kind: 'set', specification },
    receivedText: receivedText(matches),
    listed
  }, stackStart)
}

export type DeferredAssertion = {
  error: () => SubstituteException
  settled: boolean
  /** The stack captured where the check was written (its member read, or the check view itself, E48). */
  site?: StackHolder
}

type Schedule = (callback: () => void) => void

/**
 * D34: the scheduler of deferred reports is captured when the library is loaded, so that fake timers installed
 * later (jest.useFakeTimers(), @sinonjs/fake-timers faking queueMicrotask and nextTick) cannot swallow a report. Fake
 * timers that are installed before the library is loaded can still delay it.
 *
 * E6: a report is thrown from a microtask (queueMicrotask). Test runners attribute an exception thrown there to the
 * running test: jest reports it as that test's failure and runs the next tests, where an exception thrown from
 * process.nextTick or setImmediate, or an unhandled rejection, crashes the jest process. Node.js 10 has no
 * queueMicrotask; there the report falls back to process.nextTick.
 */
const captureSchedule = (): Schedule => {
  if (typeof queueMicrotask === 'function') {
    const microtask = queueMicrotask
    return callback => { microtask(callback) }
  }
  if (typeof process !== 'undefined' && process !== null && typeof process.nextTick === 'function') {
    const nextTick = process.nextTick
    return callback => { nextTick.call(process, callback) }
  }
  if (typeof setImmediate === 'function') {
    const immediate = setImmediate
    return callback => { immediate(callback) }
  }
  const timeout = setTimeout
  return callback => { timeout(callback, 0) }
}

/**
 * Where deferred reports are scheduled. Not part of the public API: the library's own tests replace `schedule`
 * to run the reports on demand.
 */
export const deferredReports: { schedule: Schedule } = { schedule: captureSchedule() }

/**
 * Stops a deferred property assertion from being thrown (the access turned out to be a method assertion). E110 (R16V-2):
 * and lets go of what its report would have shown, which a check through a call or a route holds a lot of: a report is
 * kept until its microtask runs, so a loop of checks kept every one of them until the loop ended.
 */
export const settle = (deferred: DeferredAssertion | undefined): void => {
  if (deferred === undefined) return
  deferred.settled = true
  deferred.error = settledReport
  if ((deferred as PendingReport).applies !== undefined) (deferred as PendingReport).applies = undefined
}

/** E110: the report of a deferred assertion that was settled (see settle): it is never thrown. */
const settledReport = (): SubstituteException => SubstituteException.generic('A settled check has nothing to report.')

/**
 * The property-style half of `sub.received(n).member`. At this point it is not known yet whether the
 * member will be invoked (a method assertion, checked when it is invoked) or not (a property assertion).
 *
 * - The property assertion holds: nothing to do now.
 * - With no count ("1 or more"), a member that has been invoked counts as received, so the property-style
 *   form passes and only an invocation is checked further.
 * - It fails and the member has never been invoked: a method assertion would fail as well (or, for a
 *   count of 0, the member is treated as a property), so it throws now.
 * - It fails and the member has been read as a property but a method assertion could not pass either:
 *   throws now.
 * - The only deferred case (D9): the property-style form fails, the member has been invoked, the count is
 *   finite, and either a method assertion with that count could still pass or the member has only ever
 *   been invoked (never read as a property), so the access is most likely the start of a method assertion
 *   whose message needs the arguments. The failure is scheduled on a microtask (E6) and cancelled as soon
 *   as the member is invoked; only a property-style assertion that is never invoked reports it there.
 *   For a member that was only invoked, the report says so and shows the method assertion to write instead.
 * - D33: a property-style `didNotReceive().m` / `received(0).m` on a member that was only invoked holds as a
 *   property assertion, but is most likely a method assertion whose parentheses were forgotten. It gets the same
 *   cancellable deferred report.
 */
export const assertPropertyRead = (state: CheckSubject, key: PropertyKey, count: ExpectedCount, stackStart?: Function): DeferredAssertion | undefined => {
  const records = state.recordsFor(key).filter(record => record.kind !== 'set')
  let reads = 0
  let calls = 0
  for (const record of records) {
    if (record.kind === 'get') reads++
    else calls++
  }
  if (countMatches(count, reads)) {
    if (count === 0 && reads === 0 && calls > 0) return defer(stackStart, () => SubstituteException.forCallCountMismatch({
      substitutePath: state.path,
      subject: state,
      recordLabels: recordLabels(state),
      key,
      expected: { count, kind: 'unknown' },
      receivedText: `${calls} ${plural('method call', calls)}`,
      explanation: `${keyToString(key)} was called ${times(calls)} as a method; ` +
        `to assert calls, invoke it: ${asExpression(state)}.didNotReceive()${memberAccess(key)}(...)`,
      listed: records.map((record: CallRecord) => ({ record, matches: false, owner: ownerOf(state, record) }))
    }))
    return undefined
  }
  if (count === undefined && calls > 0) return undefined

  const deferrable = calls > 0 && count !== undefined && (count <= calls || reads === 0)
  // D36, E77 (R12FE-2): a member that was only read (no calls at all) fails as a property assertion and as a method
  // assertion, whatever the count (above or below the reads), and it is not known yet which one this is: the message
  // names neither kind, and says that the member was read without being called. For a count of 0 the reads are what
  // fails didNotReceive(): they are marked, and the hint points at clearing the received calls after the arrange step.
  const onlyRead = calls === 0 && reads > 0
  // E85 (R13-ADV-2): unless what the reads answered cannot be called (see answersValues): then the member is no method,
  // and the reads are what the check counts, as a property check
  const values = onlyRead && answersValues(state, key)
  // A deferred failure is only thrown when the member was not invoked, so it is a property assertion.
  // An immediate failure fails for both readings; the kind is only named when the records show it.
  const kind: ExpectedKind = deferrable || values ? 'property' : 'unknown'
  const createError = (start?: Function) => SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    subject: state,
    recordLabels: recordLabels(state),
    key,
    expected: { count, kind },
    receivedText: kind === 'property' ? (reads === 0 ? 'none' : reads.toString()) : describeReceived(reads, calls),
    explanation: deferrable && reads === 0 ? onlyInvokedExplanation(state, key, calls, count!) : undefined,
    listed: [
      ...records.map((record: CallRecord) => ({ record, matches: record.kind === 'get' && (!onlyRead || values || count === 0), owner: ownerOf(state, record) })),
      ...uncountedOf(state, key, false)
    ],
    // E97: no record of the member at all (the check fails at once), but calls of it further down a fluent chain
    hints: reads === 0 || values ? (records.length === 0 && count !== 0 ? asHints(fluentChainHint(state, key, count)) : undefined)
      : count === 0 && calls === 0 ? [onlyReadHint(state, key, reads)]
        // read but never invoked, or invoked as well: most likely a method, with fewer calls than expected
        : onlyRead || (calls > 0 && count !== undefined && calls < count) ? [readWithoutCallHint(state, key, reads)]
          : undefined
  }, start)

  if (!deferrable) throw createError(stackStart)
  return defer(stackStart, createError)
}

/**
 * The deferred report scheduled last (see cancelDeferredReportOf): of a property-style check (its site: where its member
 * was read), or (E56) of a check view that nothing has followed yet (its site: where the view was created).
 */
let latestDeferred: DeferredAssertion | undefined

/**
 * E37, E47: cancels the deferred report of the check that a matcher usage error (Arg.any('String'), Arg.is('x')) was
 * meant for, so that the usage error is the only error: in `sub.received(2).log(Arg.any('String'))` the report of
 * `.log` was scheduled when the member was read, and the invocation that would cancel it never happens, because
 * evaluating its arguments threw. `matcherStart`: the matcher function that the test called (Arg.any, ...).
 *
 * Only the report of that same check is cancelled: the report scheduled last, if it is still pending, and only when its
 * member was read in the same function (D25), on the same line, before the matcher was called, as V8 reports their
 * positions (before source maps). The report of an earlier statement (`void sub.received(3).log` on one line, a caught
 * `Arg.any('Strin')` on the next, or inside `expect(() => ...)`) is still thrown. A check whose matcher is on another
 * line than its member (`.log(\n  Arg.any('String'))`), or a run without stack traces, keeps its report as well.
 * E56 (R9V-1): the same holds for the report of a check view that nothing followed (E48), whose matcher is an argument
 * of the view itself: in `listener.received(1)(Arg.any('String'))` the invocation of the view never happens either, so
 * the view would be reported as one that checks nothing.
 */
export const cancelDeferredReportOf = (matcherStart: Function): void => {
  const latest = latestDeferred
  if (latest === undefined || latest.settled || latest.site === undefined) return
  const read = frameOfStack(latest.site)
  const matcher = currentFrame(matcherStart)
  if (read === null || matcher === null || !sameExpression(read, matcher)) return
  // E125: the same line of the source, where Node.js has a source map (see CallSite.sameLineAfter)
  if (!sameLineAfter(read, matcher)) return
  settle(latest)
  latestDeferred = undefined
}

/**
 * A report that is thrown later, from a microtask, unless it is settled before. `applies` (E48, string forms): asked
 * when it is due.
 */
type PendingReport = DeferredAssertion & { applies?: () => boolean }

/**
 * E58 (R9-ADV-5): the reports scheduled since the last microtask (D9, D33, E48) are checked together by one microtask,
 * scheduled with the scheduler in place when the batch was started, instead of one microtask per report: nearly every
 * report is settled right away (the check goes on), and a microtask per check made every check about a third slower.
 * A batch still throws one report per microtask: after throwing one, it checks the rest of the batch in a microtask of
 * its own, so the reports come in the order they were scheduled, as before.
 */
type ReportBatch = { schedule: Schedule, reports: PendingReport[] }
let reportBatch: ReportBatch | undefined

const flushReports = (batch: ReportBatch): void => {
  if (reportBatch === batch) reportBatch = undefined
  viewSitesLeft = VIEW_SITES_PER_RUN
  const reports = batch.reports
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index]
    if (latestDeferred === report) latestDeferred = undefined
    if (report.settled) continue
    report.settled = true
    if (report.applies !== undefined && !report.applies()) continue
    if (index + 1 < reports.length) {
      const rest: ReportBatch = { schedule: batch.schedule, reports: reports.slice(index + 1) }
      batch.schedule(() => flushReports(rest))
    }
    throw report.error()
  }
}

/** Schedules a report (see flushReports). It is the report scheduled last (see cancelDeferredReportOf). */
const scheduleReport = (report: PendingReport): void => {
  const schedule = deferredReports.schedule
  let batch = reportBatch
  if (batch === undefined || batch.schedule !== schedule) {
    const started: ReportBatch = batch = reportBatch = { schedule, reports: [] }
    schedule(() => flushReports(started))
  }
  batch.reports.push(report)
  latestDeferred = report
}

/**
 * Schedules a failure that is only reported if the assertion is not invoked (see assertPropertyRead).
 * The message is only built if the failure is really reported (usually the member is invoked right away).
 * E58: its stack is the call site only (the line of the check, as for a check view that nothing follows), captured as
 * cheaply as the call sites of records: a check of a member that was called defers its property-style half every time
 * (`sub[received](1).f(1)`), and capturing the whole stack made such a check about a fifth slower.
 */
const defer = (stackStart: Function | undefined, createError: () => SubstituteException): DeferredAssertion => {
  const site: StackHolder = stackStart === undefined ? {} : captureStack(stackStart)
  const deferred: DeferredAssertion = {
    settled: false,
    site,
    error: () => {
      const error = createError()
      // (as text: its call sites may have been read, see cancelDeferredReportOf)
      const stack = stackText(site)
      const frames = typeof stack === 'string' ? stack.split('\n').slice(1).join('\n') : ''
      if (frames !== '') error.stack = `${error.name}: ${error.message}\n${frames}`
      return error
    }
  }
  scheduleReport(deferred)
  return deferred
}

// ---- E48: a check view with nothing after it ----------------------------------------------------------------------

/** How a check view was written: with the exported symbols (`sub[received](2)`) or with the string names (`sub.received(2)`). */
export type CheckForm = 'symbol' | 'string'

/**
 * E48: the usage error of a check view that nothing followed (`next.didNotReceive()`, `sub[received](2)` as a
 * statement): it checks nothing. It names the substitute and shows the complete forms.
 */
const danglingCheckError = (state: { readonly path: string }, form: CheckForm, count: ExpectedCount): SubstituteException => {
  const name = count === 0 ? 'didNotReceive' : 'received'
  const call = count === 0 ? '()' : count === undefined ? '()' : `(${count})`
  const view = (subject: string) => form === 'symbol' ? `${subject}[${name}]${call}` : `${subject}.${name}${call}`
  const check = view(asExpression(state))
  let message = `${view(state.path)} checked nothing: it was not followed by a call or a member. ` +
    `Complete the check: ${check}(Arg.all()) checks the calls of the substitute itself, ` +
    `${check}.member(...) the calls of one of its members, and ${check}.member its property reads.`
  if (form === 'string')
    message += ` If the substituted type has a member called ${name} of its own, configure its calls ` +
      `(${asExpression(state)}[configure]().${name}(Arg.all()).returns(...)): then such a call is not taken for a check.`
  return SubstituteException.generic(message)
}

/**
 * E61 (R10V-2): how many check views of the symbol forms (`sub[received](n)`, `sub[didNotReceive]()`) record where they
 * were created, per synchronous run (until the reports scheduled in it are checked, see flushReports). Recording it is
 * what such a view costs most (a stack capture, about 1.5 us), and it is only used when nothing follows the view: for
 * the stack of its "checked nothing" report (E48), and to tell whether a matcher usage error in its arguments belongs
 * to it (E56). A test makes far fewer checks than this in one synchronous run; a loop of thousands of checks pays for
 * the first ones only. A view after them that nothing follows is still reported, without the line of the check (as
 * with Error.stackTraceLimit = 0), and its report stays when a matcher in its arguments throws a usage error.
 * The string forms record nothing for this: their call is recorded, with its call site, anyway.
 */
export const VIEW_SITES_PER_RUN = 1000
let viewSitesLeft = VIEW_SITES_PER_RUN

/** Where a check view of a symbol form is created (`stackStart`: the function that creates it), see VIEW_SITES_PER_RUN. */
export const checkViewSite = (stackStart: Function): StackHolder => {
  if (viewSitesLeft <= 0) return NO_FRAMES
  viewSitesLeft--
  return captureStack(stackStart)
}

/**
 * E48: schedules the usage error of a check view that is created now (`site`: where), thrown from a microtask (as D9)
 * unless the view is used before (settle the result): a member access, an assignment, a call or `new` on it. For the
 * string forms, `applies` is asked at that time: the type may have a member of that name of its own.
 * E56: it is the report scheduled last, too, so that a matcher usage error in the view's own arguments cancels it (see
 * cancelDeferredReportOf).
 */
export const deferDanglingCheck = (state: { readonly path: string }, form: CheckForm, count: ExpectedCount, site: StackHolder, applies?: () => boolean): DeferredAssertion => {
  const report: PendingReport = {
    settled: false,
    site,
    applies,
    error: () => {
      const error = danglingCheckError(state, form, count)
      const stack = stackText(site)
      const frames = typeof stack === 'string' ? stack.split('\n').slice(1).join('\n') : ''
      error.stack = frames !== '' ? `${error.name}: ${error.message}\n${frames}` : `${error.name}: ${error.message}`
      return error
    }
  }
  scheduleReport(report)
  return report
}

/*
 * E85 (R13-ADV-2): a property check of a member that was only read fails with E77's kind-neutral text and its hint that
 * reading a method does not call it, because the member may be a method that the code under test looked at without
 * calling it. Not when what the reads answered cannot be called: a property configured with returns() of values that are
 * neither functions nor substitutes (every substitute is a function), with resolves() or rejects() (a promise), or with
 * throws(), or a mimicked instance whose value for the key is not a function (or that does not have the key). Such a
 * member is a property: the check counts property reads, its reads match, and there is no hint. The records do not keep
 * what the reads answered, so the member's setups decide, as they are when the check is made. A member that is configured
 * as a method as well, configured with mimicks(), unconfigured (its reads answer an auto-substitute), or whose mimicked
 * value comes from a getter (which the check does not run), may be a method.
 */
const answersValues = (subject: CheckSubject, key: PropertyKey): boolean => {
  if (subject instanceof SubstituteState) return stateAnswersValues(subject, key)
  return subject.states.length > 0 && subject.states.every(state => stateAnswersValues(state, key))
}

const stateAnswersValues = (state: SubstituteState, key: PropertyKey): boolean => {
  if (state.hasCallSubstitutions(key)) return false
  const property = state.propertySubstitution(key)
  if (property !== undefined) {
    switch (property.method) {
      case 'returns': return property.values.every(value => typeof value !== 'function')
      case 'mimicks': return false
      default: return true
    }
  }
  const instance = state.mimicked?.instance
  if (instance === undefined || isSubstituteProxy(instance) || types.isProxy(instance)) return false
  // (as the read does, see the engine's realGet: a key the instance does not have reads as undefined, unless the
  // substitute itself needs it)
  if (!(key in instance)) return !(isStringAssertionKey(key) || state.hasConfiguredPropertyEntry(key))
  const value = dataValue(instance, key)
  return value !== GETTER && typeof value !== 'function'
}

const GETTER: unique symbol = Symbol('getter')

/** The value of an own or inherited data property, without running a getter (GETTER for an accessor or when unreadable). */
const dataValue = (instance: object, key: PropertyKey): unknown => {
  try {
    for (let current: object | null = instance; current !== null; current = Reflect.getPrototypeOf(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key)
      if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : GETTER
    }
  } catch {
    // (a value that cannot be inspected may be anything)
  }
  return GETTER
}

/** What was received, for a failure that does not know yet whether it is about reads or calls. */
const describeReceived = (reads: number, calls: number): string => {
  if (reads === 0 && calls === 0) return 'none'
  const readsText = `${reads} ${plural('property read', reads)}`
  if (calls === 0) return `${readsText} and no method calls`
  return `${readsText} and ${calls} ${plural('method call', calls)}`
}
