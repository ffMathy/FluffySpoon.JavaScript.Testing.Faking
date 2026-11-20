// T:TY-10 Overloads without parameters do not break the other overloads, and a single matcher argument resolves to
// the overload with one parameter (not to an Arg.all() signature of the zero-parameter overload).
import { Substitute, Arg } from '../src'
import { expectType } from './helpers'

// (a) zero-parameter overload declared last
interface Field {
  value(newValue: string): void
  value(): string
}
const field = Substitute.for<Field>()
field.value().returns('current')
field.value('x').throws(new Error('read-only'))
field.value(Arg.any()).returns()
field.received().value('x')
field.received().value()

// (b) zero-parameter overload declared first
interface Store {
  get(): string[]
  get(key: string): string
}
const store = Substitute.for<Store>()
store.get('k').returns('v')
store.get(Arg.any()).returns('v')
store.get(Arg.is(k => k.startsWith('user:'))).returns('v')
store.get().returns(['a'])
store.received().get(Arg.is(k => k.length > 0))
expectType<string>(store.get('k'))
expectType<string[]>(store.get())

// @ts-expect-error the overload with a parameter returns a string
store.get(Arg.any()).returns(['v'])
