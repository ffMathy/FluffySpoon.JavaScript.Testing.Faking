// G:RG-9 SubstituteException is exported from the package index, so `instanceof` works without deep imports.
import SubstituteDefault, { Substitute, SubstituteException } from '../src'
import { expectType } from './helpers'

interface Calculator { add(a: number, b: number): number }
const calculator = Substitute.for<Calculator>()

try {
  calculator.received().add(1, 2)
} catch (error) {
  if (error instanceof SubstituteException) {
    expectType<string>(error.message)
    expectType<string | undefined>(error.type)
    expectType<Error>(error)
  }
}

const exception: Error = new SubstituteException('message')
expectType<typeof Substitute>(SubstituteDefault)
export { exception }
