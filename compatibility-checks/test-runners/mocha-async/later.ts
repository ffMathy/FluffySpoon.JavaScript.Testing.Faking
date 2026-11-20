import { test } from 'mocha'

// R15FE-4: a file that mocha loads after index.ts (see test/index.ts): its test shows whether the run goes on after the
// failure of the async test.
test('runs in a later file', () => { })
