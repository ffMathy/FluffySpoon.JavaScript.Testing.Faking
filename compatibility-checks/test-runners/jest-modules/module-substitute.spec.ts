import { describe, expect, jest, test } from '@jest/globals'
import { notifyThroughNamespace } from './src/notify-namespace'
import { notifyThroughNamedImport } from './src/notify-named'
import { defaultOfMixedImport, verifyThroughMixedImport } from './src/notify-mixed'
import { defaultImport, notifyThroughDefaultImport } from './src/notify-default'

// Round 8 (E34): a substitute that stands in for a whole module (what a jest.mock() factory returns) is used by code
// under test through every import form. `__esModule` is an ordinary member of a substitute (as in 2.0.0-beta.4), so it
// reads as a truthy auto-substitute and the interop helpers of TypeScript (esModuleInterop) and Babel take the
// substitute as the module namespace: namespace imports, named imports and mixed `import m, { named }` reach the
// members that the test configured. A default import is then the auto-substitute `sub.default` (see
// default-factory.spec.ts for the factory that makes it the substitute itself).
//
// test/index.ts runs this suite twice, compiled by ts-jest with esModuleInterop and by babel-jest; both runs must pass.

jest.mock('./src/mailer', () => require('@fluffy-spoon/substitute').Substitute.for())

/** The substitute the factory returned, set up by the tests. */
const mailer = jest.requireMock('./src/mailer') as any

describe('E34 a substitute standing in for a whole module', () => {
  test('a namespace import (import * as m) reaches the configured members', () => {
    mailer.send('ann').returns('namespace ok')
    expect(notifyThroughNamespace('ann')).toBe('namespace ok')
    mailer.received(1).send('ann')
  })

  test('a named import (import { send }) reaches the configured members', () => {
    mailer.send('bob').returns('named ok')
    expect(notifyThroughNamedImport('bob')).toBe('named ok')
    mailer.received(1).send('bob')
  })

  test('a mixed import (import m, { verify }) reaches the configured members', () => {
    mailer.verify('cy@d.e').returns(true)
    expect(verifyThroughMixedImport('cy@d.e')).toBe(true)
    mailer.received(1).verify('cy@d.e')
    expect(defaultOfMixedImport).toBe(mailer.default)
  })

  test('a default import (import m) is the auto-substitute sub.default, whose members can be configured', () => {
    expect(defaultImport).toBe(mailer.default)
    mailer.default.send('dee').returns('default ok')
    expect(notifyThroughDefaultImport('dee')).toBe('default ok')
    mailer.default.received(1).send('dee')
  })
})
