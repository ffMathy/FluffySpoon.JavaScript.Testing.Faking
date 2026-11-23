// TD-7 / T30 In the assertion view an optional property keeps `undefined` in its type, so a check that the code under
// test cleared it compiles: `sub.received().optionalProp = undefined`.
import { Substitute, Arg, received, didNotReceive } from '../src'

interface Form {
  note?: string
  count?: number
  format?(value: number): string
  onSubmit?: (values: string[]) => void
  title: string
}
const form = Substitute.for<Form>()
const clear = (f: Form) => { f.note = undefined }
clear(form)

form.received().note = undefined
form.received().note = 'x'
form.received(1).note = Arg.any()
form.didNotReceive().count = undefined
form[received](1).note = undefined
form[didNotReceive]().count = undefined
// optional methods are still asserted as calls
form.received().format(1)
form.didNotReceive().onSubmit(Arg.any())
form.received().title = 'x'

// @ts-expect-error the property keeps its type
form.received().note = 1
// @ts-expect-error a required property does not accept undefined
form.received().title = undefined
