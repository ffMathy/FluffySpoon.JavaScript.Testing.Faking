// T:TY-2 / G:RG-4 One rule for `.returns` vs `[returns]` (also throws, mimicks, resolves, rejects):
// the string form is offered unless the VALUE it is accessed on (the property type or the call's return type) has a
// member with that name. The symbol form is always offered. Whether the containing interface has such a member does
// not matter, and properties, methods without arguments and methods with arguments all behave the same.
import { Substitute, Arg, returns, throws, mimicks, resolves, rejects, configure } from '../src'
import { expectType } from './helpers'

// (A) the mocked interface has members named returns / throws / mimicks
interface Order {
  returns: string[]
  throws: boolean
  mimicks(): void
  id: string
  total(): number
  lineTotal(index: number): number
}
const order = Substitute.for<Order>()
order.lineTotal(0).returns(5)
order.total().returns(10)
order.id.returns('o-1')
order.lineTotal(0).throws(new Error())
order.total().throws(new Error())
order.id.throws(new Error())
order.lineTotal(0).mimicks(index => index * 2)
order.total().mimicks(() => 1)
order.id.mimicks(() => 'o-2')
order.lineTotal(0)[returns](5)
order.total()[returns](10)
order.id[returns]('o-1')
order.id[throws](new Error())
order.total()[mimicks](() => 1)
// the conflicting members themselves are ordinary members
order.returns.returns(['r-1'])
order.throws.returns(true)
order.mimicks().returns()

// (B) a member's VALUE type has members named returns / throws / mimicks
interface Shop {
  current: Order
  latest(): Order
  find(id: string): Order
  maybe(id: string): Order | undefined
  load(): Promise<Order>
}
const shop = Substitute.for<Shop>()
const o: Order = Substitute.for<Order>()
shop.find('1')[returns](o)
shop.latest()[returns](o)
shop.current[returns](o)
shop.maybe('1')[returns](o)
shop.maybe('1')[returns](undefined)
shop.find('1')[throws](new Error())
shop.latest()[mimicks](() => o)
shop.find(Arg.any())[mimicks](() => o)
// `.returns` / `.throws` / `.mimicks` are the Order's own members there
expectType<string[]>(shop.find('1').returns)
expectType<boolean>(shop.current.throws)
// @ts-expect-error not the setup method: Order's own `returns: string[]`
shop.find('1').returns(o)
// @ts-expect-error not the setup method: Order's own `returns: string[]`
shop.latest().returns(o)
// @ts-expect-error not the setup method: Order's own `returns: string[]`
shop.current.returns(o)
// @ts-expect-error not the setup method: Order's own `returns: string[]`
shop.maybe('1').returns(o)
// @ts-expect-error not the setup method: Order's own `mimicks(): void`
shop.find('1').mimicks(() => o)
// a Promise<Order> has no member named returns, so the string form is offered there
shop.load().returns(Promise.resolve(o))
shop.load().resolves(o)

// (C) resolves / rejects on a promise type that has members with those names
interface Deferred<T> extends Promise<T> {
  resolves: number
  rejects: number
}
interface Scheduler { next(): Deferred<string> }
const scheduler = Substitute.for<Scheduler>()
scheduler.next()[resolves]('done')
scheduler.next()[rejects](new Error())
scheduler.next().returns(value<Deferred<string>>())
// @ts-expect-error not the setup method: Deferred's own `resolves: number`
scheduler.next().resolves('done')

// The [configure]() view never returns the value itself, so the string forms are always offered there.
shop[configure]().find('1').returns(o)
shop[configure]().current.returns(o)
shop[configure]().latest().mimicks(() => o)

declare function value<T>(): T
