// R4TD-3 / T41 Constrained generic code: keys that exist only through the constraint's string index signature
// (`T extends { [key: string]: number; port: number }`, `sub.timeout`) can be configured, with values checked against
// the index signature's type, and called (index signatures of function types) and read in checks.
// Checking a set of such a key (`sub.received().timeout = 5`) does not compile: TypeScript does not resolve a write
// through an index signature on a generic type (TS2339). Check it through the constraint type instead (below).
import { Substitute, SubstituteOf, Arg, configure, received, didNotReceive, returns } from '../src'

interface Settings { [key: string]: number; port: number }
export function stubSettings<T extends Settings>(sub: SubstituteOf<T>) {
  sub.port.returns(80)
  sub.timeout.returns(5)
  sub.timeout.returns(5, 6)
  sub.timeout[returns](7)
  sub[configure]().timeout.returns(5)
  sub.received().timeout
  sub[received](1).timeout
  sub.didNotReceive().timeout
  sub.received().port = 80
  const timeout: number = sub.timeout
  ;(sub.received() as Settings).timeout = 5
  ;(sub as SubstituteOf<Settings>).received().timeout = 5

  // @ts-expect-error the configured value has the index signature's type
  sub.timeout.returns('5')
  // @ts-expect-error the configure view checks the value too
  sub[configure]().timeout.returns('5')
  // @ts-expect-error the named member keeps its own type
  sub.port.returns('80')
  // @ts-expect-error the limitation: a set of an index-signature key in a check
  sub.received().timeout = 5
  return timeout
}

interface Mixed { [key: string]: number | string; id: number; name: string }
export function stubMixed<T extends Mixed>(sub: SubstituteOf<T>) {
  sub.id.returns(1)
  sub.extra.returns(1)
  sub.extra.returns('x')
  sub[configure]().extra.returns('y')
  // @ts-expect-error the configured value has the index signature's type
  sub.extra.returns(true)
}

interface Handlers { [name: string]: (payload: string) => number; save(payload: string): number }
export function stubHandlers<T extends Handlers>(sub: SubstituteOf<T>) {
  sub.save('x').returns(1)
  sub.other('x').returns(2)
  sub.other(Arg.all()).mimicks(payload => payload.length)
  sub[configure]().other('x').returns(2)
  sub.received().other('x')
  sub[didNotReceive]().other(Arg.any())
  // @ts-expect-error the call returns a number
  sub.other('x').returns('2')
  // @ts-expect-error the arguments keep their types
  sub.received().other(1)
}

// Concrete types are unchanged
const settings = Substitute.for<Settings>()
settings.timeout.returns(5)
settings.received().timeout = 5
// @ts-expect-error the configured value has the index signature's type
settings.timeout.returns('5')
const mixed = Substitute.for<Mixed>()
mixed.extra.returns(1)
mixed.extra.returns('x')
stubSettings(settings)
stubMixed(mixed)
stubHandlers(Substitute.for<Handlers>())
