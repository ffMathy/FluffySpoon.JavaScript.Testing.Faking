import test from 'ava'

import { Substitute, Arg, configure } from '../../../src'

// Round 3, D35: the auto-substitute cache and the literal substitutions, with arguments of any shape.

const shapes: Array<[string, (index: number) => unknown]> = [
  ['nested objects', index => ({ order: { customer: { id: index } } })],
  ['Buffers', index => Buffer.from(`payload-${String(index).padStart(8, '0')}`)],
  ['long strings with a common prefix', index => `${'x'.repeat(70)}${index}`],
  ['arrays of 20 items', index => Array.from({ length: 20 }, (_, item) => (item === 19 ? index : item))],
  ['Maps', index => new Map([['id', index]])],
  ['Sets', index => new Set([index])],
  ['Dates', index => new Date(index)]
]

test('ENG2-2 (D35) unconfigured calls with equal arguments of any shape get the same auto-substitute', t => {
  const repository = Substitute.for<any>()
  for (const [name, argument] of shapes) t.is(repository.save(argument(7)), repository.save(argument(7)), name)
})

test('V2-5 (D35) object-argument setups are found by equal calls, also through configure() next to a matcher setup', t => {
  const finder = Substitute.for<any>()
  for (let index = 0; index < 50; index++) finder.find({ id: index, tags: [index] }).returns(index)
  for (let index = 0; index < 50; index++) t.is(finder.find({ id: index, tags: [index] }), index)
  for (let index = 0; index < 50; index++) finder.find({ id: -index - 1, tags: [] })

  // through configure(), and with matcher setups next to the literal ones
  const configured = Substitute.for<any>()
  configured.find(Arg.any()).returns('any')
  for (let index = 0; index < 50; index++) configured[configure]().find([index, { nested: index }]).returns(index)
  for (let index = 0; index < 50; index++) t.is(configured.find([index, { nested: index }]), index)
  t.is(configured.find([1, { nested: 2 }]), 'any')
})
