// E29: the spec files with performance limits, which ava.config.js leaves out, one test at a time. `npm test` runs them
// after the other tests: ava --config ava.perf.config.js --serial --concurrency=1 (the same as `serial` and
// `concurrency` below, so that running this configuration on its own behaves the same).
const config = require('./ava.config.js')

module.exports = {
	...config,
	files: config.files.filter(file => file.startsWith('!')).map(file => file.slice(1)),
	serial: true,
	concurrency: 1,
	// Several of these tests run for more than ava's default of 10 seconds without a break (synchronous loops, child
	// processes), and on their own no other test file reports in the meantime. A test's own t.timeout() reaches ava only
	// once the test yields, so the time without news has to be longer.
	timeout: '3m'
}
