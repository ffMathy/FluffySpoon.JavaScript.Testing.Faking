// R7TD-2 / T53 A constructor type with several construct signatures has the call syntax (setups, checks, the configure
// view) for each of them, on every TypeScript version (TypeScript 5.2 and older offered only the last one).
// `npm run test:types:min-ts` checks the same on TypeScript 3.6 (spec-types/min-ts/consumer.ts).
import { Substitute, Arg, configure, received } from '../src'

interface Client { get(path: string): string }
const client = Substitute.for<Client>()

interface Two { new (url: string): Client; new (url: string, retries: number): Client }
const two = Substitute.for<Two>()
two('u').returns(client)
two('u', 1).returns(client)
two(Arg.any()).returns(client)
two.received()('u')
two.received(1)('u', 1)
two[received]()('u', Arg.any())
two[configure]()('u').returns(client)
two[configure]()('u', 1).returns(client)
const made: Client = new two('u')
const madeWithRetries: Client = new two('u', 3)
// @ts-expect-error the retries are a number
two('u', 'x')
// @ts-expect-error the url is needed
two()
// @ts-expect-error a client is returned
two('u').returns(1)

interface LastFirst { new (url: string, retries: number): Client; new (url: string): Client }
const lastFirst = Substitute.for<LastFirst>()
lastFirst('u').returns(client)
lastFirst('u', 1).returns(client)

interface Three { new (): Client; new (value: number): Client; new (year: number, month: number): Client }
const three = Substitute.for<Three>()
three().returns(client)
three(0).returns(client)
three(1, 2).returns(client)
three[configure]()(1, 2).returns(client)
// @ts-expect-error no construct signature takes three arguments
three(1, 2, 3)

// A class constructor as a member (`ns.Client`)
declare class ApiClient { constructor(url: string); constructor(url: string, retries: number); get(path: string): string }
interface Namespace { Client: typeof ApiClient }
const ns = Substitute.for<Namespace>()
const apiClient = Substitute.for<ApiClient>()
ns.Client('u').returns(apiClient)
ns.Client('u', 2).returns(apiClient)
ns.received(1).Client('u', 2)
ns[configure]().Client('u', 2).returns(apiClient)
// @ts-expect-error the retries are a number
ns.Client('u', 'x')

export { made, madeWithRetries }
