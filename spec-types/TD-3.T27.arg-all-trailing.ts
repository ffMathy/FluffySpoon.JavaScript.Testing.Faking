// TD-3 / T27 `Arg.all()` type-checks in any trailing position (D14): after leading arguments it matches the rest of
// the arguments. It replaces the parameter at its position (required, optional or rest), up to the 7th parameter.
import { Substitute, Arg, configure, received } from '../src'

interface Calculator { add(a: number, b: number): number }
interface Logger {
  log(message: string, ...details: string[]): void
  find(id: string, options?: { deep: boolean }): string
  record(a: number, b: string, c: boolean, d: number, e: string, f: number, g: boolean): void
}
interface Store {
  get(): string[]
  get(key: string): string
  set(key: string, value: string): void
  set(entries: Record<string, string>): void
}

const calculator = Substitute.for<Calculator>()
calculator.add(1, Arg.all()).returns(3)
calculator.add(Arg.any(), Arg.all()).returns(3)
calculator.add(Arg.is(a => a > 0), Arg.all()).mimicks((a, b) => a + b)
calculator.received().add(1, Arg.all())
calculator.didNotReceive().add(2, Arg.all())
calculator[received](1).add(1, Arg.all())
calculator[configure]().add(1, Arg.all()).returns(3)

const logger = Substitute.for<Logger>()
logger.received().log('saved', Arg.all())
logger.log('saved', 'a', Arg.all()).returns()
logger.log('saved', 'a', 'b', 'c', 'd', 'e', Arg.all()).returns()
logger.find('1', Arg.all()).returns('x')
logger.received().find('1', Arg.all())
logger.record(1, 'b', true, Arg.all()).returns()
logger.record(1, 'b', true, 4, 'e', 6, Arg.all()).returns()

const store = Substitute.for<Store>()
store.set('k', Arg.all()).returns()
store.received().set('k', Arg.all())
store.get(Arg.all()).returns(['a'])

// @ts-expect-error the leading arguments keep their types
calculator.add('1', Arg.all())
// @ts-expect-error nothing may follow Arg.all()
calculator.add(Arg.all(), 2)
// @ts-expect-error Calculator.add has no parameter at that position
calculator.add(1, 2, Arg.all())
// @ts-expect-error the configured value keeps its type
calculator.add(1, Arg.all()).returns('3')
// @ts-expect-error the leading arguments keep their types
logger.received().log(1, Arg.all())
