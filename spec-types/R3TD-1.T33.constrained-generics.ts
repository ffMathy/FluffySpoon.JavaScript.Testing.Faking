// R3TD-1 / T33 SubstituteOf<T> for a constrained type parameter (`T extends Calculator`): setups, checks and the
// configure view work through the constraint, as for a SubstituteOf<Calculator>. The values they take are checked
// against the constraint's member types.
// (On TypeScript 3.6 to 3.8, members whose type includes null or undefined, such as `name` and `limit` below, have no
// setup API in generic code; spec-types/min-ts/consumer.ts checks the rest with TypeScript 3.6.)
import { Substitute, SubstituteOf, Arg, configure, received, didNotReceive, returns, mimicks } from '../src'

interface Calculator {
  add(a: number, b: number): number
  load(id: string): Promise<number>
  total: number
  name: string | null
  limit?: number
}

export function stub<T extends Calculator>(s: SubstituteOf<T>) {
  s.total.returns(1)
  s.total.returns(1, 2)
  s.total[returns](3)
  s.add(1, 2).returns(3)
  s.add(Arg.any(), Arg.is(b => b > 0)).returns(4)
  s.add(1, Arg.all()).returns(5)
  s.add(Arg.all()).mimicks((a, b) => a + b)
  s.add(1, 2)[mimicks]((a, b) => a - b)
  s.load('a').resolves(1)
  s.load('a').rejects(new Error())
  s.name.returns('x')
  s.name.returns(null)
  s.limit.returns(10)
  s[configure]().total.returns(1)
  s[configure]().add(1, 2).returns(3)
  s[configure]().load(Arg.any()).resolves(2)

  s.received().add(1, 2)
  s.received(2).add(1, Arg.all())
  s.didNotReceive().add(Arg.all())
  s.received().total = 1
  s.received(1).total = Arg.any()
  s.didNotReceive().name = null
  s.received().limit = undefined
  s[received](1).total = 2
  s[didNotReceive]().add(1, 2)
  const total: number = s.received().total

  // @ts-expect-error the configured value has the member's type
  s.total.returns('1')
  // @ts-expect-error the configured value has the member's type
  s.add(1, 2).returns('3')
  // @ts-expect-error the arguments keep their types
  s.add('1', 2)
  // @ts-expect-error the arguments keep their types in the assertion view
  s.received().add('1', 2)
  // @ts-expect-error a property check keeps the member's type
  s.received().total = '1'
  // @ts-expect-error a required property does not accept undefined
  s.received().total = undefined
  // @ts-expect-error the configure view checks the value too
  s[configure]().total.returns('1')
  // @ts-expect-error resolves() is only offered for promises
  s.add(1, 2).resolves(3)
  // @ts-expect-error not a member of the constraint
  s.subtract(1, 2)
  return total
}

export class Fixture<T extends Calculator> {
  sub = Substitute.for<T>()
  arrange() {
    this.sub.add(1, 2).returns(3)
    this.sub.total.returns(10)
    this.sub[configure]().add(Arg.all()).returns(0)
  }
  verify() {
    this.sub.received().add(1, 2)
    this.sub.received().total = 10
  }
}

interface ScientificCalculator extends Calculator { sqrt(x: number): number }
const fixture = new Fixture<ScientificCalculator>()
fixture.arrange()
fixture.sub.sqrt(4).returns(2)
fixture.verify()
stub(Substitute.for<Calculator>())
stub(fixture.sub)
