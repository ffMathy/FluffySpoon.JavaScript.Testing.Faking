import { test } from 'vitest'
import { ambiguousPropertyTypeAssertion } from '../_common'

// R4-ADV-3 (E12): the tests around the failing one must still run and be reported (see test/index.ts).
test('passes before the failing test', () => { })

test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})

test('passes after the failing test', async () => {
  await new Promise(resolve => setTimeout(resolve, 20))
})
