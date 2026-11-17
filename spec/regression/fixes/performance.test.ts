import test from 'ava'

import { Substitute, Arg, configure } from '../../../src'

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

  const elapsed = millisecondsOf(() => {
    for (let i = 0; i < 10_000; i++) logger.log('x')
    for (let i = 0; i < 10_000; i++) void logger.level
    logger.received(10_000).log('x')
    logger.received(10_000).level
  })
  t.true(elapsed < 1000, `took ${elapsed} ms`)
})

test('R:RT-8 / D19 resolving configured calls with distinct arguments stays fast (10k calls < 1s)', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(Arg.any(), Arg.any()).returns(3)
  const elapsed = millisecondsOf(() => {
    for (let i = 0; i < 10_000; i++) calculator.add(i, i)
    calculator.received(10_000).add(Arg.all())
  })
  t.true(elapsed < 1000, `took ${elapsed} ms`)
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

test('R:RT-8 / D19 8000 literal setups and 8000 matching calls finish in under 1s (literal substitutions are indexed)', t => {
  literalSetupsAndCalls(1_000) // warm up
  const elapsed = bestOfThree(() => literalSetupsAndCalls(8_000))
  t.true(elapsed < 1000, `took ${elapsed} ms`)

  // the same through configure(), on a substitute that also has matcher setups
  const calculator = Substitute.for<any>()
  calculator.add(Arg.all()).returns(-1)
  calculator.add(Arg.any(), 0).returns(-2)
  const configured = millisecondsOf(() => {
    for (let i = 0; i < 8_000; i++) calculator[configure]().add(i, 1).returns(i)
    for (let i = 0; i < 8_000; i++) if (calculator.add(i, 1) !== i) throw new Error(`add(${i}, 1) did not return ${i}`)
  })
  t.true(configured < 1000, `took ${configured} ms through configure()`)
  t.is(calculator.add(1, 0), -2)
  t.is(calculator.add(1, 2), -1)

  const { grows, report } = growthOf(1_000, literalSetupsAndCalls)
  t.false(grows, report)
})
