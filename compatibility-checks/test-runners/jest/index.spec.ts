import { expect, test } from '@jest/globals'
import { ambiguousPropertyTypeAssertion } from '../_common'

// R3-ADV-5 (E6): the tests around the failing one must still run and be reported, so that a crash of the jest
// process (which loses them) cannot pass for the failure of one test.
test('passes before the failing test', () => {
  expect(1).toBe(1)
})

test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})

test('passes after the failing test', () => {
  expect(1).toBe(1)
})
