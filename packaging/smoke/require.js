'use strict'
// Smoke test of the packed package through CommonJS `require`.
// Run from a directory whose node_modules contains the extracted package tarball:
//   node require.js
// Kept to syntax and APIs that the oldest supported Node version understands (see engines in package.json).

var assert = require('assert')

var lib = require('@fluffy-spoon/substitute')
var Substitute = lib.Substitute
var Arg = lib.Arg

assert.strictEqual(typeof Substitute.for, 'function', 'Substitute.for is a function')
assert.strictEqual(lib.default, Substitute, 'the default export is Substitute')
assert.strictEqual(typeof lib.received, 'symbol', 'the received symbol is exported')

var calculator = Substitute.for()
calculator.add(1, 2).returns(3)
calculator.multiply(Arg.any(), Arg.is(function (x) { return x > 5 })).returns(42)

assert.strictEqual(calculator.add(1, 2), 3, 'returns() configures the return value')
assert.strictEqual(calculator.multiply(0, 9), 42, 'Arg matchers match')

calculator.received(1).add(1, 2)
calculator.received(1).multiply(Arg.any(), Arg.any('number'))
calculator.didNotReceive().subtract(Arg.all())

var failure
try {
  calculator.received(2).add(1, 2)
} catch (error) {
  failure = error
}
assert.ok(failure instanceof Error, 'a failing assertion throws')
assert.strictEqual(failure.name, 'SubstituteException', 'a failing assertion throws a SubstituteException')

console.log('require smoke test passed on Node ' + process.version)
