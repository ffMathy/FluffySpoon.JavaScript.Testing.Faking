import test from 'ava'
import { types } from 'util'

import { Substitute } from '../../../src'
import { SubstituteException } from '../../../src/SubstituteException'

interface Library {
  subSection: Subsection
  coreMethod: () => string
}

interface Subsection {
  (): string
  subMethod: () => string
}

test('can substitute callable interfaces', t => {
  const lib = Substitute.for<Library>()
  lib.subSection().returns('subSection as method')
  lib.subSection.returns({ subMethod: () => 'subSection as property' } as Subsection)

  t.is('subSection as method', lib.subSection())
  t.true(types.isProxy(lib.subSection), 'Expected proxy: given the context, it\'s not possible to determine the property type')
  t.is('subSection as property', lib.subSection.subMethod())

  lib.received(1).subSection()
  lib.received(2).subSection.subMethod
  t.throws(() => lib.received(3).subSection, { instanceOf: SubstituteException })
  t.throws(() => lib.received(2).subSection(), { instanceOf: SubstituteException })
})
