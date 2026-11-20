// P29: test/bundlers.ts bundles this file, which imports CommonJS code that require()s the package
// (require-helper.cjs), and runs the bundle with Node.js. It reports what require() returned inside the bundle and
// whether the library works there.
import helper from './require-helper.cjs'

const { library, Substitute, Arg, received, SubstituteException } = helper

// With esmExternals, Rollup's commonjs plugin hands require() a function that carries every export as a property
// (its namespace interop), so what counts is which properties are there, not typeof.
const report = {
  requireIsSubstituteClass: typeof library === 'function' && typeof library.for === 'function',
  exportKeys: Object.keys(library).sort(),
  undefinedExportValues: Object.keys(library).filter(name => library[name] === undefined).sort(),
  substitute: typeof Substitute,
  defaultIsSubstitute: library.default === Substitute,
  arg: typeof Arg,
  received: typeof received,
  substituteException: typeof SubstituteException
}

try {
  const calculator = Substitute.for()
  calculator.add(1, Arg.any()).returns(3)
  report.returns = calculator.add(1, 2)
  calculator[received](1).add(1, 2)
  try {
    calculator.received(2).add(1, 2)
    report.failingAssertion = 'did not throw'
  } catch (error) {
    report.failingAssertion = error instanceof SubstituteException ? 'SubstituteException' : String(error)
  }
} catch (error) {
  report.error = String((error && error.message) || error)
}

console.log(JSON.stringify(report))
