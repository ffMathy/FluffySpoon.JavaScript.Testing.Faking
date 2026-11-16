// D11 If T has a member named received, didNotReceive, returns, throws, resolves, rejects or mimicks, only the symbol
// forms `sub[received]()` / `sub[didNotReceive]()` are offered. This rules out the ambiguous `sub.received().returns(5)`,
// which the runtime treats as a setup of a member called `received`. The symbol forms are always offered.
import { Substitute, Arg, received, didNotReceive, clearReceivedCalls } from '../src'

interface Plain { add(a: number, b: number): number }
const plain = Substitute.for<Plain>()
plain.received().add(1, 2)
plain.received(2).add(1, 2)
plain.didNotReceive().add(1, 2)
plain[received]().add(1, 2)
plain[received](0).add(1, 2)
plain[didNotReceive]().add(1, 2)
plain[clearReceivedCalls]()

interface Account {
  returns(item: string): number
  balance(): number
}
const account = Substitute.for<Account>()
account.returns('book').returns(5)
account[received]().returns('book')
account[received](1).balance()
account[didNotReceive]().returns(Arg.any())
// @ts-expect-error ambiguous: Account has a member named `returns`
account.received().returns('book')
// @ts-expect-error ambiguous: Account has a member named `returns`
account.didNotReceive().balance()

interface Inbox {
  received: string[]
  didNotReceive(): boolean
  open(): void
}
const inbox = Substitute.for<Inbox>()
inbox.received.returns(['mail'])
inbox.didNotReceive().returns(true)
inbox[received]().open()
inbox[received]().didNotReceive()
inbox[received](2).received
inbox[didNotReceive]().open()
// `inbox.received` is the member, not the assertion
// @ts-expect-error string[] is not callable
inbox.received(1)

// every name in the rule
interface WithThrows { throws: boolean; run(): void }
interface WithResolves { resolves(): void; run(): void }
interface WithRejects { rejects: number; run(): void }
interface WithMimicks { mimicks(): void; run(): void }
const withThrows = Substitute.for<WithThrows>()
const withResolves = Substitute.for<WithResolves>()
const withRejects = Substitute.for<WithRejects>()
const withMimicks = Substitute.for<WithMimicks>()
withThrows[received]().run()
withResolves[received]().run()
withRejects[received]().run()
withMimicks[received]().run()
// @ts-expect-error WithThrows has a member named `throws`
withThrows.received()
// @ts-expect-error WithResolves has a member named `resolves`
withResolves.received()
// @ts-expect-error WithRejects has a member named `rejects`
withRejects.didNotReceive()
// @ts-expect-error WithMimicks has a member named `mimicks`
withMimicks.didNotReceive()

// Members named mimick, configure or clearReceivedCalls do not conflict: those are symbol-only APIs.
interface Tools { mimick(): void; configure(): void; clearReceivedCalls(): void }
const tools = Substitute.for<Tools>()
tools.received().configure()
tools.configure().returns()
tools.clearReceivedCalls()
tools[clearReceivedCalls]()
