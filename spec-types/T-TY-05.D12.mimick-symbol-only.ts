// T:TY-5 / D12 `mimick` is a symbol-only API: `sub[mimick](instance)`. The string `mimick` is never a library method,
// it is an ordinary member of T (if T has one).
import { Substitute, mimick } from '../src'

interface Calculator { add(a: number, b: number): number }
const real: Calculator = { add: (a, b) => a + b }
const calculator = Substitute.for<Calculator>()
calculator[mimick](real)
calculator[mimick]({ add: () => 0 })
// @ts-expect-error the string form is not a library method
calculator.mimick(real)
// @ts-expect-error the instance must implement T
calculator[mimick]({ subtract: (a: number, b: number) => a - b })

// A member called `mimick` is just a member.
interface Puppet {
  mimick(sound: string): string
  speak(): string
}
const puppet = Substitute.for<Puppet>()
puppet.mimick('woof').returns('WOOF')
puppet.received().mimick('woof')
puppet[mimick]({ mimick: sound => sound, speak: () => 'hi' })
