// D5 `sub[configure]()` is a view of the substitute in which member reads and calls are always setups. They expose the
// setup API (returns / throws / mimicks, and resolves / rejects for promises) and nothing else: no received /
// didNotReceive, and not the configured value.
import { Substitute, Arg, configure, returns, throws, mimicks, resolves, rejects } from '../src'
import { expectType } from './helpers'

interface Calculator {
  add(a: number, b: number): number
  divide(a: number, b: number): number
  heavyOperation(): Promise<number>
  find(id: string): string | null
  reset(): void
  isEnabled: boolean
  received(count: number): string
  returns: string[]
}

const calculator = Substitute.for<Calculator>()
const setup = calculator[configure]()
setup.add(1, 3).returns(1337)
setup.add(1, 3).returns(1, 2, 3)
setup.add(Arg.all()).mimicks((a, b) => a + b)
setup.add(Arg.any(), Arg.is(b => b > 0)).throws(new Error())
setup.divide(1, 0)[throws](new Error('Cannot divide by 0'))
setup.heavyOperation().resolves(4)
setup.heavyOperation().rejects(new Error())
setup.heavyOperation()[resolves](4)
setup.heavyOperation()[rejects](new Error())
setup.find('1').returns(null)
setup.reset().returns()
setup.isEnabled.returns(true)
setup.isEnabled[mimicks](() => false)
setup.add.returns((a, b) => a * b)
// members named like the library's methods are ordinary members here
setup.received(1).returns('one')
setup.returns.returns(['r'])
setup.returns[returns](['r'])

// @ts-expect-error the configured value must have the member's type
setup.add(1, 3).returns('1337')
// @ts-expect-error resolves() is only offered for promises
setup.add(1, 3).resolves(1)
// @ts-expect-error the view only offers the setup API, not the value
const value: number = setup.add(1, 3)
// @ts-expect-error no assertions on the configure view
calculator[configure]().received(1).add(1, 3)
// @ts-expect-error the view has no assertion methods
setup.didNotReceive()
// @ts-expect-error the view has no configure method itself
setup[configure]()

expectType<number>(calculator.add(1, 3))
export { value }

// members typed `any`
interface Loose { value: any; call: any; method(input: any): any }
const loose = Substitute.for<Loose>()
loose[configure]().call(1, 2).returns(3)
loose[configure]().value.returns(1)
loose[configure]().method(Arg.any()).returns(2)
loose.call(1).returns(3)
loose.value.returns(1)
loose.method(1).returns(2)
loose.received().call(1)
