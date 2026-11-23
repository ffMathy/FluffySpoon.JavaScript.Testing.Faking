import test from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute, Arg } from '../../../src'

// Round 4, E3 (R3-ADV-2, R3-1): arguments of any size or shape (errors, cycles, long strings and arrays) are compared as
// the RUNNING Node.js's isDeepStrictEqual compares them.

/**
 * isDeepStrictEqual, or false when it throws: Node.js 22 can throw a TypeError on some Sets that hold null and
 * objects. The library treats such a comparison as unequal as well (see RecordedArguments).
 */
const deepStrictEqual = (a: unknown, b: unknown): boolean => {
  try {
    return isDeepStrictEqual(a, b)
  } catch {
    return false
  }
}

test('R3-1 (E3) the auto-substitute cache finds equal Error arguments and equal arguments with back-references', t => {
  const logger = Substitute.for<any>()
  t.is(logger.error(new Error('x')), logger.error(new Error('x')))
  t.not(logger.error(new Error('x')), logger.error(new Error('y')))
  const node: any = { id: 1, children: [] }
  node.children.push({ parent: node })
  const same: any = { id: 1, children: [] }
  same.children.push({ parent: same })
  if (deepStrictEqual(node, same)) t.is(logger.visit(node), logger.visit(same))
  logger.received(3).error(new Error('x'))
})

test('R3-ADV-2 (E3) cyclic setups are found by equal cyclic calls', t => {
  const repository = Substitute.for<any>()
  for (let index = 0; index < 10; index++) {
    const entity: any = { id: index }
    entity.self = entity
    repository.save(entity).returns(index)
  }
  for (let index = 0; index < 10; index++) {
    const entity: any = { id: index }
    entity.self = entity
    t.is(repository.save(entity), index)
  }
})

test('R3-ADV-2 (E3) the search for nested matchers finds them in ordinary arguments', t => {
  const repository = Substitute.for<any>()
  repository.save({ user: { id: Arg.any(), roles: [Arg.any('string'), 'admin'] } }).returns('saved')
  t.is(repository.save({ user: { id: 1, roles: ['x', 'admin'] } }), 'saved')
  const wide = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, index === 199 ? Arg.any() : index]))
  repository.update(wide).returns('updated')
  t.is(repository.update({ ...wide, k199: 'anything' }), 'updated')
  repository.received(1).save(Arg.all())
  repository.received(1).update(Arg.all())
})
