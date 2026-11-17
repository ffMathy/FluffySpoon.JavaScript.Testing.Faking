// E29: the spec files with performance limits (timings and ratios of timings) are left out here. `npm test` runs them
// afterwards, in an ava invocation of their own that runs one test at a time (ava.perf.config.js, --serial
// --concurrency=1), so that the other test files, which ava runs in parallel, cannot slow them down.
const timingSensitive = [
	'spec/regression/fixes/*hashing*.test.ts',
	'spec/regression/fixes/performance.test.ts',
	// these two hold one timing test each among other tests
	'spec/regression/fixes/round5.test.ts',
	'spec/regression/fixes/ported-from-a.spec.ts'
]

module.exports = {
	files: ['spec/**/*.spec.ts', 'spec/**/*.test.ts', 'packaging/**/*.test.js', ...timingSensitive.map(file => `!${file}`)],
	typescript: {
		compile: false,
		// `npm run build:spec` compiles the specs (and the sources they import) into dist-spec/,
		// so running the tests never touches the publishable dist/ directory.
		rewritePaths: {
			'/': 'dist-spec/'
		}
	},
  cache: false,
  failFast: true,
  failWithoutAssertions: true
}
