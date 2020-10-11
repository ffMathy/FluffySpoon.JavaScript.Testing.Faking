import { Substitute, SubstituteOf } from './Substitute'

export { Arg } from './Arguments'
export { Substitute, SubstituteOf }

export default Substitute

interface Calc {
  version: number
  add(a: number, b: number): number
}

const c = Substitute.for<Calc>()

c.add(2, 3).returns(5)
console.log(c.add(2, 3))

c.version.returns(123)
console.log(c.version)