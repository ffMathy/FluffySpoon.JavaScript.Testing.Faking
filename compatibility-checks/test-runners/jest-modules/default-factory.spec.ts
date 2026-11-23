import { describe, expect, jest, test } from '@jest/globals'
import { defaultImport, notifyThroughDefaultImport } from './src/notify-default'

// Round 8 (E34): the documented factory for code under test that imports the default export of a mocked module
// (`import mailer from './mailer'`): `jest.mock(path, () => ({ __esModule: true, default: sub }))`. The default import
// is then the substitute itself.
//
// test/index.ts runs this suite twice, compiled by ts-jest with esModuleInterop and by babel-jest; both runs must pass.

jest.mock('./src/mailer', () => ({ __esModule: true, default: require('@fluffy-spoon/substitute').Substitute.for() }))

/** The substitute the factory returned as the default export, set up by the tests. */
const mailer = (jest.requireMock('./src/mailer') as any).default

describe('E34 the default import of a module substitute, through the documented factory', () => {
  test('the default import is the substitute, and the setups made on it answer the code under test', () => {
    expect(defaultImport).toBe(mailer)
    mailer.send('ann').returns('default ok')
    expect(notifyThroughDefaultImport('ann')).toBe('default ok')
    mailer.received(1).send('ann')
  })
})
