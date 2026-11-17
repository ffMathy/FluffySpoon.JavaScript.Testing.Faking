// Round 9 (E53): jest with native ES modules (test-runners/jest-esm-modules), run with
// NODE_OPTIONS=--experimental-vm-modules by `npm run validate:jest-modules-esm`. No transform: the .mjs files are loaded
// as they are.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test-runners/jest-esm-modules'],
  testMatch: ['**/*.test.mjs'],
  moduleFileExtensions: ['mjs', 'js', 'json'],
  transform: {}
}
