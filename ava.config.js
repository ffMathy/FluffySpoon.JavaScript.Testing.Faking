
module.exports = {
	files: ['spec/**/*.spec.ts', 'spec/**/*.test.ts'],
	typescript: {
		compile: false,
		rewritePaths: {
			'/': 'dist/'
		}
	},
  cache: false,
  failFast: true,
  failWithoutAssertions: true
}
