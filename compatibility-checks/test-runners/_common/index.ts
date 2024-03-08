import Substitute from '../../../src'

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

  lib.subSection()
  lib.subSection.subMethod()
  lib.received(2).subSection
}
