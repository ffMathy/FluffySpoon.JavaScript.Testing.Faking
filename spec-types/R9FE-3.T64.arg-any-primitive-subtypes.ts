// R9FE-3 / T64, reverted by T66 (R11TD-1): `Arg.any('string')` (and 'number', 'boolean', 'symbol', 'bigint') is typed
// as its primitive type, as at 4b1fa69, so it does NOT fit a parameter whose type is a strict subtype of that primitive
// type: a union of string literals, a string enum, a branded string, a union of number literals, `true`. (Typed by the
// parameter, it would fit the first overload with such a parameter, and lib.dom lookups, Node's `on` overloads and keyed
// getters would resolve to the wrong overload: R11TD-1.T66.arg-any-overloads.ts.) This file pins the limitation and
// the documented workarounds: `Arg.is((c: Currency) => true)` or `Arg.any('string') as Currency`.
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
// The limitation: a type matcher does not fit a parameter of a strict subtype of its type.
// @ts-expect-error a currency parameter takes only 'EUR' or 'USD' (T66)
payments.charge(Arg.any('string'), Arg.any('number')).returns('ok')
// @ts-expect-error likewise in a check (T66)
payments.received(1).charge(Arg.any('string'), 100)
// @ts-expect-error likewise in a symbol-form check (T66)
payments[received](1).charge(Arg.any('string'), Arg.any())
// @ts-expect-error likewise in the configure view (T66)
payments[configure]().charge(Arg.any('string'), 100).returns('ok')
// @ts-expect-error a string enum (T66)
payments.setStatus(Arg.any('string')).returns()
// @ts-expect-error a branded string (T66)
payments.load(Arg.any('string')).returns('x')
// @ts-expect-error a branded number (T66)
payments.pay(Arg.any('number')).returns()
// @ts-expect-error a union of number literals (T66)
payments.retry(Arg.any('number')).returns()
// @ts-expect-error `true` (T66)
payments[configure]().flag(Arg.any('boolean')).returns()
// @ts-expect-error `true`, in a check (T66)
payments.received().flag(Arg.any('boolean'))
// @ts-expect-error a union of literals of both types (T66)
payments.mixed(Arg.any('string')).returns()
// @ts-expect-error a union of literals of both types (T66)
payments.mixed(Arg.any('number')).returns()
// @ts-expect-error nested in an object (T66)
payments.options({ currency: Arg.any('string') }).returns()

// The workarounds: an annotated predicate, or a type assertion to the parameter's type.
payments.charge(Arg.is((c: Currency) => true), Arg.any('number')).returns('ok')
payments.charge(Arg.any('string') as Currency, Arg.any('number')).returns('ok')
payments.received(1).charge(Arg.is((c: Currency) => true), 100)
payments.received(1).charge(Arg.any('string') as Currency, 100)
payments[received](1).charge(Arg.any('string') as Currency, Arg.any())
payments[configure]().charge(Arg.any('string') as Currency, 100).returns('ok')
payments[configure]().charge(Arg.is((c: Currency) => true), 100).returns('ok')
payments.setStatus(Arg.any('string') as Status).returns()
payments.setStatus(Arg.is((s: Status) => s !== Status.Paid)).returns()
// (A branded type is not comparable with the matcher's type, so a type assertion needs `unknown` in between; the
// predicate is simpler.)
payments.load(Arg.is((id: OrderId) => true)).returns('x')
payments.load(Arg.any('string') as unknown as OrderId).returns('x')
payments.pay(Arg.is((amount: Cents) => amount > 0)).returns()
payments.retry(Arg.is((times: 1 | 2 | 3) => times > 1)).returns()
payments[configure]().flag(Arg.any('boolean') as true).returns()
payments.received().flag(Arg.any('boolean') as true)
payments.mixed(Arg.any('string') as 'a' | 'b').returns()
payments.options({ currency: Arg.any('string') as Currency }).returns()
// A type matcher of a parameter's own primitive type (or of a part of a union with it) fits as before. A number fits a
// numeric enum, as any number does.
payments.lookup(Arg.any('string')).returns('x')
payments.lookup(Arg.any('number')).returns('x')
payments.setPriority(Arg.any('number')).returns()
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
payments.charge(Arg.any('string') as Currency, 1).returns(1)
// @ts-expect-error a type assertion to an unrelated type is still refused
payments.charge(Arg.any('number') as Currency, 1)

// Generic methods and unions likewise.
interface Config { port: number; host: string }
interface Settings { get<K extends keyof Config>(key: K): Config[K] }
const settings = Substitute.for<Settings>()
settings.get(Arg.any('string') as keyof Config).returns(1)
// @ts-expect-error a key of Config is a string
settings.get(Arg.any('number'))

interface Eur { kind: 'eur'; pay(currency: 'EUR', cents: number): 'eur' }
interface Usd { kind: 'usd'; pay(currency: 'USD', cents: number): 'usd' }
const wallet = Substitute.for<Eur | Usd>()
// @ts-expect-error each variant's currency is a single string literal (T66)
wallet.pay(Arg.any('string'), 1).returns('eur')
wallet.pay(Arg.any('string') as 'EUR', 1).returns('eur')
wallet.pay(Arg.is((currency: 'EUR') => true), 1).returns('eur')
// @ts-expect-error the currency is a string
wallet.pay(Arg.any('number'), 1)
