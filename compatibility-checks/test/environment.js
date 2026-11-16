'use strict'
// The environment the compatibility checks start each test runner with.
//
// `node --test` sets NODE_TEST_CONTEXT in every process it runs. A nested `node --test` (the node:test
// compatibility check) that inherits it believes it is a child of the outer runner: it reports its results
// to the parent instead and exits with code 0 even when its own test failed. So every NODE_TEST_* variable
// is removed. Colours are disabled so that the output can be searched for plain text.

/**
 * @param {Record<string, string | undefined>} [base]
 * @returns {Record<string, string | undefined>}
 */
const testRunnerEnvironment = (base = process.env) => {
  const environment = { ...base, CI: '1', NO_COLOR: '1' }
  delete environment.FORCE_COLOR
  for (const name of Object.keys(environment)) {
    if (name.startsWith('NODE_TEST_')) delete environment[name]
  }
  return environment
}

module.exports = { testRunnerEnvironment }
