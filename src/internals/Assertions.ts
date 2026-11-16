import { inspect } from 'util'

import { SubstituteState } from './SubstituteState'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException, ListedCall, ExpectedKind } from './SubstituteException'
import { CallRecord } from './CallRecord'

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

/** Method assertion: counts invocations whose arguments match. Property reads never count. */
export const assertCall = (state: SubstituteState, key: PropertyKey, args: any[], count: ExpectedCount, stackStart?: Function): void => {
  const specification = RecordedArguments.forSpecification(args)
  const records = state.recordsFor(key).filter(record => record.kind !== 'set')
  const listed: ListedCall[] = []
  let matches = 0
  for (const record of records) {
    if (record.kind !== 'call') {
      listed.push({ record, matches: false })
      continue
    }
    const match = specification.matchDetailed(record.args)
    if (match.matches) matches++
    listed.push({ record, matches: match.matches, predicateThrew: match.predicateThrew, predicateError: match.predicateError })
  }
  if (countMatches(count, matches)) return
  throw SubstituteException.forCallCountMismatch({
    substitutePath: state.path,
    key,
    expected: { count, kind: 'method', specification },
    receivedText: receivedText(matches),
    listed
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
    listed: records.map((record: CallRecord) => ({ record, matches: record.kind === 'get' }))
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
