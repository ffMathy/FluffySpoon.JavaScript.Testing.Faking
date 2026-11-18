// R11FE-4 / T69 Limitation (pinned): a generic method whose type parameter has a default (pino's `child<ChildCustomLevels
// extends string = never>(bindings): Logger<CustomLevels | ChildCustomLevels>`) is typed with the type parameter
// replaced by its CONSTRAINT, as for every generic method (T46): `.returns()` takes `Logger<string>`, and a value of the
// type the method returns with the default applied (`Logger<never>`, which is `Logger`) does not compile. The default
// cannot be read at the type level (TypeScript gives the constraint), and accepting any value that some instantiation
// of the method could return would let wrong values through (T54). Workarounds: substitute the type with the
// constraint applied (`Substitute.for<Logger<string>>()`), or cast the value (`child as unknown as Logger<string>`).
import { Arg, Substitute, configure } from '../src'

interface Base { info(msg: string): void }
type Lg<L extends string = never> = Base & { [k in L]: (msg: string) => void } &
  { child<C extends string = never>(bindings: object): Lg<L | C> }
const logger = Substitute.for<Lg>()
const childLogger = Substitute.for<Lg>()
// @ts-expect-error `child` is typed as returning Lg<string> (the constraint), which Lg<never> is not (T69)
logger.child(Arg.any()).returns(childLogger)
// @ts-expect-error likewise with literal arguments
logger.child({ module: 'auth' }).returns(childLogger)
// @ts-expect-error likewise in the configure view
logger[configure]().child(Arg.any()).returns(childLogger)
// The workarounds.
const wideChild = Substitute.for<Lg<string>>()
logger.child(Arg.any()).returns(wideChild)
logger[configure]().child(Arg.any()).returns(wideChild)
logger.child(Arg.any()).returns(childLogger as unknown as Lg<string>)
const wideLogger = Substitute.for<Lg<string>>()
wideLogger.child({ module: 'auth' }).returns(wideChild)
// Checks are not affected.
logger.received(1).child(Arg.any())
logger.received(1).info('started')
// @ts-expect-error a value no instantiation of `child` returns
logger.child(Arg.any()).returns(5)

// A type parameter with a default and no constraint takes `unknown`.
interface Repo { find<T = string>(id: number): T }
const repo = Substitute.for<Repo>()
repo.find(1).returns('x')
repo.find(1).returns(42)
