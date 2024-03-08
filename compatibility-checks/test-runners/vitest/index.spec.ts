import { test } from 'vitest'
import { ambiguousPropertyTypeAssertion } from '../_common'

test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})
