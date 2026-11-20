import test from 'ava'
import { ambiguousPropertyTypeAssertion } from '../_common'

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

// R4-ADV-3 (E12): ava runs the tests of a file concurrently. The tests around the failing one, which finish later, and
// the test in later.ts, which runs in a worker of its own, show what ava does with a failure that is reported after
// the test returned (see test/index.ts).
test('passes before the failing test', async t => {
  await delay(20)
  t.pass()
})

test('can substitute callable interfaces', () => {
  ambiguousPropertyTypeAssertion()
})

test('passes after the failing test', async t => {
  await delay(50)
  t.pass()
})
