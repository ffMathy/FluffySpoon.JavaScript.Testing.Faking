// The typings must also work without `strict` (no strictNullChecks, no strictFunctionTypes), as in spec/tsconfig.json.
import { Substitute, Arg, received, returns, configure, mimick } from '../../src'

interface Calculator {
  add(a: number, b: number): number
  divide(a: number, b: number): number
  heavyOperation(...numbers: number[]): Promise<number>
  find(id: number): string | null
  isValid(input: string): boolean
  timeout?: number
  format?(value: number): string
  isEnabled: boolean
}
const calculator = Substitute.for<Calculator>()
calculator.add(1, 2).returns(3)
calculator.add(Arg.all()).mimicks((a, b) => a + b)
calculator.add(Arg.is(x => x > 1), Arg.any()).returns(1)
calculator.heavyOperation(1, 2).resolves(4)
calculator.find(1).returns(null)
calculator.isValid(Arg.any()).mimicks(input => input.length > 3)
calculator.timeout.returns(1)
calculator.format(1).returns('1')
calculator.isEnabled.returns(true)
calculator.received().add(1, 2)
calculator.received(2).isEnabled = true
calculator[received]().add(1, 2)
calculator[configure]().add(1, 2).returns(3)
calculator[mimick]({} as Calculator)
// without strictNullChecks every parameter accepts undefined, so Arg.any('undefined') fits everywhere (T38)
calculator.add(Arg.any('undefined'), 2).returns(3)
const asCalculator: Calculator = calculator

// overloads, including one without parameters
interface Store {
  get(): string[]
  get(key: string): string
  set(key: string, value: string): void
  set(entries: Record<string, string>): void
}
const store = Substitute.for<Store>()
store.get().returns(['a'])
store.get('k').returns('v')
store.get(Arg.is(k => k.startsWith('a'))).returns('v')
store.set('k', 'v').returns()
store.set({ k: 'v' }).throws(new Error())
store.received().set(Arg.all())

// value types with conflicting member names
interface Order { returns: string[]; total(): number }
interface Shop { find(id: string): Order }
const shop = Substitute.for<Shop>()
shop.find('1')[returns](Substitute.for<Order>())
// @ts-expect-error Order's own `returns` member
shop.find('1').returns(Substitute.for<Order>())

// @ts-expect-error the configured value must have the member's type
calculator.add(1, 2).returns('3')
// @ts-expect-error resolves() is only offered for promises
calculator.add(1, 2).resolves(3)

export { asCalculator }

// R9FE-3 / T64 without strictNullChecks: a type matcher created on its own keeps its primitive type (the missing
// parameter type is `undefined`, which is part of every type there), and one passed to a parameter takes its subtype.
const matchesString: boolean = Arg.any('string').matches('foo')
const notNumber: boolean = Arg.any.not('number').matches(1)
type Currency = 'EUR' | 'USD'
interface Payments { charge(currency: Currency, cents: number): string }
const payments = Substitute.for<Payments>()
payments.charge(Arg.any('string'), Arg.any('number')).returns('ok')
