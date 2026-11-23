import test, { ExecutionContext, ThrowsExpectation } from 'ava'
import { interceptDeferredReports } from '../../helpers/deferredReports'
import { types } from 'util'

import { Substitute } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

interface Library {
  subSection: Subsection
  coreMethod: () => string
}

interface Subsection {
  (): string
  subMethod: () => string
}

const throwsUncaughtException = (cb: () => any, t: ExecutionContext, expectation: ThrowsExpectation<Error>) => {
  const clock = interceptDeferredReports()
  cb()
  t.throws(() => clock.tick(1), expectation)
  clock.uninstall()
}

test('can substitute callable interfaces', async t => {
  const lib = Substitute.for<Library>()
  lib.subSection().returns('subSection as method')
  lib.subSection.returns({ subMethod: () => 'subSection as property' } as Subsection)

  t.is('subSection as method', lib.subSection())
  t.true(types.isProxy(lib.subSection), 'Expected proxy: given the context, it\'s not possible to determine the property type')
  t.is('subSection as property', lib.subSection.subMethod())

  lib.received().subSection()
  lib.received(1).subSection()
  lib.received(2).subSection
  t.throws(() => lib.didNotReceive().subSection(), { instanceOf: SubstituteException })
  t.throws(() => lib.received(2).subSection(), { instanceOf: SubstituteException })
  // D9: fails both as a property read (2 reads) and as a method call (1 call), so it throws synchronously
  t.throws(() => lib.received(3).subSection, { instanceOf: SubstituteException })
  // D9: genuinely ambiguous (2 property reads, but received(1).subSection() would pass), so only reported later
  throwsUncaughtException(() => lib.received(1).subSection, t, { instanceOf: SubstituteException })
})
