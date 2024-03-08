import test from 'ava'
import { ambiguousPropertyTypeAssertion } from '../_common'

test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})
