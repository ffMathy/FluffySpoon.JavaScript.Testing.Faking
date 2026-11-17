// Documented limitations of the typings (TypeScript cannot express these). Each `@ts-expect-error` line shows the
// limitation, the line after it a way around it.
import { Substitute, SubstituteOf, Arg, configure } from '../src'

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

// Assigning a function to a callable member in the assertion view: the member's type there also carries the
// `Arg.all()` call signatures, which a plain function does not have. Check the set through the type itself.
interface Button { onClick?: (event: string) => void }
const button = Substitute.for<Button>()
const handler = (event: string) => { }
// @ts-expect-error the assertion view's callable member type is not a plain function type
button.received().onClick = handler
;(button.received() as Button).onClick = handler

// Generic code: checking a set of a property whose type is the type parameter itself (`current: T`). Depending on the
// TypeScript version and the constraint, the assertion view does not accept a `T` there; check the set through the
// type itself (R3TD-1 / T33 covers members with concrete types).
interface Holder<T> { current: T }
export function checkCurrent<T>(holder: SubstituteOf<Holder<T>>, value: T) {
  ;(holder.received() as Holder<T>).current = value
}

// Generic code whose constraint is a union with a method whose return type differs per variant (T39 covers concrete
// unions): TypeScript computes the call from each variant of the constraint, and `.returns()` then only takes what
// every variant's return type accepts. Configure it through the constraint type itself.
interface Cat { kind: 'cat'; speak(): 'meow' }
interface Dog { kind: 'dog'; speak(): 'woof' }
export function stubPet<T extends Cat | Dog>(pet: SubstituteOf<T>) {
  // @ts-expect-error `.returns()` takes `'meow' & 'woof'`, i.e. `never`
  pet.speak().returns('meow')
  ;(pet as SubstituteOf<Cat | Dog>).speak().returns('meow')
}

// Concrete unions whose variants declare a method with different parameter lists (R5TD-1 / T42): the call results take
// the values of the variants whose overloads accept calls with the parameter list of the signature the call resolves
// to. The argument values themselves are not considered, so parameter types that only overlap (`'a' | 'b'` and
// `'b' | 'c'`) do not count. Configure such a call through the variant's type.
interface Lower { kind: 'lower'; letter(x: 'a' | 'b'): 'lower' }
interface Upper { kind: 'upper'; letter(x: 'b' | 'c'): 'upper' }
const letters = Substitute.for<Lower | Upper>()
// @ts-expect-error the call resolves to `letter(x: 'a' | 'b')`, which `letter(x: 'b' | 'c')` does not accept as a whole
letters.letter('b').returns('upper')
;(letters as SubstituteOf<Upper>).letter('b').returns('upper')

// In the same unions, `Arg.any()` and an `Arg.is()` predicate without a parameter type resolve to the first variant's
// overload that takes that many arguments, so when the variants' parameter types differ (R6TD-1 / T45), the call takes
// only the values of the variants that accept that overload's parameters. (A single `Arg.all()`, and `Arg.any()` where
// the variants' parameter types are the same, take every variant's values: R6TD-1.T45.union-call-arguments.ts.)
// Configure such a call with `Arg.all()`, with a typed matcher, or through the variant's type.
interface MatchA { kind: 'a'; m(x: string): 'A' }
interface MatchB { kind: 'b'; m(x: number): 'B' }
const matched = Substitute.for<MatchA | MatchB>()
// @ts-expect-error the call resolves to `m(x: string)`, which only MatchA declares
matched.m(Arg.any()).returns('B')
// @ts-expect-error the predicate's parameter is typed from `m(x: string)`
matched.m(Arg.is(x => x !== undefined)).returns('B')
matched.m(Arg.all()).returns('B')
matched.m(Arg.any('number')).returns('B')
;(matched as SubstituteOf<MatchB>).m(Arg.any()).returns('B')

// Generic methods (R6FE-7 / T46) are configured and checked with their type parameters replaced by their constraints
// (TypeScript cannot carry a method's type parameters over to the substitute's signatures). The arguments of a setup or
// check are then only checked against the constraints, and the configured value against what the method returns for
// them, so these compile although the methods themselves reject them. Configure the exact call through the method's
// own type where it matters.
interface Settings { port: number; host: string }
interface SettingsService { get<K extends keyof Settings>(key: K): Settings[K] }
const settings = Substitute.for<SettingsService>()
settings.get('port').returns('eighty') // `Settings[keyof Settings]` is `number | string`
interface SignalEvents { saved: (id: string) => void; failed: (error: Error) => void }
interface Signals { emit<E extends keyof SignalEvents>(event: E, ...args: Parameters<SignalEvents[E]>): boolean }
const signals = Substitute.for<Signals>()
signals.emit('failed', 'id1').returns(true) // the event and its arguments are not matched up
const asSettings: SettingsService = settings
// @ts-expect-error the method itself keeps its own signature
asSettings.get('port').toFixed(0).returns(1)

export { found }
