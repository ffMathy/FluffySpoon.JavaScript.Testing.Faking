// Documented limitations of the typings (TypeScript cannot express these). Each `@ts-expect-error` line shows the
// limitation, the line after it a way around it.
import { Substitute, Arg, configure } from '../src'

// T:TY-6 Assigning a property directly on a substitute: the property's type carries the setup API (`.returns`, ...),
// and TypeScript uses the same type for reads and writes of a mapped property.
interface Calculator { isEnabled: boolean }
const calculator = Substitute.for<Calculator>()
// @ts-expect-error `true` lacks the setup API
calculator.isEnabled = true
const asCalculator: Calculator = calculator
asCalculator.isEnabled = true // as the code under test does it
calculator.received().isEnabled = true

// T:TY-9 `null` / `undefined` cannot carry the setup API, so they are not part of the type of a call or property read
// (strictNullChecks). The value is still assignable to the declared type.
interface UserRepo { find(id: number): string | null }
const repo = Substitute.for<UserRepo>()
repo.find(1).returns(null)
const found: string | null = repo.find(1)
declare function is<Actual, Expected extends Actual>(actual: Actual, expected: Expected): void // like ava's t.is
// @ts-expect-error `null` is not part of `string & setup API`
is(repo.find(1), null)
is<string | null, null>(repo.find(1), null)

// T:TY-15 Explicit type arguments on a generic method resolve to the interface's own declaration (TypeScript cannot
// carry a method's type parameters over to the substitute's signatures).
interface Repository { get<T>(id: string): T }
const repository = Substitute.for<Repository>()
repository.get('1').returns({ a: 1 })
// @ts-expect-error no setup API on the interface's own declaration
repository.get<number>('1').returns(1)
repository.get('1').returns(1)

// Overloads whose parameters are declared with literal types: see T-TY-11.many-overloads.ts.
interface Events { on(event: 'data', listener: () => void): this }
const events = Substitute.for<Events>()
// @ts-expect-error resolves to the interface's own declaration
events.on('data', Arg.any()).returns(events)
events[configure]().on('data', Arg.any()).returns(events)

export { found }
