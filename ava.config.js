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
  cache: false,
  failFast: true,
  failWithoutAssertions: true
}
