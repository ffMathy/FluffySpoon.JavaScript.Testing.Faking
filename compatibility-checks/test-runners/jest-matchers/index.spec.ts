import { describe, expect, jest, test } from '@jest/globals'
import Substitute from '@fluffy-spoon/substitute'

// P28 (ENG2-7): jest treats any value whose `asymmetricMatch` member is a function as an asymmetric matcher (like
// expect.any()) and asks it whether it matches. An unconfigured member of a substitute is an auto-substitute, which is
// a function that returns a truthy value, so every comparison with a substitute "matched": a non-matching
// toHaveBeenCalledWith(substitute) passed, and toEqual(substitute) threw an internal matcher error. A substitute must
// compare like any other value: by identity.
//
// Unlike the other runners, this suite is expected to pass. test/index.ts runs it with `npm run validate:jest-matchers`.

interface Logger {
  info(message: string): void
}

/** Runs a jest assertion that must fail, and returns its error. */
const failureOf = (assertion: () => void): Error => {
  try {
    assertion()
  } catch (error) {
    return error as Error
  }
  throw new Error('The assertion passed, but it should have failed: jest treated the substitute as a matcher.')
}

/** jest's own assertion error (JestAssertionError with pass: false), not an internal error of a matcher. */
const expectAssertionFailure = (error: Error, matcherName: string) => {
  expect(error.message).not.toMatch(/Unexpected return from a matcher function/)
  expect(error.message).toContain(matcherName)
  expect((error as Error & { matcherResult?: { pass: boolean } }).matcherResult).toEqual(expect.objectContaining({ pass: false }))
}

describe('P28 jest matchers compare a substitute by identity', () => {
  test('a non-matching expect(fn).toHaveBeenCalledWith(substitute) fails', () => {
    const logger = Substitute.for<Logger>()
    const fn = jest.fn()
    fn('unrelated')
    expectAssertionFailure(failureOf(() => expect(fn).toHaveBeenCalledWith(logger)), 'toHaveBeenCalledWith')
  })

  test('expect(42).toEqual(substitute) fails with a normal assertion error', () => {
    const logger = Substitute.for<Logger>()
    expectAssertionFailure(failureOf(() => expect(42).toEqual(logger)), 'toEqual')
  })

  test('a non-matching toContainEqual(substitute) and toEqual between two substitutes fail', () => {
    const logger = Substitute.for<Logger>()
    const otherLogger = Substitute.for<Logger>()
    expectAssertionFailure(failureOf(() => expect([1, 2]).toContainEqual(logger)), 'toContainEqual')
    expectAssertionFailure(failureOf(() => expect({ logger: 'oops' }).toEqual({ logger })), 'toEqual')
    expectAssertionFailure(failureOf(() => expect(otherLogger).toEqual(logger)), 'toEqual')
  })

  test('the same substitute still matches', () => {
    const logger = Substitute.for<Logger>()
    const fn = jest.fn()
    fn(logger)
    expect(fn).toHaveBeenCalledWith(logger)
    expect(logger).toEqual(logger)
    expect({ logger }).toEqual({ logger })
    expect([1, logger]).toContainEqual(logger)
  })
})

// Round 7 (E24-E26): printing, freezing and the `in` operator of substitutes, as jest's matchers and pretty-format see
// them. jest's equality and pretty-format never use `in` on a function, and pretty-format prints a function as
// `[Function <its name>]`, so a substitute shows the path of its `name` member.
describe('R7 jest matchers and pretty-format with printing, frozen substitutes and the in operator', () => {
  test('E24 a substitute in a failure message is shown by its path, without the old internal label', () => {
    const app = Substitute.for<{ logger: Logger }>()
    const message = failureOf(() => expect(app.logger).toBe(42)).message
    expect(message).toContain('[Function @Substitute.logger.name]')
    expect(message).not.toContain('property<')
  })

  test('E25 a frozen substitute still compares by identity and is printed', () => {
    const logger = Object.freeze(Substitute.for<Logger>())
    const other = Substitute.for<Logger>()
    expect(Object.isFrozen(logger)).toBe(true)
    expect(logger).toEqual(logger)
    expect({ logger }).toEqual({ logger })
    expectAssertionFailure(failureOf(() => expect(logger).toEqual(other)), 'toEqual')
    const fn = jest.fn()
    fn(logger)
    expect(fn).toHaveBeenCalledWith(logger)
    expectAssertionFailure(failureOf(() => expect(fn).toHaveBeenCalledWith(other)), 'toHaveBeenCalledWith')
  })

  test('E26 configured members are in the substitute, and the matchers behave as before', () => {
    const settings = Substitute.for<{ level: number, flush(): void }>()
    settings.level.returns(3)
    expect('level' in settings).toBe(true)
    expect('other' in settings).toBe(false)
    expect(settings).toHaveProperty('level', 3)
    expect(jest.isMockFunction(settings)).toBe(false)
    const fn = jest.fn()
    fn(settings)
    expect(fn).toHaveBeenCalledWith(settings)
    expectAssertionFailure(failureOf(() => expect(fn).toHaveBeenCalledWith(Substitute.for())), 'toHaveBeenCalledWith')
    jest.clearAllMocks()
    expect(settings.level).toBe(3)
  })
})
