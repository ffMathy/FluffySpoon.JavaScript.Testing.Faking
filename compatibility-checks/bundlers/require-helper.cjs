// P29: CommonJS code that require()s the package, as a test helper written in CommonJS does. require-entry.mjs
// imports it, and test/bundlers.ts bundles that with the package kept external (and, for comparison, bundled).
'use strict'
const library = require('@fluffy-spoon/substitute')
const { Substitute, Arg, received, SubstituteException } = library

module.exports = { library, Substitute, Arg, received, SubstituteException }
