// R4TD-2 / R4V-1 / T40 Optional and nullable members in generic code.
// Everything below compiles with TypeScript 4.8 and newer (`npm run test:types`). Older versions have limitations that
// the typings cannot avoid (checked with the cross-version harness on TypeScript 3.6, 3.7, 3.8, 3.9, 4.0, 4.1, 4.5,
// 4.7, 4.8, 4.9, 5.0, 5.4, 5.9 and 7.0):
// - TypeScript 3.6 to 4.7: with a constrained type parameter, calls of optional methods and of members typed
//   `fn | undefined` are "not callable" (TS2349): `sub.reset()`, `sub.find('a')`, `sub.maybeAdd(1)`, `sub.load()` in
//   `stub` below, `this.sub.reset()` in `Fixture`, and the methods of `T extends Partial<Calculator>`.
// - TypeScript 3.6 to 3.8: properties whose type includes `null` or `undefined` have no setup API (TS2339), with a
//   constrained type parameter (`sub.limit`, `sub.name`, the properties of `T extends Partial<Calculator>`) and in an
//   interface instantiated with any type parameter, constrained or not (`box.maybe` with `maybe?: T`, `box.orNull`
//   with `orNull: T | null`).
// The configure view and the checks work on every version (spec-types/min-ts/consumer.ts checks them with TypeScript
// 3.6): `sub[configure]().reset().returns()`, `sub[configure]().limit.returns(10)`, `box[configure]().maybe.returns(x)`,
// `sub.received().reset()`.
// (Intersecting the setup API with `Required<T>` instead of `T` in generic code would remove both limitations, but a
// substitute would then no longer be assignable to a constraint class with private or protected members.)
import { Substitute, SubstituteOf, Arg, configure, received, didNotReceive, returns } from '../src'

interface Calculator {
  add(a: number, b: number): number
  total: number
  name: string | null
  limit?: number
  reset?(): void
  find?(id: string): string | undefined
  maybeAdd: ((a: number) => number) | undefined
  load?(): Promise<number>
}

export function stub<T extends Calculator>(sub: SubstituteOf<T>) {
  sub.name.returns('x')
  sub.name.returns(null)
  sub.limit.returns(10)
  sub.limit.returns(undefined)
  sub.reset().returns()
  sub.reset()[returns]()
  sub.find('a').returns('b')
  sub.find(Arg.any()).returns(undefined)
  sub.maybeAdd(1).returns(2)
  sub.load().resolves(1)

  // the forms that work on every version
  sub[configure]().reset().returns()
  sub[configure]().find('a').returns('b')
  sub[configure]().maybeAdd(1).returns(2)
  sub[configure]().limit.returns(10)
  sub[configure]().name.returns(null)
  sub.received().reset()
  sub.received().find('a')
  sub.received().limit = undefined
  sub[received](1).maybeAdd(Arg.all())
  sub[didNotReceive]().reset()

  // @ts-expect-error the configured value has the member's type
  sub.limit.returns('10')
  // @ts-expect-error the configured value has the member's type
  sub.find('a').returns(1)
  // @ts-expect-error the promise resolves to a number
  sub.load().resolves('x')
  // @ts-expect-error the arguments keep their types
  sub.maybeAdd('1')
  // @ts-expect-error the method has no parameters
  sub.reset(1)
  // @ts-expect-error a call in the assertion view returns nothing
  sub.received().reset().returns()
  const asT: T = sub
  const asCalculator: Calculator = sub
  return [asT, asCalculator]
}

export class Fixture<T extends Calculator> {
  sub = Substitute.for<T>()
  arrange() {
    this.sub.reset().returns()
    this.sub.limit.returns(1)
    this.sub[configure]().reset().returns()
  }
}

export function partial<T extends Partial<Calculator>>(sub: SubstituteOf<T>) {
  sub.total.returns(1)
  sub.add(1, 2).returns(3)
  sub[configure]().add(1, 2).returns(3)
  sub.received().add(1, 2)
}

interface Box<T> { current: T; maybe?: T; orNull: T | null; load?(): T }
export function stubBox<T>(box: SubstituteOf<Box<T>>, value: T) {
  box.current.returns(value)
  box.maybe.returns(value)
  box.maybe.returns(undefined)
  box.orNull.returns(value)
  box.orNull.returns(null)
  box.load().returns(value)
  box[configure]().maybe.returns(value)
  box[configure]().orNull.returns(value)
  ;(box.received() as Box<T>).maybe = value // see limitations.ts (`current: T`)
  const asBox: Box<T> = box
  return asBox
}

const calculator = Substitute.for<Calculator>()
stub(calculator)
new Fixture<Calculator>().arrange()
partial(calculator)
stubBox(Substitute.for<Box<string>>(), 'x')
