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
  /** The title of the check, when it is not the generic one. */
  title?: string
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
    `mocha now runs the tests after the failure: update the guide "Assertions that fail later" and this check: ${output}`)
}

/**
 * R15FE-4: an async (promise-returning) test whose check fails later, while the test's promise is still pending
 * (test-runners/mocha-async). mocha reports the SubstituteException as that test's failure ("1) can substitute callable
 * interfaces in an async test", "Uncaught SubstituteException: Call count mismatch ..."), then reports the same test a
 * second time when its promise resolves ("2) ...", "Error: done() called multiple times in test <...>"), and the run goes
 * on: the tests after it, in the same file and in later files, run and pass ("3 passing", "2 failing"). (mocha 11 does
 * the same; it words the first failure "Uncaught Call count mismatch ..." and prints the SubstituteException below it.)
 */
const verifyMochaAsync = (output: string) => {
  const test = 'can substitute callable interfaces in an async test'
  assert.ok(output.includes('✔ passes before the failing test'), `mocha did not report the test before the failing one: ${output}`)
  assert.ok(output.includes(`1) ${test}`) && output.includes('Uncaught SubstituteException: Call count mismatch'),
    `mocha did not report the failure as the async test's own: ${output}`)
  assert.ok(output.includes(`2) ${test}`) && output.includes(`done() called multiple times in test <${test}>`),
    `mocha no longer reports the async test a second time ("done() called multiple times"): update the guide "Assertions that fail later" and this check: ${output}`)
  assert.ok(output.includes('✔ passes after the failing test') && output.includes('✔ runs in a later file'),
    `mocha no longer runs the tests after the failing async test: update the guide "Assertions that fail later" and this check: ${output}`)
  assert.ok(/3 passing/.test(output) && /2 failing/.test(output), `mocha's summary changed: ${output}`)
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
    `ava now reports the unfinished tests of the file: update the guide "Assertions that fail later" and this check: ${output}`)
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
    // R15FE-4: the same in an async test
    {
      name: 'mocha-async',
      title: 'R15FE-4 reports the Substitute exception of an async test as its failure, then "done() called multiple times", and the run goes on',
      failureAcknowledgementTexts: ['2 failing'],
      failureLocationText: 'can substitute callable interfaces in an async test:',
      verify: verifyMochaAsync
    },
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

  // Round 7 (E24-E27): vitest's matchers, its pretty-format and util.inspect with printed, frozen and `in`-probed
  // substitutes (test-runners/vitest-matchers). This suite must pass as well.
  test.describe('vitest matchers', () => {
    test.it('R7 substitutes print by their paths, can be frozen, answer `in`, and compare by identity', () => {
      try {
        execSync('npx vitest run ./test-runners/vitest-matchers/index.spec.ts', { env: testRunnerEnvironment(), stdio: 'pipe' })
      } catch (error) {
        // @ts-expect-error
        assert.fail(`The vitest matcher checks failed:\n${error.stdout.toString()}${error.stderr.toString()}`)
      }
    })
  })

  // Round 8 (E34): a substitute that stands in for a whole module (a jest.mock() factory), imported by the code under
  // test as a namespace, with named imports, with a mixed default and named import, and (through the documented
  // factory) as the default export, compiled by ts-jest with esModuleInterop and by babel-jest. These suites must pass.
  test.describe('jest module mocks', () => {
    for (const compiler of ['ts', 'babel']) {
      test.it(`E34 every import form of a module substitute works (${compiler === 'ts' ? 'ts-jest with esModuleInterop' : 'babel-jest'})`, () => {
        try {
          execSync(`npm run validate:jest-modules-${compiler}`, { env: testRunnerEnvironment(), stdio: 'pipe' })
        } catch (error) {
          // @ts-expect-error
          assert.fail(`The module mock checks failed:\n${error.stdout.toString()}${error.stderr.toString()}`)
        }
      })
    }
  })

  // Round 9 (E53): module mocks that need a plain object, made of a substitute's member handles: a module re-exported
  // by a barrel (`export *`, jest with ts-jest and babel-jest, in the jest-modules suites above), vitest's vi.mock(),
  // node:test's mock.module() and jest's unstable_mockModule() for native ES modules. These suites must pass.
  // (Round 15, E96: the native ES modules suite of jest also checks Arg matchers inside jest's asymmetric matchers, with
  // the expect of jest 30 and of jest 29, in test-runners/jest-esm-modules/matchers.test.mjs; the jest and vitest matcher
  // suites above check them for CommonJS and vitest.)
  test.describe('module mocks that need a plain object', () => {
    for (const suite of ['vitest-modules', 'nodejs-modules', 'jest-modules-esm']) {
      test.it(`E53 the documented pattern works (${suite})`, () => {
        try {
          execSync(`npm run validate:${suite}`, { env: testRunnerEnvironment(), stdio: 'pipe' })
        } catch (error) {
          // @ts-expect-error
          assert.fail(`The module mock checks failed:\n${error.stdout.toString()}${error.stderr.toString()}`)
        }
      })
    }
  })

  // Round 18 (R17FE-5, E125): tsx puts the whole file on one line; the line rules must still follow the source's lines
  // (test-runners/tsx-lines). Each run must give what the same checks give with a statement per line.
  test.describe('tsx', () => {
    const documented = {
      results: {
        'map didNotReceive on the next line': 'throws: Call count mismatch in @Substitute.set',
        'map received(1) on the next line': 'passes',
        'mimicked on() then didNotReceive on the next line': 'throws: Call count mismatch in @Substitute.on',
        'stored handle, didNotReceive on a later line': 'throws: Call count mismatch in @Substitute.emit',
        'check through io.to(room-b) on one line': "throws: Call count mismatch in @Substitute.to('room-b').emit",
        'check through io.to(room-b) over two lines': 'passes'
      },
      reported: ['Call count mismatch in @Substitute.m']
    }
    const runs = [
      'node --import tsx test-runners/tsx-lines/checks.ts',
      'node --require tsx/cjs test-runners/tsx-lines/checks.ts',
      'node --import tsx test-runners/tsx-lines/checks.mts'
    ]
    for (const command of runs) {
      test.it(`R17FE-5 the line rules follow the source's lines under tsx (${command})`, () => {
        const output = execSync(command, { env: testRunnerEnvironment(), stdio: 'pipe' }).toString()
        assert.deepStrictEqual(JSON.parse(output), documented)
      })
    }
  })

  testRunners.forEach(testRunner => {
    test.describe(testRunner.name, () => {
      test.it(testRunner.title ?? 'reports the Substitute exception', () => {
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
