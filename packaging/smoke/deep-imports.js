'use strict'
// Deep imports of compiled files under dist/ are not public API, but the "exports" map keeps them working
// (Node versions with subpath pattern trailer support, i.e. 14.19+ and 16.10+, and versions without "exports" support).
// Run from a directory whose node_modules contains the extracted package tarball:
//   node deep-imports.js
var assert = require('assert')

var Arg = require('@fluffy-spoon/substitute').Arg

assert.strictEqual(require('@fluffy-spoon/substitute/dist/api/Arg').Arg, Arg, 'deep import without extension')
assert.strictEqual(require('@fluffy-spoon/substitute/dist/api/Arg.js').Arg, Arg, 'deep import with extension')
assert.strictEqual(require('@fluffy-spoon/substitute/dist/index').Arg, Arg, 'deep import of the index')
assert.strictEqual(require('@fluffy-spoon/substitute/package.json').name, '@fluffy-spoon/substitute', 'package.json')

console.log('deep import smoke test passed on Node ' + process.version)
