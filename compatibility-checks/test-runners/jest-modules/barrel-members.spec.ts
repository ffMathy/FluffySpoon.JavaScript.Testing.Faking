import { describe, expect, jest, test } from '@jest/globals'
import { notifyThroughBarrel, verifyThroughBarrelNamespace } from './src/notify-barrel'

// Round 9 (E53, R8-ADV-1): a barrel (`export * from './mailer'`) copies the own enumerable keys of the module it
// re-exports, and a substitute has none, so a factory that returns a substitute for './mailer' leaves the barrel
// without `send`. The documented pattern: the factory returns a plain object whose members are the substitute's member
// handles (and the substitute itself, to configure and check it).
//
// test/index.ts runs this suite twice, compiled by ts-jest with esModuleInterop and by babel-jest; both runs must pass.

jest.mock('./src/mailer', () => {
  const mailer = require('@fluffy-spoon/substitute').Substitute.for()
  return { __esModule: true, default: mailer, send: mailer.send, verify: mailer.verify }
})

/** The substitute behind the module's members, set up and checked by the tests. */
const mailer = (jest.requireMock('./src/mailer') as any).default

describe('E53 a module re-exported by a barrel, mocked with a plain object of member handles', () => {
  test('a named import through the barrel reaches the setups, and the calls are checked on the substitute', () => {
    mailer.send('ann').returns('barrel ok')
    expect(notifyThroughBarrel('ann')).toBe('barrel ok')
    mailer.received(1).send('ann')
  })

  test('a namespace import through the barrel reaches the setups too', () => {
    mailer.verify('cy@d.e').returns(true)
    expect(verifyThroughBarrelNamespace('cy@d.e')).toBe(true)
    mailer.received(1).verify('cy@d.e')
    expect(() => mailer.didNotReceive().verify('cy@d.e')).toThrow('Call count mismatch')
  })
})
