import * as test from 'node:test'
import { ambiguousPropertyTypeAssertion } from '../_common'

// R4-ADV-3 (E12): the tests around the failing one must still run and be reported (see test/index.ts).
test.test('passes before the failing test', () => { })

test.test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})

test.test('passes after the failing test', async () => {
  await new Promise(resolve => setTimeout(resolve, 20))
})
