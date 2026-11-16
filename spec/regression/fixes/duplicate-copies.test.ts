import test from 'ava'
import * as path from 'path'

import * as copyA from '../../../src'

// Loads a second, independent copy of the built package, as happens with duplicate installs
// or module registries that are reset between tests.
const loadSecondCopy = (): typeof copyA => {
  const entry = require.resolve('../../../src')
  const root = path.dirname(entry) + path.sep
  const saved = new Map<string, NodeModule>()
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) {
      saved.set(key, require.cache[key]!)
      delete require.cache[key]
    }
  }
  try {
    return require(entry)
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key]
    for (const [key, module] of saved) require.cache[key] = module
  }
}

test('G:RG-8 the symbol API and matchers work across two copies of the package', t => {
  const copyB = loadSecondCopy()
  t.not(copyA.Substitute, copyB.Substitute)

  const substitute = copyA.Substitute.for<any>()
  substitute.add(1)
  t.throws(() => substitute[copyB.received](2).add(1), { message: /Call count mismatch/ })
  t.notThrows(() => substitute[copyB.received](1).add(1))

  substitute[copyB.clearReceivedCalls]()
  t.notThrows(() => substitute[copyB.didNotReceive]().add(1))

  substitute.bar()[copyB.returns](5)
  t.is(substitute.bar(), 5)

  substitute[copyB.configure]().bar().returns(6)
  t.is(substitute.bar(), 6)

  substitute.find(copyB.Arg.any('number')).returns('number')
  t.is(substitute.find(1), 'number')
  t.notThrows(() => substitute.received(1).find(copyB.Arg.is((x: unknown) => x === 1)))
  t.true(copyB.Arg.any('object').matches(substitute))
})
