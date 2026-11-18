import { inspect } from 'util'

import { SubstituteState } from './SubstituteState'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException, ListedCall, ExpectedKind } from './SubstituteException'
import { CallRecord } from './CallRecord'
import { StackHolder, currentFrame, frameOfStack, sameExpression, stackText } from './CallSite'
import { keyToString } from './Constants'
import { plural } from './utilities'

/** undefined means "1 or more" */
export type ExpectedCount = number | undefined

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
const readWithoutCallHint = (state: SubstituteState, key: PropertyKey, reads: number): string =>
  `${state.memberPath(key)} was read ${times(reads)} without being called; reading a method does not count as calling it.`

/**
 * didNotReceive().m(...) on a member that was only read (A:RT-3). The property-style half of the assertion is
 * decided when the member is read (D9), so the reads fail it even when an invocation follows.
 */
const onlyReadHint = (state: SubstituteState, key: PropertyKey, reads: number): string => {
  const name = keyToString(key)
  return `${state.memberPath(key)} was read ${times(reads)} but never called. ` +
    `If it is a method that was only read, for example passed as a callback, these reads still fail didNotReceive().${name}(...): ` +
    `the assertion is decided when ${name} is read, before it is known whether it is called. ` +
    `Call sub[clearReceivedCalls]() after the arrange step to reset the reads.`
}

/** `sub`, `sub.logger`, `sub.getCalc()`, ...: the substitute as it would be written in a test. */
const asExpression = (state: SubstituteState): string => state.path.replace(/^@Substitute/, 'sub')

