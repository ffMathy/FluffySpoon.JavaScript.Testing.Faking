import test from 'ava'

import { Substitute } from '../../../src'

interface Library { }

test('issue 138: serializes to JSON compatible data', t => {
  const lib = Substitute.for<Library>()
  const result = JSON.stringify(lib)

  t.true(typeof result === 'string')
  t.is(result, '"@Substitute {\\n}"')
})
