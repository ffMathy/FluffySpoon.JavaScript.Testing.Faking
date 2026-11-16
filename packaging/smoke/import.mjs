// Smoke test of the packed package through native ES module `import`.
// Run from a directory whose node_modules contains the extracted package tarball:
//   node import.mjs
import assert from 'assert'
import { createRequire } from 'module'

import Substitute, { Substitute as NamedSubstitute, Arg, received, returns } from '@fluffy-spoon/substitute'
import * as namespace from '@fluffy-spoon/substitute'

const require = createRequire(import.meta.url)
const cjs = require('@fluffy-spoon/substitute')

// The default import is the Substitute class, as it is for CommonJS and TypeScript consumers.
assert.strictEqual(typeof Substitute.for, 'function', 'default import: Substitute.for is a function')
assert.strictEqual(Substitute, NamedSubstitute, 'the default import is the named Substitute export')
assert.strictEqual(namespace.default, Substitute, 'namespace.default is Substitute')

// The ES module entry wraps the CommonJS build, so both module systems share one instance.
assert.strictEqual(Substitute, cjs.Substitute, 'ESM and CommonJS share the same Substitute')
assert.strictEqual(Arg, cjs.Arg, 'ESM and CommonJS share the same Arg')

// Every named export of the CommonJS build is available as a named ESM export.
const cjsNames = Object.keys(cjs).sort()
const esmNames = Object.keys(namespace).sort()
assert.deepStrictEqual(esmNames, cjsNames, 'the ESM entry exports the same names as the CommonJS entry')

const calculator = Substitute.for()
calculator.add(1, 2).returns(3)
calculator.subtract(Arg.any(), 1)[returns](7)
assert.strictEqual(calculator.add(1, 2), 3, 'returns() configures the return value')
assert.strictEqual(calculator.subtract(5, 1), 7, 'the returns symbol configures the return value')
calculator[received](1).add(1, 2)
assert.throws(() => calculator.received(2).add(1, 2), error => error.name === 'SubstituteException')

console.log('import smoke test passed on Node ' + process.version)
