// TD-2 / V2-2 / T26 Generic code, where a type is an unresolved type parameter.
// - The setup API (`.returns`, `.throws`, `.mimicks`, `.resolves`, the symbol forms and the configure view) is offered on
//   calls that return the type parameter, as in 2.0.0-beta.4.
// - `sub.received()` / `sub.didNotReceive()` are offered on SubstituteOf<T> for an unconstrained T: the D11 conflict rule
//   applies only where it can be decided (concrete types, or a constraint; see T-TY-03.G-RG-3.generic-helpers.ts).
// - A PROPERTY whose type is the type parameter itself (`current: T`) has the setup API as well (round 4, T33; it had
//   none in round 3, when `repo[configure]().current.returns(value)` was the way around it). For a concrete type, a
//   member that can only be null or undefined still has none (TD-1.T25.null-only-members.ts).
import { Substitute, SubstituteOf, Arg, configure, received, didNotReceive, returns, throws } from '../src'

interface Repo<T> {
  get(id: string): T
  find(id: string): T | undefined
  all(): T[]
  load(id: string): Promise<T>
  count: number
  current: T
  items: T[]
}

export function stubRepo<T>(repo: SubstituteOf<Repo<T>>, value: T) {
  repo.count.returns(1)
  repo.get(Arg.any()).returns(value)
  repo.get('a').returns(value, value)
  repo.get('a').throws(new Error())
  repo.get('a').mimicks(id => value)
  repo.get('a')[returns](value)
  repo.get('a')[throws](new Error())
  repo.find('a').returns(undefined)
  repo.find('a').returns(value)
  repo.all().returns([value])
  repo.load('a').resolves(value)
  repo.load('a').rejects(new Error())
  repo.items.returns([value])
  repo[configure]().get('b').returns(value)
  repo[configure]().find(Arg.all()).returns(value)
  repo[configure]().current.returns(value)
  repo.received().get('a')
  repo.received(2).count
  repo.didNotReceive().find(Arg.any())
  repo[received]().all()
  repo[didNotReceive]().load('a')

  // @ts-expect-error the configured value must be a T
  repo.get('a').returns(1)
  // @ts-expect-error resolves() is only offered for promises
  repo.get('a').resolves(value)
  // @ts-expect-error the configured value must be a T
  repo.current.returns(1)
  repo.current.returns(value)
  repo.current.mimicks(() => value)
}

// The G:RG-3 / V2-2 helpers
export function once<T>(sub: SubstituteOf<T>) {
  return sub.received(1)
}
export function never<T>(sub: SubstituteOf<T>) {
  return sub.didNotReceive()
}
export function expectNoCalls<T>(sub: SubstituteOf<T>) {
  sub.didNotReceive()
  sub.received()
}
export class Fixture<T> {
  sub = Substitute.for<T>()
  verify() {
    return this.sub.received()
  }
}

interface Calc { add(a: number, b: number): number }
const calculator = Substitute.for<Calc>()
calculator.add(1, 2)
once(calculator).add(1, 2)
never(calculator).add(3, 4)
new Fixture<Calc>().verify().add(1, 2)
// @ts-expect-error the helpers keep the substituted type
once(calculator).subtract(1, 2)

interface Entity { id: string }
export function stubEntity<T extends Entity>(repo: SubstituteOf<Repo<T>>, value: T) {
  repo.get('a').returns(value)
  repo.received().get(value.id)
}
