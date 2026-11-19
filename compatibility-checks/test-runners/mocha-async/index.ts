import { test } from 'mocha'
import { ambiguousPropertyTypeAssertion } from '../_common'

// R15FE-4: the shared scenario in an async test (most mocha tests of real code are async), whose check fails later
// (D9: on a microtask, E6) while the test's promise is still pending. The tests around it, and the test in later.ts,
// show what mocha does with such a failure (see verifyMochaAsync in test/index.ts).
test('passes before the failing test', () => { })

test('can substitute callable interfaces in an async test', async () => {
  await Promise.resolve()
  ambiguousPropertyTypeAssertion()
})

test('passes after the failing test', () => { })
