'use strict'
// Deep imports of compiled files under dist/ are not public API, but the "exports" map keeps them working where
// Node.js can: on versions older than 12.17 (which ignore "exports"), on 14.19 or newer on 14.x and on 16.9 or newer,
// with or without `.js`. They fail on 12.17 to 12.19, all of 13.x and 14.0 to 14.12; on 12.20 to 12.22, 14.13 to
// 14.18 and 16.0 to 16.8 only the form without `.js` works. deep-import-support.js holds that table, and this script
// checks it against the Node.js version it runs on: the forms the table says work must work, the others must fail.
// The directories of the public typings (`@fluffy-spoon/substitute/dist/shared`, `.../dist/api` and
// `.../dist/api/types`), which declarations that TypeScript emits with `moduleResolution: node` can import (P34), have
// "exports" entries of their own (with the array fallback of exports["."]), and resolve to their index on every
// supported Node.js version.
// Run from a directory whose node_modules contains the extracted package tarball (with deep-import-support.js next
// to this file):
//   node deep-imports.js
// Kept to syntax and APIs that the oldest supported Node version understands (see engines in package.json).
var assert = require('assert')

var lib = require('@fluffy-spoon/substitute')
var Arg = lib.Arg
var support = require('./deep-import-support').deepImportSupport(process.version)

var load = function (specifier) {
  try {
    return { exports: require(specifier) }
  } catch (error) {
    return { error: error }
  }
}

var check = function (specifier, works, label) {
  var result = load(specifier)
  if (works) {
    assert.ok(!result.error, label + ' works on Node ' + process.version + ': ' + (result.error && result.error.message))
    assert.strictEqual(result.exports.Arg, Arg, label + ' gives the same module as the package root')
  } else {
    assert.ok(result.error, label + ' fails on Node ' + process.version +
      ' (if it works now, update deep-import-support.js, CONTRIBUTING.md and MIGRATION.md)')
    assert.ok(/NOT_EXPORTED$|^MODULE_NOT_FOUND$/.test(result.error.code), label + ': ' + result.error.code + ' ' + result.error.message)
  }
  return works ? 'works' : 'fails'
}

assert.strictEqual(require('@fluffy-spoon/substitute/package.json').name, '@fluffy-spoon/substitute', 'package.json')

// P34: the directories of the public typings, on every version.
var directory = function (name) {
  var result = load('@fluffy-spoon/substitute/dist/' + name)
  assert.ok(!result.error, 'dist/' + name + ' works on Node ' + process.version + ': ' + (result.error && result.error.message))
  return result.exports
}
assert.strictEqual(directory('api').Arg, Arg, 'dist/api gives the same module as the package root')
assert.strictEqual(directory('api/types').received, lib.received, 'dist/api/types gives the same module as the package root')
assert.ok(Arg.all() instanceof directory('shared').AllArguments, 'dist/shared gives the module the package root uses')

if (support === undefined) {
  console.log('deep import smoke test passed on Node ' + process.version + ' (deep imports not checked on this version)')
} else {
  var withoutExtension = check('@fluffy-spoon/substitute/dist/api/Arg', support.withoutExtension, 'deep import without extension')
  check('@fluffy-spoon/substitute/dist/index', support.withoutExtension, 'deep import of the index without extension')
  var withExtension = check('@fluffy-spoon/substitute/dist/api/Arg.js', support.withExtension, 'deep import with extension')
  console.log('deep import smoke test passed on Node ' + process.version +
    ' (without .js: ' + withoutExtension + ', with .js: ' + withExtension + ')')
}
