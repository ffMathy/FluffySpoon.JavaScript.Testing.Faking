import * as test from 'node:test'
import * as assert from 'node:assert'
import { execSync } from 'node:child_process'
import { testRunnerEnvironment } from './environment'

type TestRunner = {
  name: string
  /**
   * One of these must appear in the runner's output. The shared scenario fails with a SubstituteException that is
   * thrown either synchronously (a failed test) or on process.nextTick after the test returned (an uncaught exception),
   * depending on whether the library can decide the assertion right away, so both reports are accepted.
   */
  failureAcknowledgementTexts: string[]
  failureLocationText: string
}

test.describe('Verifies test runner compatibility', () => {
  const failingExec = (command: string): string => {
    try {
      execSync(command, { env: testRunnerEnvironment(), stdio: 'pipe' })
      assert.fail('Execution should have failed with a non-zero exit code. We expect the test runner have 1 failing test.')
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
      // @ts-expect-error
      return error.stdout.toString() + error.stderr.toString()
    }
  }

  const testRunners: TestRunner[] = [
    { name: 'ava', failureAcknowledgementTexts: ['1 uncaught exception', '1 test failed'], failureLocationText: 'test-runners/ava/index.ts' },
    { name: 'jest', failureAcknowledgementTexts: ['Tests:       1 failed', "type: 'CallCountMismatch'"], failureLocationText: 'test-runners/jest/index.spec.ts' },
    { name: 'mocha', failureAcknowledgementTexts: ['1 failing'], failureLocationText: 'can substitute callable interfaces:' },
    // G:CI-2: this check used to pass vacuously or fail, because the nested `node --test` inherited NODE_TEST_CONTEXT.
    { name: 'nodejs', failureAcknowledgementTexts: ['fail 1'], failureLocationText: 'test-runners/nodejs/index.ts' },
    { name: 'vitest', failureAcknowledgementTexts: ['1 error', '1 failed'], failureLocationText: 'test-runners/vitest/index.spec.ts' },
    // F1: vitest with the package inlined (vitest.inline.config.mts), so that Vite, not Node.js, loads its ES module entry.
    { name: 'vitest-inline', failureAcknowledgementTexts: ['1 error', '1 failed'], failureLocationText: 'test-runners/vitest-inline/index.spec.ts' }
  ]

  testRunners.forEach(testRunner => {
    test.describe(testRunner.name, () => {
      test.it('reports the Substitute exception', () => {
        const result = failingExec(`npm run validate:${testRunner.name}`)
        assert.ok(
          testRunner.failureAcknowledgementTexts.some(text => result.includes(text)),
          `Could not find the expected failure acknowledgement in the output. Expected one of ${JSON.stringify(testRunner.failureAcknowledgementTexts)}: ${result}`
        )
        assert.ok(
          result.includes(testRunner.failureLocationText),
          `Could not find the expected failure location in the output. Expected "${testRunner.failureLocationText}": ${result}`
        )
        assert.ok(
          result.includes('SubstituteException') && result.includes('Call count mismatch'),
          `Could not find the expected exception message in the output: ${result}`
        )
      })
    })
  })
})
