// Round 8 (E34): the module-mock suite (test-runners/jest-modules) compiled by babel-jest, so that the code under test
// imports the mocked module through Babel's _interopRequireWildcard / _interopRequireDefault helpers.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test-runners/jest-modules'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['babel-jest', {
      babelrc: false,
      configFile: false,
      presets: ['@babel/preset-typescript'],
      plugins: ['@babel/plugin-transform-modules-commonjs']
    }]
  }
}
