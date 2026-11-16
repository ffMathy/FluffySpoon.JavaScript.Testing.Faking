// TD-1 / T25 A member typed only `null` and/or `undefined` (`error?: undefined`, `ownerDocument: null`) does not
// reduce SubstituteOf<T> to `never`. Such a member keeps its plain type and has no setup API.
import { Substitute, Arg, received } from '../src'
import { assert, Equals } from './helpers'

// A variant of a discriminated union, written the usual "XOR" way
interface Ok { data: string; error?: undefined }
const ok = Substitute.for<Ok>()
ok.data.returns('x')
ok.received().data
ok[received](1).data
assert<Equals<typeof ok.error, undefined>>()
const asOk: Ok = ok

interface Members {
  nothing: null
  missing: undefined
  maybeNothing?: null
  either: null | undefined
  count: number
  reset(): void
  find(id: string): null
}
const members = Substitute.for<Members>()
members.count.returns(1)
members.reset().returns()
members.find(Arg.any()).returns(null)
assert<Equals<typeof members.nothing, null>>()
assert<Equals<typeof members.missing, undefined>>()
assert<Equals<typeof members.either, null | undefined>>()
members.received().nothing = null
members.received().maybeNothing = undefined
members.received().find('1')
const asMembers: Members = members

// @ts-expect-error nothing to configure on a member that can only be null
members.nothing.returns(null)
// @ts-expect-error nothing to configure on a member that can only be undefined
ok.error.returns(undefined)

// lib.dom: Document.ownerDocument is `null`, as are the `textContent` overrides of Document and DocumentType
const doc = Substitute.for<Document>()
doc.title.returns('t')
doc.getElementById('x').returns(null)
doc.querySelector(Arg.any()).returns(null)
doc.received().getElementById('x')
assert<Equals<typeof doc.ownerDocument, null>>()
const asDocument: Document = doc
const documentType = Substitute.for<DocumentType>()
documentType.name.returns('html')
const asDocumentType: DocumentType = documentType

export { asOk, asMembers, asDocument, asDocumentType }
