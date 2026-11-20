// T:TY-7 Optional properties and methods (`prop?`, `method?()`) are configured and asserted like required ones.
import { Substitute, Arg, configure, received } from '../src'

interface Options {
  timeout?: number
  onDone?(): string
  format?(value: number): string
  callback?: (error: Error | null) => void
  nested?: { level: number }
}

const o = Substitute.for<Options>()
o.timeout.returns(1000)
o.timeout.returns(undefined)
o.onDone().returns('done')
o.format(1).returns('1')
o.format(Arg.any()).mimicks(value => String(value))
o.callback(null).returns()
o.nested.returns({ level: 1 })
o.received().format(1)
o.received().onDone()
o.didNotReceive().callback(Arg.any())
o.received().timeout = 5
o[received](1).timeout
o[configure]().timeout.returns(1)
o[configure]().format(Arg.all()).returns('x')

// The substitute is still an Options.
const options: Options = o
export { options }

// @ts-expect-error the configured value must have the member's type
o.timeout.returns('1000')
// @ts-expect-error wrong argument type
o.format('1')
