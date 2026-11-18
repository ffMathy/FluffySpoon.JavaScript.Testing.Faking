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
// R12FE-5 / T72: a partial instance, with its member types checked
calculator[mimick]({ add: (a, b) => a + b, isEnabled: true })
// @ts-expect-error isEnabled is a boolean
calculator[mimick]({ isEnabled: 'yes' })
// @ts-expect-error an object literal has no other members
calculator[mimick]({ subtract: (a: number, b: number) => a - b })
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

// R9FE-3 / T64, reverted by T66 (R11TD-1), without strictNullChecks: a type matcher has its primitive type, created on
// its own or passed to a parameter, so a parameter of a union of string literals needs the documented workarounds.
const matchesString: boolean = Arg.any('string').matches('foo')
const notNumber: boolean = Arg.any.not('number').matches(1)
type Currency = 'EUR' | 'USD'
interface Payments { charge(currency: Currency, cents: number): string }
const payments = Substitute.for<Payments>()
// @ts-expect-error a currency parameter takes only 'EUR' or 'USD' (T66)
payments.charge(Arg.any('string'), Arg.any('number')).returns('ok')
payments.charge(Arg.any('string') as Currency, Arg.any('number')).returns('ok')
payments.charge(Arg.is((c: Currency) => true), Arg.any('number')).returns('ok')
// R11TD-1 / T66 without strictNullChecks: overloads resolve as at 4b1fa69.
interface KeyedStore { get(key: 'count'): number; get(key: string): string | undefined }
const keyed = Substitute.for<KeyedStore>()
keyed.get(Arg.any('string')).returns('x')
const doc = Substitute.for<Document>()
doc.querySelector(Arg.any('string')).returns(Substitute.for<Element>())
