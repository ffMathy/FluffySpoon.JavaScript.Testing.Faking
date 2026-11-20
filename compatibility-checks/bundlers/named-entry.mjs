// PK4-1 (P33): test/bundlers.ts bundles this file into CommonJS output while the package stays external, and runs
// the bundle with Node.js. It uses only the named import, which README "Importing" recommends for that case: there
// the default import follows Node.js's CommonJS interop and is the exports object, not the Substitute class.
import { Substitute, Arg, received, SubstituteException } from '@fluffy-spoon/substitute'

const report = {
  substitute: typeof Substitute,
  substituteFor: typeof (Substitute && Substitute.for),
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
