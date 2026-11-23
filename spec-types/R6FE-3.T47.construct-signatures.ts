// R6FE-3 / T47 Substitutes of constructor types and constructor members: `new` keeps its typing, and the call syntax
// of E23 (`new` is recorded and answered like a call) type-checks for setups and checks.
import { Substitute, SubstituteOf, Arg, configure, received, didNotReceive } from '../src'

interface ApiClient { baseUrl: string; get(path: string): Promise<string> }
type ClientFactory = new (baseUrl: string) => ApiClient

const Client = Substitute.for<ClientFactory>()
const client = Substitute.for<ApiClient>()
Client('https://api').returns(client)
Client(Arg.any()).returns(client)
Client(Arg.all()).returns(client)
Client[configure]()('https://api').returns(client)
Client.received(1)('https://api')
Client[received](1)(Arg.any())
Client.didNotReceive()('https://other')
Client[didNotReceive]()(Arg.all())
const created: ApiClient = new Client('https://api')
const asFactory: ClientFactory = Client
// @ts-expect-error the configured value is an ApiClient
Client('https://api').returns('not a client')
// @ts-expect-error the base URL is a string
Client(1)
// @ts-expect-error `new` keeps the constructor's parameters
new Client(1)
// @ts-expect-error a check returns nothing
Client.received(1)('https://api').returns(client)

// A class constructor as a member of a module-like object.
class Connection {
  constructor(readonly host: string, readonly port?: number) { }
  open(): boolean { return true }
}
interface Driver { Connection: typeof Connection; version: string }
const driver = Substitute.for<Driver>()
const connection = Substitute.for<Connection>()
driver.Connection('db', 5432).returns(connection)
driver.Connection(Arg.any()).returns(connection)
driver[configure]().Connection('db').returns(connection)
driver.received(1).Connection('db', 5432)
driver[received](1).Connection(Arg.all())
driver.didNotReceive().Connection('other')
driver.version.returns('1.0')
const opened: boolean = new driver.Connection('db').open()
const asDriver: Driver = driver
// @ts-expect-error the configured value is a Connection
driver.Connection('db').returns(42)
// @ts-expect-error the port is a number
driver.Connection('db', '5432')

// A constructor type with overloads.
interface DateLike { valueOf(): number }
interface DateLikeConstructor {
  new (): DateLike
  new (value: number): DateLike
  new (year: number, month: number): DateLike
}
const DateCtor = Substitute.for<DateLikeConstructor>()
const date = Substitute.for<DateLike>()
DateCtor().returns(date)
DateCtor(0).returns(date)
DateCtor(2026, 10).returns(date)
DateCtor.received(1)(2026, 10)
// @ts-expect-error no overload takes a string
DateCtor('2026')

// In generic code, through the constraint.
export function stubFactory<T extends ClientFactory>(factory: SubstituteOf<T>, instance: ApiClient) {
  factory('https://api').returns(instance)
  factory.received(1)('https://api')
}

export { created, asFactory, opened, asDriver }
