import test, { ExecutionContext, ThrowsExpectation } from 'ava'
import * as fakeTimers from '@sinonjs/fake-timers'
import { types } from 'util'

import { Substitute, didNotReceive, received, returns } from '../../../src'
import { SubstituteException } from '../../../src/SubstituteException'

interface Library {
  subSection: Subsection
  coreMethod: () => string
}

interface Subsection {
  (): string
  subMethod: () => string
}

const throwsUncaughtException = (cb: () => any, t: ExecutionContext, expectation: ThrowsExpectation) => {
  const clock = fakeTimers.install({ toFake: ['nextTick'] })
  cb()
  t.throws(() => clock.tick(1), expectation)
  clock.uninstall()
}

test('can substitute callable interfaces', async t => {
  const lib = Substitute.for<Library>()
  lib.subSection()[returns]('subSection as method')
  lib.subSection[returns]({ subMethod: () => 'subSection as property' } as Subsection)

  t.is('subSection as method', lib.subSection())
  t.true(types.isProxy(lib.subSection), 'Expected proxy: given the context, it\'s not possible to determine the property type')
  t.is('subSection as property', lib.subSection.subMethod())

  lib[received]().subSection()
  lib[received](1).subSection()
  lib[received](2).subSection
  t.throws(() => lib[didNotReceive]().subSection(), { instanceOf: SubstituteException })
  t.throws(() => lib[received](2).subSection(), { instanceOf: SubstituteException })
  throwsUncaughtException(() => lib[received](3).subSection, t, { instanceOf: SubstituteException })
})
