import { describe, expect, jest, test } from '@jest/globals'
import { notifyThroughBarrel, verifyThroughBarrelNamespace } from './src/notify-barrel'

// Round 9 (E53, R8-ADV-1): the other documented pattern for code that imports through a barrel: mock the barrel itself
// (the module that the code under test imports) with a substitute.
//
// test/index.ts runs this suite twice, compiled by ts-jest with esModuleInterop and by babel-jest; both runs must pass.

jest.mock('./src/barrel', () => require('@fluffy-spoon/substitute').Substitute.for())

const barrel = jest.requireMock('./src/barrel') as any

describe('E53 a barrel mocked with a substitute', () => {
  test('named and namespace imports from the barrel reach the setups', () => {
    barrel.send('bob').returns('barrel substitute ok')
    barrel.verify('bob@d.e').returns(true)
    expect(notifyThroughBarrel('bob')).toBe('barrel substitute ok')
    expect(verifyThroughBarrelNamespace('bob@d.e')).toBe(true)
    barrel.received(1).send('bob')
    barrel.received(1).verify('bob@d.e')
  })
})
