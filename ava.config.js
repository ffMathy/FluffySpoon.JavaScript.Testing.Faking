module.exports = {
	files: ['spec/**/*.spec.ts', 'spec/**/*.test.ts', 'packaging/**/*.test.js'],
	typescript: {
		compile: false,
		// `npm run build:spec` compiles the specs (and the sources they import) into dist-spec/,
		// so running the tests never touches the publishable dist/ directory.
		rewritePaths: {
			'/': 'dist-spec/'
		}
	},
  // E58 (R9V-6): ava keeps its cache in node_modules/.cache/ava. With `cache: false` it creates an empty directory in
  // os.tmpdir() for every run instead, and never removes it.
  cache: true,
  failFast: true,
  failWithoutAssertions: true,
  // ava's stall timeout (10 seconds by default): how long ava waits for news from the test files before it gives up.
  // Some of them work for longer without reporting, and more so on a busy machine: the packaging checks pack a copy of
  // the repository before their first test. (A test's own t.timeout() reaches ava only once the test yields.)
  timeout: '3m'
}
