import { test } from 'vitest'
import { ambiguousPropertyTypeAssertion } from '../_common'

// The shared scenario, with the package inlined by vitest (vitest.inline.config.mts).
test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})
