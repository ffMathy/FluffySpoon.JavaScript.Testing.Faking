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

/*
 * R4-ADV-3 (E12): what each runner does with the tests around a failure that is reported after the test returned
 * (on a microtask, E6). The fixtures have passing tests before and after the failing one (and mocha and ava a second
 * file), and these checks pin what really happens, so that the README stays true when a runner changes.
 */

/**
 * mocha marks a synchronous test as passed when it returns. The later failure is reported as a second result of that
 * test ("1) can substitute callable interfaces", "Uncaught SubstituteException"), and mocha then aborts the run: the
 * remaining tests do not run, in the same file or in later files. No scheduling of the report can change this, as the
 * test has passed before any callback runs.
 */
const verifyMocha = (output: string) => {
  assert.ok(output.includes('✔ passes before the failing test'), `mocha did not report the test before the failing one: ${output}`)
  assert.ok(output.includes('1) can substitute callable interfaces') && output.includes('Uncaught SubstituteException'),
    `mocha did not report the failure of the test as uncaught: ${output}`)
  assert.ok(/2 passing/.test(output) && /1 failing/.test(output), `mocha's summary changed: ${output}`)
  assert.ok(output.includes('mocha loaded later.ts'), `mocha did not load the later file: ${output}`)
  assert.ok(!output.includes('passes after the failing test') && !output.includes('runs in a later file'),
    `mocha now runs the tests after the failure: update README "Assertions that fail later" and this check: ${output}`)
}

/**
 * ava runs each file in a worker of its own, and the tests of a file concurrently. The failure is an uncaught exception
 * in the worker, which ends it: the failing test is reported as passed, then "Uncaught exception in <file>" and
 * "<file> exited with a non-zero exit code"; the tests of that file that had not finished are not reported at all.
 * Other files are not affected.
 */
const verifyAva = (output: string) => {
  assert.ok(output.includes('later › runs in another file'), `ava did not report the test of the other file: ${output}`)
  assert.ok(output.includes('index › can substitute callable interfaces'), `ava did not report the failing test: ${output}`)
  assert.ok(output.includes('Uncaught exception in test-runners/ava/index.ts') &&
    output.includes('test-runners/ava/index.ts exited with a non-zero exit code'), `ava did not report the uncaught exception: ${output}`)
  assert.ok(!output.includes('passes before the failing test') && !output.includes('passes after the failing test'),
    `ava now reports the unfinished tests of the file: update README "Assertions that fail later" and this check: ${output}`)
}

/** vitest runs and reports every test (as passed), and reports the failure as an unhandled error of the last test. */
const verifyVitest = (output: string) => {
  assert.ok(/Tests\s+3 passed \(3\)/.test(output) && /Errors\s+1 error/.test(output), `vitest's summary changed: ${output}`)
  assert.ok(output.includes('The last test to run before this error was "can substitute callable interfaces"'),
    `vitest did not name the test: ${output}`)
}

/** node:test runs and reports every test (as passed), and fails the file with the error. */
const verifyNodeTest = (output: string) => {
  assert.ok(/pass 3/.test(output) && output.includes('passes after the failing test'), `node:test did not run every test: ${output}`)
  assert.ok(output.includes('generated asynchronous activity after the test ended'), `node:test did not report the error: ${output}`)
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
    { name: 'ava', failureAcknowledgementTexts: ['1 uncaught exception', '1 test failed'], failureLocationText: 'test-runners/ava/index.ts', verify: verifyAva },
    {
      name: 'jest',
      failureAcknowledgementTexts: ['Tests:'],
      failureLocationText: 'test-runners/jest/index.spec.ts',
      mapsCallSites: true,
      verify: verifyJest
    },
    { name: 'mocha', failureAcknowledgementTexts: ['1 failing'], failureLocationText: 'can substitute callable interfaces:', verify: verifyMocha },
    // G:CI-2: this check used to pass vacuously or fail, because the nested `node --test` inherited NODE_TEST_CONTEXT.
    { name: 'nodejs', failureAcknowledgementTexts: ['fail 1'], failureLocationText: 'test-runners/nodejs/index.ts', verify: verifyNodeTest },
    { name: 'vitest', failureAcknowledgementTexts: ['1 error', '1 failed'], failureLocationText: 'test-runners/vitest/index.spec.ts', mapsCallSites: true, verify: verifyVitest },
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
