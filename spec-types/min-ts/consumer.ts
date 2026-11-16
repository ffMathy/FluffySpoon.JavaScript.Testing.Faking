// A consumer of the BUILT package typings (dist/*.d.ts), type-checked with old TypeScript versions by
// `npm run test:types:min-ts`. Only plain code that must compile: no `@ts-expect-error` (TypeScript >= 3.9).
import Substitute, {
  Arg, SubstituteOf, SubstituteException,
  received, didNotReceive, clearReceivedCalls, configure, mimick, returns, throws, mimicks, resolves, rejects
} from '@fluffy-spoon/substitute'

enum Status { Active, Disabled }

interface Calculator {
  add(a: number, b: number): number
  divide(a: number, b: number): number
  heavyOperation(...numbers: number[]): Promise<number>
  isValid(input: string): boolean
  status(id: number): Status
  find(id: number): string | null
  reset(): void
  fail(message: string): never
  format(...args: unknown[]): string
  timeout?: number
  onDone?(): string
  isEnabled: boolean
}

const calculator = Substitute.for<Calculator>()
const asCalculator: Calculator = calculator
calculator.add(1, 2).returns(3)
calculator.add(1, 2).returns(3, 4, 5)
calculator.add(Arg.any(), Arg.is(b => b > 0)).returns(1)
calculator.add(Arg.all()).mimicks((a, b) => a + b)
calculator.divide(Arg.any('number'), 0).throws(new Error('Cannot divide by 0'))
calculator.heavyOperation(1, 2).resolves(4)
calculator.heavyOperation().rejects(new Error())
calculator.isValid(Arg.any()).mimicks(input => input.length > 3)
calculator.status(1).mimicks(() => Status.Active)
calculator.find(1).returns(null)
calculator.reset().returns()
calculator.fail('x').throws(new Error('x'))
calculator.format('a', 1).returns('a 1')
calculator.timeout.returns(1000)
calculator.onDone().returns('done')
calculator.isEnabled.returns(true)
calculator.add(1, 2)[returns](3)
calculator.add(1, 2)[throws](new Error())
calculator.add(1, 2)[mimicks]((a, b) => a - b)
calculator.heavyOperation()[resolves](1)
calculator.heavyOperation()[rejects](new Error())

calculator.received().add(1, 2)
calculator.received(2).add(Arg.all())
calculator.didNotReceive().divide(1, 0)
calculator.received().isEnabled = true
calculator[received](1).add(1, 2)
calculator[didNotReceive]().onDone()
calculator[clearReceivedCalls]()
calculator[configure]().add(1, 2).returns(3)
calculator[mimick]({} as Calculator)

// overloads, including one without parameters
interface Store {
  get(): string[]
  get(key: string): string
}
const store = Substitute.for<Store>()
store.get().returns(['a'])
store.get('k').returns('v')
store.get(Arg.is(key => key.length > 0)).returns('v')

// index signatures
interface Config {
  name: string
  [key: string]: unknown
}
const config = Substitute.for<Config>()
config.name.returns('app')

// members that conflict with the library's names
interface Order {
  returns: string[]
  total(): number
}
interface Shop { find(id: string): Order }
const shop = Substitute.for<Shop>()
const order = Substitute.for<Order>()
order.total().returns(1)
order[received]().total()
shop.find('1')[returns](order)

// generic helpers
function once<T>(sub: SubstituteOf<T>) {
  return sub[received](1)
}
once(calculator).add(1, 2)

// TD-2 / T26: setups and string assertions in generic code
interface Repo<T> { get(id: string): T; find(id: string): T | undefined; count: number }
function stubRepo<T>(repo: SubstituteOf<Repo<T>>, value: T) {
  repo.count.returns(1)
  repo.get(Arg.any()).returns(value)
  repo.find('a').returns(undefined)
  repo[configure]().get('b').returns(value)
  repo.received().get('a')
  repo.didNotReceive().find('b')
}
stubRepo(Substitute.for<Repo<string>>(), 'value')
function expectNoCalls<T>(sub: SubstituteOf<T>) {
  return sub.didNotReceive()
}
expectNoCalls(calculator).add(1, 2)

// TD-1 / T25: members typed only null / undefined
interface Ok { data: string; error?: undefined; nothing: null }
const ok = Substitute.for<Ok>()
ok.data.returns('x')
const nothing: null = ok.nothing
const asOk: Ok = ok

// TD-3 / T27: Arg.all() after leading arguments
interface Logger {
  log(message: string, ...details: string[]): void
  find(id: string, options?: { deep: boolean }): string
}
const logger = Substitute.for<Logger>()
calculator.add(1, Arg.all()).returns(3)
calculator.received().add(1, Arg.all())
logger.received().log('saved', Arg.all())
logger.find('1', Arg.all()).returns('x')

// TD-5 / T28: Arg.any('function') / Arg.any('object') on typed parameters
interface Bus { subscribe(handler: (value: number) => void): () => void; save(item: { id: string }): void }
const bus = Substitute.for<Bus>()
bus.subscribe(Arg.any('function')).returns(() => undefined)
bus.received().save(Arg.any('object'))

// TD-6 / T29: a matcher created on its own from an annotated predicate
const negative = Arg.is((x: number) => x < 0)
calculator.divide(negative, negative).returns(1)
const notZero = Arg.is.not((x: number) => x === 0)
calculator.divide(1, notZero).returns(2)

// TD-7 / T30: clearing an optional property, checked in the assertion view
interface Form { note?: string }
const form = Substitute.for<Form>()
form.received().note = undefined

try {
  calculator.received().add(9, 9)
} catch (error) {
  if (error instanceof SubstituteException) {
    const message: string = error.message
  }
}

export { asCalculator, nothing, asOk }
