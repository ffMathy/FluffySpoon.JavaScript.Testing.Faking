
module.exports = {
	files: ['spec/**/*.spec.ts'],
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
