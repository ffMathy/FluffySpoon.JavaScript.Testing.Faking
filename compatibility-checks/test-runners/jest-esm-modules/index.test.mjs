import { jest, expect, test } from '@jest/globals'
import { Substitute } from '@fluffy-spoon/substitute'

// Round 9 (E53, R8FE-1): jest with native ES modules (NODE_OPTIONS=--experimental-vm-modules,
// jest.unstable_mockModule) takes a module's named exports from the own keys of the factory's object, which a
// substitute (a function without own keys) does not have ("does not provide an export named 'query'"). The documented
// pattern: an object of the substitute's member handles, with the substitute as the default export.
// test/index.ts runs this file with jest.modules.esm.config.js; it must pass.

const db = Substitute.for()
jest.unstable_mockModule('./src/db.mjs', () => ({ default: db, query: db.query }))
const { count } = await import('./src/repo.mjs')

test('E53 a native ES module mocked with an object of member handles', async () => {
  db.query('select count(*)').resolves([42])
  expect(await count()).toBe(42)
  db.received(1).query('select count(*)')
})
