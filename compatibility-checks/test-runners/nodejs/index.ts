import * as test from 'node:test'
import { ambiguousPropertyTypeAssertion } from '../_common'

test.test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})
