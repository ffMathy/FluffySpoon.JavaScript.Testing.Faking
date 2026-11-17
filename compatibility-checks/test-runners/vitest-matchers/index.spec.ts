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

// Round 8 (E33): snapshots and failure diffs of values that hold substitutes. vitest's mock serializer probes
// `_isMockFunction`; answered by a truthy auto-substitute, it printed `mock.calls` without end (PrettyFormatPluginError:
// Maximum call stack size exceeded). Printing paths never recurses (a factory result stored on the object passed to it,
// handlers bound to the instance that holds them). Each one must finish quickly. vitest's snapshots print a function as
// `[Function]`; its failure diffs print `[Function <name>]`, where the name of a substitute is the path of its `name`
// member.
class Widget {
  public readonly onSave: unknown
  public readonly onClose: unknown
  constructor(bus: any) {
    this.onSave = bus.handler0.bind(this)
    this.onClose = bus.handler1.bind(this)
  }
}

/** A state object of the kind a test snapshots: an auto-substitute, a configured one, bound handlers, a factory result. */
const stateWithSubstitutes = () => {
  const app = Substitute.for<any>()
  app.config.port.returns(8080)
  const context: any = { name: 'root' }
  context.child0 = app.create0(context)
  context.child1 = app.create1(context)
  return { status: 200, user: app.getUser(1), config: app.config, widget: new Widget(Substitute.for<any>()), context }
}

/** Runs a check and returns how long it took. */
const timed = (check: () => void): number => {
  const started = Date.now()
  check()
  return Date.now() - started
}

describe('R8 vitest snapshots and diffs of values that hold substitutes', () => {
  test('E33 toMatchInlineSnapshot finishes quickly and does not take substitutes for mock functions', () => {
    const state = stateWithSubstitutes()
    expect(timed(() => expect(state).toMatchInlineSnapshot(`
      {
        "config": [Function],
        "context": {
          "child0": [Function],
          "child1": [Function],
          "name": "root",
        },
        "status": 200,
        "user": [Function],
        "widget": Widget {
          "onClose": [Function],
          "onSave": [Function],
        },
      }
    `))).toBeLessThan(2000)
  })

  test('E33 toMatchSnapshot finishes quickly and does not take substitutes for mock functions', () => {
    const state = stateWithSubstitutes()
    expect(timed(() => expect(state).toMatchSnapshot())).toBeLessThan(2000)
  })

  test('E33 a failing toEqual diff prints the paths and finishes quickly', () => {
    const state = stateWithSubstitutes()
    let message = ''
    expect(timed(() => { message = failureOf(() => expect(state).toEqual({ status: 200 })).message })).toBeLessThan(2000)
    expect(message).not.toContain('MockFunction')
    expect(message).not.toContain('Maximum call stack')
  })
})
