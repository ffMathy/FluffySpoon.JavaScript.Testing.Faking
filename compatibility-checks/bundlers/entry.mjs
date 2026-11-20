// F1: test/bundlers.ts bundles this file with each bundler and runs the bundle with Node.js. It reports what the
// default, named and namespace imports of the package are inside the bundle, and whether the library works there.
import Substitute, { Substitute as NamedSubstitute, Arg, received, SubstituteException } from '@fluffy-spoon/substitute'
import * as namespace from '@fluffy-spoon/substitute'

const report = {
  defaultImport: typeof Substitute,
  defaultIsNamedSubstitute: Substitute === NamedSubstitute,
  namespaceDefaultIsSubstitute: namespace.default === Substitute,
  arg: typeof Arg,
  received: typeof received,
  substituteException: typeof SubstituteException,
  namespaceKeys: Object.keys(namespace).sort(),
  undefinedNamespaceValues: Object.keys(namespace).filter(name => namespace[name] === undefined).sort()
}

try {
  const calculator = NamedSubstitute.for()
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
  report.error = String((error && error.stack) || error)
}

console.log(JSON.stringify(report))
