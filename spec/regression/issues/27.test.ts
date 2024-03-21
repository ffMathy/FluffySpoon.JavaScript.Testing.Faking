import test from 'ava'
import { types } from 'util'

import { Substitute } from '../../../src'

interface Library {
  subSection: () => string
}

// Adapted snipped extracted from https://github.com/angular/angular/blob/main/packages/compiler/src/parse_util.ts#L176
// This is to reproduce the behavior of the Angular compiler. This function tries to extract the id from a reference.
const identifierName = (compileIdentifier: { reference: any } | null | undefined): string | null => {
  if (!compileIdentifier || !compileIdentifier.reference) {
    return null
  }
  const ref = compileIdentifier.reference
  if (ref['__anonymousType']) {
    return ref['__anonymousType']
  }
}

test('issue 27: mocks should work with Angular TestBed', t => {
  const lib = Substitute.for<Library>()
  lib.subSection().returns('This is the mocked value')
  const result = identifierName({ reference: lib })

  t.not(result, null)
  t.true(types.isProxy(result))

  const jitId = `jit_${result}`
  t.is(jitId, 'jit_property<__anonymousType>: ')
})

test('issue 27: subsitute node can be coerced to a primitive value', t => {
  const lib = Substitute.for<Library>()
  t.true(typeof `${lib}` === 'string')
  t.true(typeof (lib + '') === 'string')
  t.is(`${lib}`, '@Substitute {\n}')
})
