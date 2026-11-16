import { test } from 'mocha'
import { ambiguousPropertyTypeAssertion } from '../_common'

// R4-ADV-3 (E12): the tests around the failing one, and the test in later.ts, show what mocha does with a failure
// that is reported after the test returned (see test/index.ts).
test('passes before the failing test', () => { })

test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})

test('passes after the failing test', () => { })
