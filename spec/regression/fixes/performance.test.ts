import test from 'ava'

import { Substitute, Arg } from '../../../src'

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

test('R:RT-8 / D19 the cost of a call does not grow with the number of earlier calls', t => {
  const timeFor = (count: number) => {
    const logger = Substitute.for<Logger>()
    return millisecondsOf(() => {
      for (let i = 0; i < count; i++) logger.log('x')
    })
  }
  timeFor(2_000) // warm up
  const small = timeFor(4_000)
  const large = timeFor(16_000)
  // quadratic growth would make the large run about 16 times slower than the small one
  t.true(large < Math.max(small, 5) * 8, `4000 calls: ${small} ms, 16000 calls: ${large} ms`)
})
