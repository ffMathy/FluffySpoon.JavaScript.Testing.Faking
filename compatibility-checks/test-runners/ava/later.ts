import test from 'ava'

// R4-ADV-3 (E12): a file of its own, which ava runs in another worker (see test/index.ts).
test('runs in another file', t => {
  t.pass()
})
