import { test } from 'mocha'

// R4-ADV-3 (E12): a file that mocha loads after index.ts (see test/index.ts). mocha loads every file before it runs
// the tests, so this line is printed whether or not the test below runs.
console.log('mocha loaded later.ts')

test('runs in a later file', () => { })
