// E29: the spec files with performance limits, which ava.config.js leaves out, one test at a time. `npm test` runs them
// after the other tests: ava --config ava.perf.config.js --serial --concurrency=1 (the same as `serial` and
// `concurrency` below, so that running this configuration on its own behaves the same).
const config = require('./ava.config.js')

module.exports = {
	...config,
	files: config.files.filter(file => file.startsWith('!')).map(file => file.slice(1)),
	serial: true,
	concurrency: 1
}
