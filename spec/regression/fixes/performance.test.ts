import test, { ExecutionContext } from 'ava'

import { Substitute, Arg, configure } from '../../../src'
import { assertFast, assertRatiosWithin, assertWithin, timeLimit } from '../../helpers/timing'

interface Logger { log(message: string): void, level: number }
interface Calculator { add(a: number, b: number): number }

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}

test('R:RT-8 / D19 calls and configured reads do not scan earlier calls (10k calls + 10k configured reads < 1s)', t => {
  const logger = Substitute.for<Logger>()
  logger.level.returns(1)

  const elapsedLimit = timeLimit(1000)
  const elapsed = millisecondsOf(() => {
    for (let i = 0; i < 10_000; i++) logger.log('x')
    for (let i = 0; i < 10_000; i++) void logger.level
    logger.received(10_000).log('x')
    logger.received(10_000).level
  })
  assertWithin(t, elapsed, elapsedLimit, '10,000 calls and configured reads, and their checks')
})

test('R:RT-8 / D19 resolving configured calls with distinct arguments stays fast (10k calls < 1s)', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(Arg.any(), Arg.any()).returns(3)
  const elapsedLimit = timeLimit(1000)
  const elapsed = millisecondsOf(() => {
    for (let i = 0; i < 10_000; i++) calculator.add(i, i)
    calculator.received(10_000).add(Arg.all())
  })
  assertWithin(t, elapsed, elapsedLimit, '10,000 configured calls with distinct arguments, and their check')
})

/**
 * The best of three runs, so that a run slowed down by other processes or by a garbage collection does not count.
 * `run` sets up its own substitute, so every run starts from scratch.
 */
const bestOfThree = (run: () => void) => Math.min(millisecondsOf(run), millisecondsOf(run), millisecondsOf(run))

/**
 * Compares a run of `small` operations with a run of 16 times as many. Linear growth makes the large run about
 * 16 times slower, quadratic growth up to 256 times. The bound of 48 leaves three times the linear ratio for
 * noise, and fails once the quadratic part dominates the large run: scanning every earlier call on each call
 * gives a ratio of about 150 (2000 calls: 16 ms, 32000 calls: 2.4 s).
 * E29: the small and the large run by turns, in both orders, and the median of the ratios of five rounds, so that a
 * busy machine slows both sides of each ratio alike and a round that it slowed on one side does not count.
 */
const growthOf = (small: number, run: (count: number) => void) => {
  run(small) // warm up
  const ratios: number[] = []
  const rounds: string[] = []
  for (let round = 0; round < 5; round++) {
    const smallFirst = round % 2 === 0
    const first = millisecondsOf(() => run(smallFirst ? small : small * 16))
    const second = millisecondsOf(() => run(smallFirst ? small * 16 : small))
    const [smallTime, largeTime] = smallFirst ? [first, second] : [second, first]
    ratios.push(largeTime / Math.max(smallTime, 2))
    rounds.push(`${smallTime.toFixed(1)} / ${largeTime.toFixed(1)} ms`)
  }
  const ratio = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)]
  return { grows: ratio >= 48, report: `${small} vs ${small * 16} operations: ${ratio.toFixed(1)}x (rounds: ${rounds.join(', ')})` }
}

test('R:RT-8 / D19 the cost of a call does not grow with the number of earlier calls', t => {
  const { grows, report } = growthOf(2_000, count => {
    const logger = Substitute.for<Logger>()
    for (let i = 0; i < count; i++) logger.log('x')
  })
  t.false(grows, report)
})

const literalSetupsAndCalls = (count: number) => {
  const calculator = Substitute.for<any>()
  for (let i = 0; i < count; i++) calculator.add(i, 1).returns(i)
  for (let i = 0; i < count; i++) if (calculator.add(i, 1) !== i) throw new Error(`add(${i}, 1) did not return ${i}`)
}

/** The same through configure(), on a fresh substitute that also has matcher setups (returned, to check those). */
const configuredSetupsAndCalls = (count: number): any => {
  const calculator = Substitute.for<any>()
  calculator.add(Arg.all()).returns(-1)
  calculator.add(Arg.any(), 0).returns(-2)
  for (let i = 0; i < count; i++) calculator[configure]().add(i, 1).returns(i)
  for (let i = 0; i < count; i++) if (calculator.add(i, 1) !== i) throw new Error(`add(${i}, 1) did not return ${i}`)
  return calculator
}

