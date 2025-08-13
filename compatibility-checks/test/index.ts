import * as test from 'node:test'
import * as assert from 'node:assert'
import { execSync } from 'node:child_process'

type TestRunner = {
  name: string
  failureAcknowledgementText: string
  failureLocationText: string
}

test.describe('Verifies test runner compatibility', () => {
  const failingExec = (command: string): string => {
    const { FORCE_COLOR, ...environment } = { ...process.env, CI: '1', NO_COLOR: '1' } as Partial<Record<string, string>>
    try {
      execSync(command, { env: environment, stdio: 'pipe' })
      assert.fail('Execution should have failed with a non-zero exit code. We expect the test runner have 1 failing test.')
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
      // @ts-expect-error
      return error.stdout.toString() + error.stderr.toString()
    }
  }

  const testRunners: TestRunner[] = [
    { name: 'ava', failureAcknowledgementText: '1 uncaught exception', failureLocationText: 'test-runners/ava/index.ts' },
    { name: 'jest', failureAcknowledgementText: '', failureLocationText: 'test-runners/jest/index.spec.ts' },
    { name: 'mocha', failureAcknowledgementText: '1 failing', failureLocationText: 'can substitute callable interfaces:' },
    { name: 'nodejs', failureAcknowledgementText: 'fail 1', failureLocationText: 'test-runners/nodejs/index.ts' },
    { name: 'vitest', failureAcknowledgementText: '1 error', failureLocationText: 'error originated in "test-runners/vitest/index.spec.ts" test file' }
  ]

  testRunners.forEach(testRunner => {
    test.describe(testRunner.name, () => {
      test.it('reports the uncaught Substitute exception', () => {
        const result = failingExec(`npm run validate:${testRunner.name}`)
        assert.ok(
          result.includes(testRunner.failureAcknowledgementText),
          `Could not find the expected failure acknowledgement in the output. Expected "${testRunner.failureAcknowledgementText}"`
        )
        assert.ok(
          result.includes(testRunner.failureLocationText),
          `Could not find the expected failure location in the output. Expected "${testRunner.failureLocationText}"`
        )
        assert.ok(
          result.includes('SubstituteException: Call count mismatch'),
          `Could not find the expected exception message in the output: ${result}`
        )
      })
    })
  })
})
