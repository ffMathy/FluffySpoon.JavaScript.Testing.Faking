import { test } from 'mocha'
import { ambiguousPropertyTypeAssertion } from '../_common'

test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})
