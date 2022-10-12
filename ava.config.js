
module.exports = {
	files: ['spec/**/*.ts'],
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