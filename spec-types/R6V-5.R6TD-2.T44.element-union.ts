// R6V-5 / R6TD-2 / T44 A substitute of a large concrete union (every lib.dom element type) type-checks about as fast
// as in 2.0.1 before T42: its members whose variants declare different parameter lists (`addEventListener`,
// `removeEventListener`, `remove`) get one set of signatures per distinct parameter list (T49), and the parameter lists
// of the elements' listener methods differ only where their event maps differ, so there are a few of them, not one per
// element. spec-types/R6V-5.R6TD-2.T44.check-cost.js (run by `npm run test:types:min-ts`) checks the cost of this file.
// The setups and checks below must keep compiling.
import { Substitute, Arg, configure, received } from '../src'

type AnyElement = HTMLElementTagNameMap[keyof HTMLElementTagNameMap]
const element = Substitute.for<AnyElement>()
element.hasAttribute('a').returns(true)
element.cloneNode().returns(document.createElement('div'))
element.getAttribute('a').returns('b')
element.id.returns('x')
element[configure]().focus().returns()
element.received().click()
element.addEventListener('click', Arg.any())
element.addEventListener('click', () => undefined).returns()
element.addEventListener('keydown', (event: Event) => event.type.length).returns()
element.removeEventListener('click', Arg.all()).returns()
element[received](1).addEventListener('click', Arg.any())
element.remove().returns()
const asElement: AnyElement = element
// @ts-expect-error the listener methods return nothing
element.addEventListener('click', Arg.any()).returns(1)
// @ts-expect-error the event name keeps its type
element.addEventListener(1, Arg.any())

// Variants whose callback types differ only in their `this` type: callbacks are typed from the context.
const field = Substitute.for<HTMLInputElement | HTMLSelectElement>()
field.addEventListener('click', event => event.preventDefault()).returns()
field.addEventListener('input', function () { return this.value }).returns()
field.received().addEventListener('click', Arg.any())
// (For the element union above, callbacks without parameter types get no contextual type: see limitations.ts.)

const doc = Substitute.for<Document>()
doc.createElement('div').returns(document.createElement('div'))
doc.getElementById('x').returns(null)
doc.title.returns('t')
doc[configure]().createTextNode('x').returns(document.createTextNode('x'))
doc.received().querySelectorAll('x')
const asDocument: Document = doc

export { asElement, asDocument }
