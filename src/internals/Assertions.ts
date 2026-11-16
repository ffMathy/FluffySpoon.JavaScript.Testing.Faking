import { inspect } from 'util'

import { SubstituteState } from './SubstituteState'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException, ListedCall, ExpectedKind } from './SubstituteException'
import { CallRecord } from './CallRecord'
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

const schedule = (callback: () => void) => {
  // Looked up on every call so that fake timers (e.g. @sinonjs/fake-timers) can intercept it.
  if (typeof process !== 'undefined' && typeof process.nextTick === 'function') process.nextTick(callback)
  else setTimeout(callback, 0)
}

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
 *   whose message needs the arguments. The failure is scheduled on process.nextTick and cancelled as soon
 *   as the member is invoked; only a property-style assertion that is never invoked reports it there.
 *   For a member that was only invoked, the report says so and shows the method assertion to write instead.
 */
export const assertPropertyRead = (state: SubstituteState, key: PropertyKey, count: ExpectedCount, stackStart?: Function): DeferredAssertion | undefined => {
  const records = state.recordsFor(key).filter(record => record.kind !== 'set')
  let reads = 0
  let calls = 0
  for (const record of records) {
    if (record.kind === 'get') reads++
    else calls++
  }
  if (countMatches(count, reads)) return undefined
  if (count === undefined && calls > 0) return undefined

  const deferrable = calls > 0 && count !== undefined && (count <= calls || reads === 0)
  // A deferred failure is only thrown when the member was not invoked, so it is a property assertion.
  // An immediate failure fails for both readings; the kind is only named when the records show it.
  const kind: ExpectedKind = deferrable || (calls === 0 && reads > 0) ? 'property' : 'unknown'
  const createError = (start?: Function) => SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    key,
    expected: { count, kind },
    receivedText: kind === 'property' ? (reads === 0 ? 'none' : reads.toString()) : describeReceived(reads, calls),
    explanation: deferrable && reads === 0 ? onlyInvokedExplanation(state, key, calls, count!) : undefined,
    listed: records.map((record: CallRecord) => ({ record, matches: record.kind === 'get' })),
    hints: reads === 0 ? undefined
      : count === 0 && calls === 0 ? [onlyReadHint(state, key, reads)]
        // invoked as well, so most likely a method, with fewer calls than expected
        : calls > 0 && count !== undefined && calls < count ? [readWithoutCallHint(state, key, reads)]
          : undefined
  }, start)

  if (!deferrable) throw createError(stackStart)

  // The message is only built if the failure is really reported (usually the member is invoked right away).
  const site: { stack?: string } = {}
  if (typeof Error.captureStackTrace === 'function' && stackStart !== undefined) Error.captureStackTrace(site, stackStart)
  const deferred: DeferredAssertion = {
    settled: false,
    error: () => {
      const error = createError()
      const frames = typeof site.stack === 'string' ? site.stack.split('\n').slice(1).join('\n') : ''
      if (frames !== '') error.stack = `${error.name}: ${error.message}\n${frames}`
      return error
    }
  }
  schedule(() => {
    if (deferred.settled) return
    deferred.settled = true
    throw deferred.error()
  })
  return deferred
}

const describeReceived = (reads: number, calls: number): string => {
  if (reads === 0 && calls === 0) return 'none'
  if (calls === 0) return reads.toString()
  const readsText = `${reads} ${reads === 1 ? 'property read' : 'property reads'}`
  const callsText = `${calls} ${calls === 1 ? 'method call' : 'method calls'}`
  return `${readsText} and ${callsText}`
}
