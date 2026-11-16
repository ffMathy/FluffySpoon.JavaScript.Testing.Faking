import * as test from 'node:test'
import * as assert from 'node:assert'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { testRunnerEnvironment } from './environment'

type TestRunner = {
  name: string
  /**
   * One of these must appear in the runner's output. The shared scenario fails with a SubstituteException that is
   * thrown on a microtask after the test returned (E6), which each runner reports in its own way.
   */
  failureAcknowledgementTexts: string[]
  failureLocationText: string
  /** E4: the "called at" lines of the message point at the TypeScript source (the runner applies source maps). */
  mapsCallSites?: boolean
  /** Further checks of the runner's output. */
  verify?: (output: string) => void
}

const nodeMajorVersion = Number(process.versions.node.split('.')[0])

/** The lines of the shared scenario that call the substitute, as the "called at" lines must name them. */
const scenarioCallLines = readFileSync(path.join(__dirname, '../test-runners/_common/index.ts'), 'utf8')
  .split('\n')
  .flatMap((line, index) => line.trim() === 'lib.subSection()' ? [index + 1] : [])

/**
 * R3-ADV-5 (E6): jest must report the failure as the failure of the test, and run and report the other tests of the
 * file. When a deferred report was thrown from process.nextTick, jest crashed instead: Node.js printed the exception as
 * fatal and no summary followed (in band), or the file failed after the worker retries; that must fail this check.
 * jest 30 finds the running test through AsyncLocalStorage, whose store Node.js 22 loses for an exception thrown from
 * a microtask. On Node.js 22 jest 30 therefore reports the failure for the file ("Test suite failed to run"), and the
 * other tests of the file still run and pass.
 */
const verifyJest = (output: string) => {
  assert.ok(!/^Node\.js v\d/m.test(output), `The jest process crashed: ${output}`)
  const testFailure = output.includes('● can substitute callable interfaces') && /Tests:\s+1 failed, 2 passed, 3 total/.test(output)
  const fileFailure = output.includes('● Test suite failed to run') && /Tests:\s+3 passed, 3 total/.test(output)
  // the "Tests:" summary counts the other two tests of the file, which passed
  assert.ok(
    testFailure || (nodeMajorVersion < 24 && fileFailure),
    `jest did not report the failure of the test "can substitute callable interfaces" next to the 2 passing tests: ${output}`
  )
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
    {
      name: 'jest',
      failureAcknowledgementTexts: ['Tests:'],
      failureLocationText: 'test-runners/jest/index.spec.ts',
      mapsCallSites: true,
      verify: verifyJest
    },
    { name: 'mocha', failureAcknowledgementTexts: ['1 failing'], failureLocationText: 'can substitute callable interfaces:' },
    // G:CI-2: this check used to pass vacuously or fail, because the nested `node --test` inherited NODE_TEST_CONTEXT.
    { name: 'nodejs', failureAcknowledgementTexts: ['fail 1'], failureLocationText: 'test-runners/nodejs/index.ts' },
    { name: 'vitest', failureAcknowledgementTexts: ['1 error', '1 failed'], failureLocationText: 'test-runners/vitest/index.spec.ts', mapsCallSites: true },
    // F1: vitest with the package inlined (vitest.inline.config.mts), so that Vite, not Node.js, loads its ES module entry.
    { name: 'vitest-inline', failureAcknowledgementTexts: ['1 error', '1 failed'], failureLocationText: 'test-runners/vitest-inline/index.spec.ts', mapsCallSites: true }
  ]

  // P28 (ENG2-7): jest's matchers must compare a substitute like any other value. Unlike the runs above, this suite
  // (test-runners/jest-matchers) must pass.
  test.describe('jest matchers', () => {
    test.it('P28 a non-matching toHaveBeenCalledWith(substitute) and toEqual(substitute) fail with normal assertion errors', () => {
      try {
        execSync('npm run validate:jest-matchers', { env: testRunnerEnvironment(), stdio: 'pipe' })
      } catch (error) {
        // @ts-expect-error
        assert.fail(`The jest matcher checks failed:\n${error.stdout.toString()}${error.stderr.toString()}`)
      }
    })
  })

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
        // R3-ADV-5: a test runner that crashes does not report the failure of a test
        assert.ok(!/^Node\.js v\d/m.test(result), `The test runner process crashed: ${result}`)
        if (testRunner.mapsCallSites) {
          // R3-ADV-3 (E4): source maps apply to the "called at" lines (they once showed the compiled position)
          assert.equal(scenarioCallLines.length, 3)
          for (const line of scenarioCallLines)
            assert.ok(result.includes(`_common/index.ts:${line}:`), `No "called at" line names test-runners/_common/index.ts:${line}: ${result}`)
        }
        testRunner.verify?.(result)
      })
    })
  })
})
