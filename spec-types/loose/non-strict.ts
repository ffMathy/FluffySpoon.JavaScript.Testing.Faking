// The typings must also work without `strict` (no strictNullChecks, no strictFunctionTypes), as in spec/tsconfig.json.
import { Substitute, SubstituteOf, Arg, received, returns, configure, mimick } from '../../src'

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
// R13TD-4 / T74 without strictNullChecks: in generic code a substitute of `T | undefined` / `T | null` mimicks a `T`.
export function delegateOptional<T>(sub: SubstituteOf<T | undefined>, instance: T) {
  sub[mimick](instance)
}
export function delegateNullable<T>(sub: SubstituteOf<T | null>, instance: T | null) {
  sub[mimick](instance)
}
// R14FE-3 / T75 without strictNullChecks: an Arg.is() predicate may return any truthy value, but not a promise.
interface Member { name?: string; roles: string[] }
interface Members { save(member: Member): string }
const members = Substitute.for<Members>()
members.save(Arg.is(member => member.name)).returns('named')
members.save(Arg.is(member => member.roles.length)).returns('with roles')
members.received(1).save(Arg.is(member => member.name?.startsWith('a')))
// @ts-expect-error an async predicate
members.save(Arg.is(async member => member.name === 'ann')).returns('x')
// @ts-expect-error a thenable
members.received(1).save(Arg.is(member => ({ then(resolve: (matches: boolean) => void) { resolve(true) } })))
// R17TD-1 / T82 without strictFunctionTypes: after `Arg.all()` on overloads, a value typed as a union of implementations
// fits `.mimicks()` only when each one does, as when it is assigned to the member itself.
interface Row { id: number }
interface Rows { remove(rows: Row[]): Promise<Row[]>; remove(row: Row): Promise<Row> }
const rows = Substitute.for<Rows>()
const takesEveryCall = (...args: any[]) => Promise.resolve({ id: 1 })
declare const fits: typeof takesEveryCall | ((row: any) => Promise<Row>)
rows.remove(Arg.all()).mimicks(fits)
interface Keys { get(): string[]; get(key: string): string }
const keys = Substitute.for<Keys>()
declare const takesAKey: (() => string[]) | ((key: string) => string)
// @ts-expect-error get() passes no key
keys.get(Arg.all()).mimicks(takesAKey)
// @ts-expect-error the same for a function assigned to the member
const plainKeys: Keys['get'] = takesAKey
