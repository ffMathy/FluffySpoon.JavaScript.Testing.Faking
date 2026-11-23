// T:TY-3 / G:RG-3 received / didNotReceive / clearReceivedCalls / mimick / configure on SubstituteOf<T> for a generic T.
// The symbol API is always available. The string forms `sub.received()` / `sub.didNotReceive()` are offered unless
// TypeScript can tell that T has a conflicting member (D11): for a constrained type parameter it checks the constraint.
// For an unconstrained one the conflict cannot be decided, so the string forms are offered, as in 2.0.0-beta.4 (T26,
// see TD-2.V2-2.T26.generic-code.ts).
import { Substitute, SubstituteOf, received, didNotReceive, clearReceivedCalls, mimick, configure } from '../src'

export function expectNoCalls<T>(sub: SubstituteOf<T>) {
  return sub[didNotReceive]()
}
export function expectSomeCall<T extends object>(sub: SubstituteOf<T>) {
  return sub[received]()
}
export function once<T>(sub: SubstituteOf<T>) {
  return sub[received](1)
}
export function reset<T>(sub: SubstituteOf<T>) {
  sub[clearReceivedCalls]()
}
export function setup<T>(sub: SubstituteOf<T>) {
  return sub[configure]()
}
export function delegate<T>(sub: SubstituteOf<T>, instance: T) {
  sub[mimick](instance)
}
export function create<T>(): SubstituteOf<T> {
  const sub = Substitute.for<T>()
  sub[received]()
  return sub
}
export class Fixture<T> {
  sub = Substitute.for<T>()
  verify() {
    return this.sub[received]()
  }
}

interface Calculator { add(a: number, b: number): number }

const calculator = create<Calculator>()
calculator.add(1, 2)
once(calculator).add(1, 2)
expectNoCalls(calculator).add(3, 4)
expectSomeCall(calculator).add(1, 2)
setup(calculator).add(1, 2).returns(3)
delegate(calculator, { add: (a, b) => a + b })
new Fixture<Calculator>().verify().add(1, 2)

// A constraint without conflicting members keeps the string forms.
export function viaConstraint<T extends Calculator>(sub: SubstituteOf<T>) {
  sub.received().add(1, 2)
  sub.didNotReceive().add(1, 2)
  sub[received](2).add(1, 2)
}

// For an unconstrained T the conflict cannot be decided, so the string forms are offered (T26).
export function stringFormsInGenericCode<T>(sub: SubstituteOf<T>) {
  sub.received()
  sub.didNotReceive()
}

// A constraint with a conflicting member decides it: only the symbol forms.
interface Account { returns(item: string): number }
export function viaConflictingConstraint<T extends Account>(sub: SubstituteOf<T>) {
  sub[received]().returns('book')
  // @ts-expect-error ambiguous: the constraint has a member named `returns`
  sub.received()
}
