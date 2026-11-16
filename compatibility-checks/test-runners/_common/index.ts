import Substitute from '@fluffy-spoon/substitute'

interface Library {
  subSection: AmbiguousSection
}

interface AmbiguousSection {
  (): string
  subMethod: () => string
}


export const ambiguousPropertyTypeAssertion = () => {
  const lib = Substitute.for<Library>()
  lib.subSection().returns('subSection as method')
  lib.subSection.returns({ subMethod: () => 'subSection as property' } as AmbiguousSection)

  // Three calls, then a property-style assertion with a finite count that a method assertion could still
  // satisfy. The member is never invoked afterwards, so the failure can only be reported on process.nextTick,
  // after the test function has returned. Every test runner must still attribute it to the test.
  lib.subSection()
  lib.subSection()
  lib.subSection()
  lib.received(2).subSection
}
