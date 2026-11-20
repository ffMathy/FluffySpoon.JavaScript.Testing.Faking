import test from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute, Arg } from '../../../src'
import { RecordedArguments } from '../../../src/internals/RecordedArguments'
import { assertWithin, timeLimit } from '../../helpers/timing'

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

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}
const bestOfThree = (run: () => void) => {
  run() // warm up
  return Math.min(millisecondsOf(run), millisecondsOf(run), millisecondsOf(run))
}

test('R3-1 (E3) 10k unconfigured calls with Error arguments, cb(err, null) and back-references finish well under 1s', t => {
  const cases: Array<[string, () => void]> = [
    ['logger.error(new Error(message_i))', () => {
      const logger = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) logger.error(new Error(`request ${index} failed`))
    }],
    ['cb(new TypeError(message_i), null)', () => {
      const callback = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) callback(new TypeError(`bad ${index}`), null)
    }],
    ['visit(node_i) with a child-to-parent back-reference', () => {
      const visitor = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) {
        const node: any = { id: index, children: [] }
        node.children.push({ parent: node })
        visitor.visit(node)
      }
    }],
    ['f({ err: new Error(message_i) })', () => {
      const substitute = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) substitute.f({ err: new Error(`e${index}`) })
    }]
  ]
  for (const [name, run] of cases) {
    const elapsedLimit = timeLimit(1000)
    const elapsed = bestOfThree(run)
    assertWithin(t, elapsed, elapsedLimit, `${name}`)
  }

  // the cache still finds equal arguments
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

test('R3-ADV-2 (E3) cyclic setups, 1 MB strings, deep DAGs and 150k-element arrays finish well under 1s', t => {
  const cases: Array<[string, () => void]> = [
    ['2000 cyclic setups and 2000 matching calls', () => {
      const repository = Substitute.for<any>()
      for (let index = 0; index < 2000; index++) {
        const entity: any = { id: index }
        entity.self = entity
        repository.save(entity).returns(index)
      }
      for (let index = 0; index < 2000; index++) {
        const entity: any = { id: index }
        entity.self = entity
        if (repository.save(entity) !== index) throw new Error(`save(${index})`)
      }
    }],
    ['200 calls with distinct 1 MB strings', () => {
      const log = Substitute.for<any>()
      const payload = 'x'.repeat(1 << 20)
      for (let index = 0; index < 200; index++) log.write(index + payload)
    }],
    ['50 calls with a deep DAG of shared subtrees', () => {
      const store = Substitute.for<any>()
      for (let index = 0; index < 50; index++) {
        let dag: any = { leaf: index }
        for (let level = 0; level < 25; level++) dag = { a: dag, b: dag }
        store.put(dag)
      }
    }]
  ]
  for (const [name, run] of cases) {
    const elapsedLimit = timeLimit(1000)
    const elapsed = bestOfThree(run)
    assertWithin(t, elapsed, elapsedLimit, `${name}`)
  }

  // 20 calls with 150k-element arrays (the arrays are created beforehand: only the calls are timed)
  const arrays = Array.from({ length: 20 }, (_, index) => {
    const items = Array.from({ length: 150_000 }, (_, item) => ({ item }))
    items[149_999] = { item: -index }
    return items
  })
  const elapsedLimit = timeLimit(1000)
  const elapsed = bestOfThree(() => {
    const sink = Substitute.for<any>()
    for (const items of arrays) sink.consume(items)
  })
  assertWithin(t, elapsed, elapsedLimit, `20 calls with 150k-element arrays`)
})

test('R3-ADV-2 (E3) the search for nested matchers is bounded as well, and still finds them in ordinary arguments', t => {
  const items = Array.from({ length: 150_000 }, (_, item) => ({ item }))
  const elapsedLimit = timeLimit(100)
  const elapsed = bestOfThree(() => {
    for (let index = 0; index < 20; index++) RecordedArguments.containsMatchers([items])
  })
  assertWithin(t, elapsed, elapsedLimit, '20 searches of a 150,000-item array')

  const repository = Substitute.for<any>()
  repository.save({ user: { id: Arg.any(), roles: [Arg.any('string'), 'admin'] } }).returns('saved')
  t.is(repository.save({ user: { id: 1, roles: ['x', 'admin'] } }), 'saved')
  const wide = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, index === 199 ? Arg.any() : index]))
  repository.update(wide).returns('updated')
  t.is(repository.update({ ...wide, k199: 'anything' }), 'updated')
  repository.received(1).save(Arg.all())
  repository.received(1).update(Arg.all())
})