const memberAccess = (key: PropertyKey): string =>
  typeof key === 'string' && /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${typeof key === 'symbol' ? keyToString(key) : inspect(key)}]`

/**
 * The amended D9 case: a property-style assertion on a member that has only ever been invoked, never read as a
 * property, and the assertion was not invoked either. A method assertion was most likely intended.
 */
const onlyInvokedExplanation = (state: SubstituteState, key: PropertyKey, calls: number, count: number): string =>
  `${keyToString(key)} was never read as a property; it was called ${times(calls)} as a method. ` +
  `To assert calls, invoke it: ${asExpression(state)}.received(${count})${memberAccess(key)}(...)`

/** Method assertion: counts invocations whose arguments match. Property reads never count. */
export const assertCall = (state: SubstituteState, key: PropertyKey, args: any[], count: ExpectedCount, stackStart?: Function): void => {
  const specification = RecordedArguments.forSpecification(args)
  const records = state.recordsFor(key).filter(record => record.kind !== 'set')
  const listed: ListedCall[] = []
  let matches = 0
  let reads = 0
  for (const record of records) {
    if (record.kind !== 'call') {
      reads++
      listed.push({ record, matches: false })
      continue
    }
    const match = specification.matchDetailed(record.args)
    if (match.matches) matches++
    listed.push({ record, matches: match.matches, predicateThrew: match.predicateThrew, predicateError: match.predicateError })
  }
  if (countMatches(count, matches)) return
  const tooFew = matches < (count ?? 1)
  throw SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    subject: state,
    key,
    expected: { count, kind: 'method', specification },
    receivedText: receivedText(matches),
    listed,
    hints: tooFew && reads > 0 ? [readWithoutCallHint(state, key, reads)] : undefined
  }, stackStart)
}

/** Property assignment assertion: counts assignments whose value matches (Arg matchers allowed). */
export const assertSet = (state: SubstituteState, key: PropertyKey, value: unknown, count: ExpectedCount, stackStart?: Function): void => {
  const specification = RecordedArguments.forSpecification([value])
  const records = state.recordsFor(key).filter(record => record.kind === 'set')
  const listed: ListedCall[] = []
  let matches = 0
  for (const record of records) {
    const match = specification.matchDetailed(record.args)
    if (match.matches) matches++
    listed.push({ record, matches: match.matches, predicateThrew: match.predicateThrew, predicateError: match.predicateError })
  }
  if (countMatches(count, matches)) return
  throw SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    subject: state,
    key,
    expected: { count, kind: 'set', specification },
    receivedText: receivedText(matches),
    listed
  }, stackStart)
}

export type DeferredAssertion = {
  error: () => SubstituteException
  settled: boolean
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

/** Stops a deferred property assertion from being thrown (the access turned out to be a method assertion). */
export const settle = (deferred: DeferredAssertion | undefined): void => {
  if (deferred !== undefined) deferred.settled = true
}

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
export const assertPropertyRead = (state: SubstituteState, key: PropertyKey, count: ExpectedCount, stackStart?: Function): DeferredAssertion | undefined => {
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
      key,
      expected: { count, kind: 'unknown' },
      receivedText: `${calls} ${plural('method call', calls)}`,
      explanation: `${keyToString(key)} was called ${times(calls)} as a method; ` +
        `to assert calls, invoke it: ${asExpression(state)}.didNotReceive()${memberAccess(key)}(...)`,
      listed: records.map((record: CallRecord) => ({ record, matches: false }))
    }))
    return undefined
  }
  if (count === undefined && calls > 0) return undefined

  const deferrable = calls > 0 && count !== undefined && (count <= calls || reads === 0)
  // D36: a member that was only read, with a count above the reads, fails as a property assertion and as a method
  // assertion (no calls at all), and it is not known yet which one this is.
  const onlyReadTooFew = calls === 0 && reads > 0 && count !== undefined && count > reads
  // A deferred failure is only thrown when the member was not invoked, so it is a property assertion.
  // An immediate failure fails for both readings; the kind is only named when the records show it.
  const kind: ExpectedKind = deferrable || (calls === 0 && reads > 0 && !onlyReadTooFew) ? 'property' : 'unknown'
  const createError = (start?: Function) => SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    subject: state,
    key,
    expected: { count, kind },
    receivedText: kind === 'property' ? (reads === 0 ? 'none' : reads.toString()) : describeReceived(reads, calls),
    explanation: deferrable && reads === 0 ? onlyInvokedExplanation(state, key, calls, count!) : undefined,
    listed: records.map((record: CallRecord) => ({ record, matches: record.kind === 'get' && !onlyReadTooFew })),
    hints: reads === 0 ? undefined
      : count === 0 && calls === 0 ? [onlyReadHint(state, key, reads)]
        // read but never invoked, or invoked as well: most likely a method, with fewer calls than expected
        : onlyReadTooFew || (calls > 0 && count !== undefined && calls < count) ? [readWithoutCallHint(state, key, reads)]
          : undefined
  }, start)

  if (!deferrable) throw createError(stackStart)
  return defer(stackStart, createError)
}

/**
 * The deferred report scheduled last (see cancelDeferredReportOf), and the stack captured where its check was written:
 * where the member of a property-style check was read (D9, D33), or (E56) where a check view that nothing has followed
 * yet was created (E48).
 */
let latestDeferred: { deferred: DeferredAssertion, site: StackHolder } | undefined

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
  if (latest === undefined || latest.deferred.settled) return
  const read = frameOfStack(latest.site)
  const matcher = currentFrame(matcherStart)
  if (read === null || matcher === null || !sameExpression(read, matcher)) return
  if (typeof read.line !== 'number' || read.line !== matcher.line ||
    typeof read.column !== 'number' || typeof matcher.column !== 'number' || matcher.column <= read.column) return
  settle(latest.deferred)
  latestDeferred = undefined
}

/**
 * Schedules a failure that is only reported if the assertion is not invoked (see assertPropertyRead).
 * The message is only built if the failure is really reported (usually the member is invoked right away).
 */
const defer = (stackStart: Function | undefined, createError: () => SubstituteException): DeferredAssertion => {
  const site: StackHolder = {}
  if (typeof Error.captureStackTrace === 'function' && stackStart !== undefined) Error.captureStackTrace(site, stackStart)
  const deferred: DeferredAssertion = {
    settled: false,
    error: () => {
      const error = createError()
      // (as text: its call sites may have been read, see cancelDeferredReportOf)
      const stack = stackText(site)
      const frames = typeof stack === 'string' ? stack.split('\n').slice(1).join('\n') : ''
      if (frames !== '') error.stack = `${error.name}: ${error.message}\n${frames}`
      return error
    }
  }
  deferredReports.schedule(() => {
    if (latestDeferred?.deferred === deferred) latestDeferred = undefined
    if (deferred.settled) return
    deferred.settled = true
    throw deferred.error()
  })
  latestDeferred = { deferred, site }
  return deferred
}

// ---- E48: a check view with nothing after it ----------------------------------------------------------------------

/** How a check view was written: with the exported symbols (`sub[received](2)`) or with the string names (`sub.received(2)`). */
export type CheckForm = 'symbol' | 'string'

/**
 * E48: the usage error of a check view that nothing followed (`next.didNotReceive()`, `sub[received](2)` as a
 * statement): it checks nothing. It names the substitute and shows the complete forms.
 */
const danglingCheckError = (state: SubstituteState, form: CheckForm, count: ExpectedCount): SubstituteException => {
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
 * E48: schedules the usage error of a check view that is created now (`site`: where), thrown from a microtask (as D9)
 * unless the view is used before (settle the result): a member access, an assignment, a call or `new` on it. For the
 * string forms, `applies` is asked at that time: the type may have a member of that name of its own.
 * E56: it is the report scheduled last, too, so that a matcher usage error in the view's own arguments cancels it (see
 * cancelDeferredReportOf).
 */
export const deferDanglingCheck = (state: SubstituteState, form: CheckForm, count: ExpectedCount, site: StackHolder, applies?: () => boolean): DeferredAssertion => {
  const deferred: DeferredAssertion = {
    settled: false,
    error: () => {
      const error = danglingCheckError(state, form, count)
      const stack = stackText(site)
      const frames = typeof stack === 'string' ? stack.split('\n').slice(1).join('\n') : ''
      error.stack = frames !== '' ? `${error.name}: ${error.message}\n${frames}` : `${error.name}: ${error.message}`
      return error
    }
  }
  deferredReports.schedule(() => {
    if (latestDeferred?.deferred === deferred) latestDeferred = undefined
    if (deferred.settled) return
    deferred.settled = true
    if (applies === undefined || applies()) throw deferred.error()
  })
  latestDeferred = { deferred, site }
  return deferred
}

/** What was received, for a failure that does not know yet whether it is about reads or calls. */
const describeReceived = (reads: number, calls: number): string => {
  if (reads === 0 && calls === 0) return 'none'
  const readsText = `${reads} ${plural('property read', reads)}`
  if (calls === 0) return `${readsText} and no method calls`
  return `${readsText} and ${calls} ${plural('method call', calls)}`
}
