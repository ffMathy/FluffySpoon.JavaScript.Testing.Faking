// R3TD-2 / T34 Checking that the code under test cleared an OPTIONAL FUNCTION-TYPED property.
// Limitation (TypeScript 3.6 to 5.9 with strictNullChecks): `widget.received().onChange = undefined` does not compile.
// In the assertion view `onChange` is callable (`widget.received().onChange('x')` checks a call), and TypeScript uses
// one type for reading and writing such a property: a type that accepts `undefined` cannot be called without a
// "possibly undefined" error. Optional properties that are not functions accept `undefined` (TD-7.T30).
// Ways around it, all checked at runtime the same way (a property set to `undefined`):
//   (widget.received() as Widget).onChange = undefined
//   widget.received().onChange = Arg.any.not('function')     (a set to any value that is not a function)
import { Substitute, SubstituteOf, Arg, received, didNotReceive } from '../src'

interface Widget {
  note?: string
  onChange?: (value: string) => void
  onClose?(): void
}
const widget = Substitute.for<Widget>()
const detach = (w: Widget) => { w.note = undefined; w.onChange = undefined }
detach(widget)

widget.received().note = undefined
// calls of optional callbacks are checked as calls
widget.received().onChange('x')
widget.received().onChange(Arg.all())
widget.didNotReceive().onClose()
widget[received](1).onChange(Arg.any())

// @ts-expect-error limitation: an optional function-typed property does not accept undefined in the assertion view
widget.received().onChange = undefined
// @ts-expect-error limitation, also in the symbol form
widget[received](1).onChange = undefined

// the ways around it
;(widget.received() as Widget).onChange = undefined
;(widget[received](1) as Widget).onChange = undefined
;(widget.didNotReceive() as Widget).onChange = undefined
;(widget[didNotReceive]() as Widget).onChange = undefined
widget.received().onChange = Arg.any.not('function')

// @ts-expect-error the cast keeps the property's type
;(widget.received() as Widget).onChange = 'x'

// The same in generic code over a constraint (T33)
export function cleared<T extends Widget>(sub: SubstituteOf<T>) {
  sub.received().note = undefined
  sub.received().onChange('x')
  ;(sub.received() as Widget).onChange = undefined
}
