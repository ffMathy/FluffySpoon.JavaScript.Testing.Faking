// T:TY-8 An index signature does not wipe out the substitute typing of the named members.
import { Substitute } from '../src'

interface Config {
  name: string
  load(): string
  get(key: string): string
  [key: string]: unknown
}
const c = Substitute.for<Config>()
c.name.returns('app')
c.load().returns('loaded')
c.get('a').returns('b')
c.received().get('a')
c.anything.returns(42)

interface Registry {
  [id: string]: (input: number) => number
}
const registry = Substitute.for<Registry>()
registry.double(2).returns(4)
registry.received().double(2)

interface NumberIndexed {
  length: number
  [index: number]: string
}
const list = Substitute.for<NumberIndexed>()
list.length.returns(1)
list[0].returns('first')

const record = Substitute.for<Record<string, () => number>>()
record.foo().returns(1)

// @ts-expect-error the configured value must have the member's type
c.name.returns(1)
