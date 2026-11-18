// R9FE-3 / T64 `Arg.any('string')` (and 'number', 'boolean', 'symbol', 'bigint') fits a parameter whose type is a
// subtype of that primitive type: a union of string literals, a string or numeric enum, a branded string, a union of
// number literals. It still does not fit a parameter that takes no value of that type.
import { Arg, Substitute, configure, received } from '../src'

type Currency = 'EUR' | 'USD'
enum Status { Open = 'open', Paid = 'paid' }
enum Priority { Low, High }
type OrderId = string & { readonly __brand: 'OrderId' }
type Cents = number & { readonly __brand: 'Cents' }
interface Payments {
  charge(currency: Currency, cents: number): string
  setStatus(status: Status): void
  setPriority(priority: Priority): void
  load(id: OrderId): string
  pay(amount: Cents): void
  retry(times: 1 | 2 | 3): void
  flag(enabled: true): void
  lookup(key: string | number): string
  mixed(value: 'a' | 'b' | 5): void
  tag(names: string[]): void
  options(o: { currency: Currency }): void
}
const payments = Substitute.for<Payments>()
payments.charge(Arg.any('string'), Arg.any('number')).returns('ok')
payments.received(1).charge(Arg.any('string'), 100)
payments[received](1).charge(Arg.any('string'), Arg.any())
payments[configure]().charge(Arg.any('string'), 100).returns('ok')
payments.setStatus(Arg.any('string')).returns()
payments.setPriority(Arg.any('number')).returns()
payments.load(Arg.any('string')).returns('x')
payments.pay(Arg.any('number')).returns()
payments.retry(Arg.any('number')).returns()
// (A direct call with a parameter typed `true` resolves to the method's own declaration, as `flag(true)` does: use the
// configure view to set it up.)
payments[configure]().flag(Arg.any('boolean')).returns()
payments.received().flag(Arg.any('boolean'))
payments.lookup(Arg.any('string')).returns('x')
payments.lookup(Arg.any('number')).returns('x')
payments.mixed(Arg.any('string')).returns()
payments.mixed(Arg.any('number')).returns()
payments.options({ currency: Arg.any('string') }).returns()
const anyString = Arg.any('string')
payments.lookup(anyString).returns('x')
// @ts-expect-error a number parameter does not take strings
payments.charge('EUR', Arg.any('string'))
// @ts-expect-error a currency is a string
payments.charge(Arg.any('number'), 1)
// @ts-expect-error a string enum is not a number
payments.setStatus(Arg.any('number'))
// @ts-expect-error a union of number literals is not a string
payments.retry(Arg.any('string'))
// @ts-expect-error `true` is not a string
payments.flag(Arg.any('string'))
// @ts-expect-error an array of strings is not a string
payments.tag(Arg.any('string'))
// @ts-expect-error nor a boolean
payments.mixed(Arg.any('boolean'))
// @ts-expect-error a matcher created on its own is a string matcher, which a currency parameter does not take
payments.charge(anyString, 1)
// @ts-expect-error what charge returns
payments.charge(Arg.any('string'), 1).returns(1)

// Generic methods and unions get the same.
interface Config { port: number; host: string }
interface Settings { get<K extends keyof Config>(key: K): Config[K] }
const settings = Substitute.for<Settings>()
settings.get(Arg.any('string')).returns(1)
// @ts-expect-error a key of Config is a string
settings.get(Arg.any('number'))

interface Eur { kind: 'eur'; pay(currency: 'EUR', cents: number): 'eur' }
interface Usd { kind: 'usd'; pay(currency: 'USD', cents: number): 'usd' }
const wallet = Substitute.for<Eur | Usd>()
wallet.pay(Arg.any('string'), 1).returns('eur')
// @ts-expect-error the currency is a string
wallet.pay(Arg.any('number'), 1)
