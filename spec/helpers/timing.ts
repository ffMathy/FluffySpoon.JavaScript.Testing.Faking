import type { ExecutionContext } from 'ava'

/*
 * E43: timing tests that hold up on a busy machine. The tests with performance limits compare elapsed times with absolute
 * limits (`10,000 calls well under 1 s`). They run on their own, one at a time (E29, ava.perf.config.js), but other
 * processes on the machine still slow them down: at a load average of 12 on 4 cores, a test gets about a third of a
 * core, and a test that takes 0.3 s on an idle machine takes more than 1 s.
 * So each absolute limit is scaled by a load factor, measured in the same process right before the measurement: the time
 * of a fixed CPU-bound workload (allocation, property reads, Map and string work, stack captures, as the library does),
 * divided by its time on an idle machine, clamped to [1, MAX_FACTOR]. A busy machine slows the workload as much as the
 * test, so the limit grows with it; an algorithmic regression (a quadratic blow-up costs 10 to 1,000 times more) still
 * fails, as no limit grows by more than MAX_FACTOR. A measurement that exceeds its limit is judged once more against the
 * larger of that factor and one measured right after it, as the load may have risen during the measurement.
 */

/** The largest factor by which a limit is scaled. */
export const MAX_FACTOR = 4

/**
 * The time of one run of the workload on an idle machine, in milliseconds, as loadFactor measures it in a fresh process
 * (the median of five runs right after one warm-up run): 9 to 13 ms on Node.js 22, 24 and 26 on the 4-core machine the
 * limits were set on, and 5 to 7 ms once the process has run it a few times. So an idle machine gives a factor of 1
 * to 1.5.
 */
export const IDLE_WORKLOAD_MS = 9

const now = (): number => Number(process.hrtime.bigint()) / 1e6

/** The fixed workload: about as much allocation, property access, Map, string and stack work as the library's hot path. */
const workload = (): number => {
  const map = new Map<string, { id: number, name: string, tags: number[] }>()
  const holder: { stack?: string } = {}
  let hash = 0
  for (let index = 0; index < 16000; index++) {
    const record = { id: index, name: `n${index}`, tags: [index, index + 1] }
    map.set(record.name, record)
    hash = (Math.imul(hash, 31) + record.name.length + record.tags[1]) | 0
    if (index % 16 === 0) Error.captureStackTrace(holder, workload)
  }
  for (const [key, value] of map) hash ^= key.charCodeAt(1) + value.id
  return hash
}

let sink = 0
/** One run of the workload, in milliseconds. */
const workloadMilliseconds = (): number => {
  const start = now()
  sink ^= workload()
  return now() - start
}

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

/** The load factor now: the median time of five runs of the workload against IDLE_WORKLOAD_MS, clamped to [1, MAX_FACTOR]. */
export const loadFactor = (): number => {
  workloadMilliseconds() // optimized from the second run on
  const runs = [workloadMilliseconds(), workloadMilliseconds(), workloadMilliseconds(), workloadMilliseconds(), workloadMilliseconds()]
  const factor = median(runs) / IDLE_WORKLOAD_MS
  return Math.min(MAX_FACTOR, Math.max(1, factor))
}

/** An absolute limit in milliseconds, scaled by the load factor measured when it was made (see above). */
export class TimeLimit {
  constructor(readonly base: number, readonly factor: number) { }

  get milliseconds(): number {
    return this.base * this.factor
  }

  toString(): string {
    return `limit ${Math.round(this.milliseconds)} ms = ${this.base} ms x load factor ${this.factor.toFixed(2)}`
  }
}

/** The limit `milliseconds`, scaled by the load factor measured now: make it right before the measurement. */
export const timeLimit = (milliseconds: number): TimeLimit => new TimeLimit(milliseconds, loadFactor())

/**
 * Checks that `elapsed` (milliseconds) is within `limit`. When it is not, the load factor is measured once more, and the
 * larger of the two factors decides (never more than MAX_FACTOR).
 */
export const assertWithin = (t: ExecutionContext, elapsed: number, limit: TimeLimit, label: string): void => {
  let judged = limit
  if (elapsed >= limit.milliseconds) {
    const after = loadFactor()
    if (after > limit.factor) judged = new TimeLimit(limit.base, after)
  }
  t.true(elapsed < judged.milliseconds, `${label}: ${elapsed.toFixed(1)} ms (${judged})`)
}

/** The time `run` takes, in milliseconds. */
export const millisecondsOf = (run: () => void): number => {
  const start = now()
  run()
  return now() - start
}

/**
 * Measures `run` (the best of `runs` runs) right after the load factor, and checks it against `milliseconds` scaled by
 * that factor (see assertWithin). Returns the time.
 */
export const assertFast = (t: ExecutionContext, milliseconds: number, label: string, run: () => void, runs = 3): number => {
  const limit = timeLimit(milliseconds)
  let best = Infinity
  for (let index = 0; index < runs; index++) best = Math.min(best, millisecondsOf(run))
  assertWithin(t, best, limit, label)
  return best
}

/** For the workload's result, so that it is not optimized away. */
export const workloadSink = (): number => sink
