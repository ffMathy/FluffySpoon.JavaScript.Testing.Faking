// Round 8 (E34): the module-mock suite (test-runners/jest-modules) compiled by ts-jest with esModuleInterop, so that
// the code under test imports the mocked module through TypeScript's __importStar / __importDefault helpers.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test-runners/jest-modules'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: { esModuleInterop: true, module: 'commonjs', moduleResolution: 'node', target: 'es2019', strict: true }
    }]
  }
}