/**
 * E94 (R14V-2): how both halves of the test below are measured: after a warm-up with 1,000, the best of three runs of
 * `run(count)`, each on a fresh substitute, so that one run stalled by the scheduler of a busy machine does not decide
 * (a single measurement of the configure() half once took 40 times its usual time at a load average of 16 on 4 cores).
 * Checks it against 1 s, scaled by the load factor measured right before. Returns the time.
 */
const bestRunWithin = (t: ExecutionContext, label: string, run: (count: number) => void, count = 8_000): number => {
  run(1_000) // warm up
  const limit = timeLimit(1000)
  const elapsed = bestOfThree(() => run(count))
  assertWithin(t, elapsed, limit, label)
  return elapsed
}

test('R:RT-8 / D19 8000 literal setups and 8000 matching calls finish in under 1s (literal substitutions are indexed)', t => {
  bestRunWithin(t, '8,000 literal setups and 8,000 matching calls', literalSetupsAndCalls)

  // the same through configure(), on a substitute that also has matcher setups
  let calculator: any
  bestRunWithin(t, '8,000 literal setups and calls through configure()', count => { calculator = configuredSetupsAndCalls(count) })
  t.is(calculator.add(1, 0), -2)
  t.is(calculator.add(1, 2), -1)

  const { grows, report } = growthOf(1_000, literalSetupsAndCalls)
  t.false(grows, report)
})

test('R14V-2 (E94) both halves of the R:RT-8 setup test are the best of three fresh runs: one stalled run does not decide', t => {
  const stall = 300
  let runs = 0
  let stalledRun = 0
  const elapsed = bestRunWithin(t, '1,000 literal setups and calls through configure(), the first measured run stalled', count => {
    runs++
    const run = millisecondsOf(() => {
      configuredSetupsAndCalls(count)
      if (runs === 2) for (const until = Date.now() + stall; Date.now() < until;) { /* the stall */ }
    })
    if (runs === 2) stalledRun = run
  }, 1_000)
  t.is(runs, 4, 'a warm-up and three measured runs')
  t.true(stalledRun >= stall, `${stalledRun.toFixed(1)} ms`)
  t.true(elapsed < stalledRun, `best of three: ${elapsed.toFixed(1)} ms, the stalled run: ${stalledRun.toFixed(1)} ms`)
})

const throws = (check: () => void): void => {
  try {
    check()
  } catch {
    return
  }
  throw new Error('the check passed, but it should have failed')
}

test('R14FE-5 (E97) the search for calls further down a fluent chain is bounded, and passing checks do not search', t => {
  // a chain deeper, and a tree of auto-substitutes wider, than the search goes, where the checked member was never
  // called: every failing check searches as far as it can
  let deep = Substitute.for<any>()
  const chain = deep
  for (let i = 0; i < 20_000; i++) deep = deep.next(i)
  const api = Substitute.for<any>()
  for (let i = 0; i < 50_000; i++) api.get(i).then
  throws(() => chain.received().end()) // warm up
  throws(() => api.received().json())
  assertFast(t, 1000, '50 failing checks on a 20,000-step chain and 50 on 50,000 auto-substitutes', () => {
    for (let i = 0; i < 50; i++) {
      throws(() => chain.received().end())
      throws(() => api.received().json())
    }
  })

  // a passing check costs the same with such a tree as without it
  const flat = Substitute.for<any>()
  flat.ping()
  api.ping()
  assertRatiosWithin(t, () => {
    const rounds: number[] = []
    for (let round = 0; round < 5; round++) {
      const without = millisecondsOf(() => { for (let i = 0; i < 5_000; i++) flat.received(1).ping() })
      const withTree = millisecondsOf(() => { for (let i = 0; i < 5_000; i++) api.received(1).ping() })
      rounds.push(withTree / Math.max(without, 0.5))
    }
    return { 'with a tree': [...rounds].sort((a, b) => a - b)[2] }
  }, 1.5, '5,000 passing checks of a substitute with 50,000 auto-substitutes, against one without')
})
