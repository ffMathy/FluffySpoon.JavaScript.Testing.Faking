// ES module counterpart of deep-imports.js. Deep imports with an extension, like the two below, need pattern
// trailers in "exports": Node.js 14.19 or newer on 14.x, or 16.9 or newer (see deep-import-support.js).
//   node deep-imports.mjs
import assert from 'assert'
import { Arg } from '@fluffy-spoon/substitute'
import argModule from '@fluffy-spoon/substitute/dist/api/Arg.js'
import esmEntry from '@fluffy-spoon/substitute/dist/index.mjs'

assert.strictEqual(argModule.Arg, Arg, 'deep import of a compiled CommonJS file')
assert.strictEqual(typeof esmEntry.for, 'function', 'deep import of the ES module entry')

console.log('ESM deep import smoke test passed on Node ' + process.version)
