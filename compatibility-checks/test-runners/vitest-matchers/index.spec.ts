import { describe, expect, test, vi } from 'vitest'
import { inspect } from 'util'
import { Substitute, configure } from '@fluffy-spoon/substitute'

// Round 7 (E24-E27, E27 reverted by E34): printing, freezing, the `in` operator and the __esModule member of substitutes, as vitest's
// matchers, its pretty-format and util.inspect see them. Unlike test-runners/vitest, this suite is expected to pass;
// test/index.ts runs it.

interface Logger {
  info(message: string): void
}

/** Runs a vitest assertion that must fail, and returns its error. */
const failureOf = (assertion: () => void): Error => {
  try {
    assertion()
  } catch (error) {
    return error as Error
  }
  throw new Error('The assertion passed, but it should have failed.')
}

describe('R7 vitest matchers with substitutes', () => {
  test('E24 a substitute is printed by its path in failure messages and by util.inspect', () => {
    const app = Substitute.for<{ logger: Logger }>()
    app.logger.info('started')
    expect(inspect(app.logger)).toBe("@Substitute.logger {\n  received:\n    info('started')\n}")
    // (printing the value for the message reads members such as `name` and `constructor`, which are recorded)
    const message = failureOf(() => expect(app.logger).toBe(42)).message
    expect(message).toContain('@Substitute.logger')
    expect(message).not.toContain('property<')
  })

  test('E25 a frozen substitute still compares by identity', () => {
    const logger = Object.freeze(Substitute.for<Logger>())
    const other = Substitute.for<Logger>()
    expect(Object.isFrozen(logger)).toBe(true)
    expect(logger).toEqual(logger)
    expect({ logger }).toStrictEqual({ logger })
    expect(failureOf(() => expect(logger).toEqual(other)).message).toContain('expected')
    const fn = vi.fn()
    fn(logger)
    expect(fn).toHaveBeenCalledWith(logger)
    failureOf(() => expect(fn).toHaveBeenCalledWith(other))
  })

  test('E26 configured members are in the substitute, and the matchers behave as before', () => {
    const settings = Substitute.for<{ level: number }>()
    settings.level.returns(3)
    expect('level' in settings).toBe(true)
    expect('other' in settings).toBe(false)
    expect(settings).toHaveProperty('level', 3)
    expect(vi.isMockFunction(settings)).toBe(false)
    const fn = vi.fn()
    fn(settings)
    expect(fn).toHaveBeenCalledWith(settings)
    failureOf(() => expect(fn).toHaveBeenCalledWith(Substitute.for()))
  })

  // Round 8 (E34) reverted E27: __esModule is an ordinary member again (this test asserted that it reads as undefined)
  test('E34 __esModule is an ordinary member, so the module interop takes a substitute as a module namespace', () => {
    const mailer = Substitute.for<{ send(to: string): boolean }>()
    mailer.send('a@b.c').returns(true)
    expect(typeof (mailer as any).__esModule).toBe('function')
    const configured = Substitute.for<any>()
    configured[configure]().__esModule.returns(false)
    expect(configured.__esModule).toBe(false)
  })
})
