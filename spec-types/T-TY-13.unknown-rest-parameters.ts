// T:TY-13 Methods declared with `(...args: unknown[])` keep the substitute typing.
import { Substitute, Arg } from '../src'

interface Logger {
  format(...args: unknown[]): string
  formatAny(...args: any[]): string
  log(message: string, ...rest: unknown[]): void
  anything(...args: unknown[]): unknown
}
const logger = Substitute.for<Logger>()
logger.format('a', 1).returns('a 1')
logger.format(Arg.all()).mimicks((...args: unknown[]) => args.join(' '))
logger.formatAny('a', 1).returns('a 1')
logger.log('x', 1, 2).returns()
logger.anything(1).returns(2)
logger.received().format('a', 1)

// @ts-expect-error the configured value must be a string
logger.format('a', 1).returns(1)
