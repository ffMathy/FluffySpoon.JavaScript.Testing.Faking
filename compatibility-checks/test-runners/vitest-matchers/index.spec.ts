import { describe, expect, test, vi } from 'vitest'
import { inspect } from 'util'
import { Substitute, Arg, configure } from '@fluffy-spoon/substitute'

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
// handlers bound to the instance that holds them). vitest's snapshots print a function as `[Function]`; its failure
// diffs print `[Function <name>]`, where the name of a substitute is the path of its `name` member.
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

describe('R8 vitest snapshots and diffs of values that hold substitutes', () => {
  test('E33 toMatchInlineSnapshot does not take substitutes for mock functions', () => {
    const state = stateWithSubstitutes()
    expect(state).toMatchInlineSnapshot(`
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
    `)
  })

  test('E33 toMatchSnapshot does not take substitutes for mock functions', () => {
    const state = stateWithSubstitutes()
    expect(state).toMatchSnapshot()
  })

  test('E33 a failing toEqual diff prints the paths', () => {
    const state = stateWithSubstitutes()
    const message = failureOf(() => expect(state).toEqual({ status: 200 })).message
    expect(message).not.toContain('MockFunction')
    expect(message).not.toContain('Maximum call stack')
  })
})

// Round 13 (E75, R12FE-1): vitest's asymmetric matchers in the expected arguments of a check or a setup match as they do
// in vitest's own equality, at the top level and nested in plain objects and arrays, and a failure message prints them
// as vitest does. Before, they were compared as values: didNotReceive() with them always passed (vitest types them
// `any`, so TypeScript accepted them), and setups with them never answered.
describe('E75 vitest asymmetric matchers in checks and setups', () => {
  interface Mailer {
    send(to: string, template: 'welcome' | 'dunning', vars?: Record<string, string | number>): Promise<{ messageId: string }>
  }

  test('didNotReceive() with them fails when a matching call was made, and received() with them passes', () => {
    const mailer = Substitute.for<Mailer>()
    void mailer.send('ann@example.com', 'welcome', { customer: 'cus_1' })
    expect(() => mailer.didNotReceive().send(expect.any(String), 'welcome', expect.anything())).toThrow(
      "Expected to receive 0 method calls matching send(Any<String>, 'welcome', Anything), but received 1."
    )
    mailer.received(1).send(expect.stringContaining('@'), 'welcome', expect.objectContaining({ customer: 'cus_1' }))
    mailer.received(1).send(expect.stringMatching(/^ann@/), 'welcome', { customer: expect.any(String) })
    mailer.didNotReceive().send(expect.any(String), 'dunning', Arg.any())
    expect(() => mailer.received(2).send(expect.stringContaining('@'), 'welcome', expect.objectContaining({ customer: 'cus_1' }))).toThrow(
      "matching send(StringContaining '@', 'welcome', ObjectContaining { customer: 'cus_1' })"
    )
  })

  test('setups with them answer the calls they match, and calls with them are setups, not calls', async () => {
    const mailer = Substitute.for<Mailer>()
    mailer.send(expect.any(String), 'dunning').resolves({ messageId: 'm1' })
    await expect(mailer.send('bob@example.com', 'dunning')).resolves.toEqual({ messageId: 'm1' })
    mailer.received(1).send(Arg.all())
    const calc = Substitute.for<any>()
    calc.add(expect.closeTo(0.3, 5), Arg.any()).returns(42)
    expect(calc.add(0.1 + 0.2, 1)).toBe(42)
    calc.received(1).add(Arg.all())
  })

  test('substitutes still compare by identity in vitest\'s own matchers', () => {
    const logger = Substitute.for<Logger>()
    const fn = vi.fn()
    fn(logger)
    expect(fn).toHaveBeenCalledWith(logger)
    expect(fn).toHaveBeenCalledWith(expect.anything())
    failureOf(() => expect(fn).toHaveBeenCalledWith(Substitute.for()))
  })
})

// R13FE-5 (E82): vi.fn(implementation) calls its implementation with `implementation.apply(this, args)`, as other
// wrappers do. With a function substitute as the implementation, the mock answers what the substitute answers for the
// call, including the same auto-substitute (with the nested setups made on it), and the call is checked on the substitute.
describe('R13FE-5 vi.fn(substitute) answers what the substitute answers', () => {
  test('the auto-substitute of the call, with its nested setups; its calls are checked on the substitute', () => {
    const fetchUser = Substitute.for<any>()
    fetchUser(1).name.returns('ann')
    const mock = vi.fn(fetchUser)
    const user = mock(1)
    expect(user.name).toBe('ann')
    user.save()
    expect(mock).toHaveBeenCalledWith(1)
    fetchUser.received(1)(1)
    fetchUser(1).received(1).save()
    expect(user).toBe(fetchUser(1))
  })

  test('a configured value, and a method of a substitute', () => {
    const api = Substitute.for<any>()
    api.getOrder(2).returns({ id: 2 })
    api.getUser(1).name.returns('bob')
    expect(vi.fn(api.getOrder)(2)).toEqual({ id: 2 })
    expect(vi.fn(api.getUser)(1).name).toBe('bob')
    api.received(1).getOrder(2)
    api.received(1).getUser(1)
  })
})

// Round 15 (E96, R14FE-4): an Arg matcher inside the sample of one of vitest's asymmetric matchers matches as the Arg
// matcher (vitest's equality asks it, through its asymmetricMatch method), in checks and setups, and in vitest's own
// toEqual. Before, vitest compared it as a plain object: setups with it never answered, received() failed and
// didNotReceive() passed although a matching call was made.
describe('E96 Arg matchers inside vitest\'s asymmetric matchers', () => {
  test('checks and setups', () => {
    const producer = Substitute.for<any>()
    producer.send({ topic: 'orders', messages: [{ key: 'o1', value: 1 }] })
    producer.received(1).send(expect.objectContaining({ topic: Arg.any('string') }))
    producer.received(1).send({ topic: 'orders', messages: expect.arrayContaining([{ key: Arg.any(), value: Arg.is((v: number) => v > 0) }]) })
    producer.didNotReceive().send(expect.objectContaining({ topic: Arg.any('number') }))
    expect(() => producer.didNotReceive().send(expect.objectContaining({ topic: Arg.any('string') }))).toThrow(
      'Expected to receive 0 method calls matching send(ObjectContaining { topic: Arg.any{string} }), but received 1.'
    )

    const repo = Substitute.for<any>()
    repo.save(expect.objectContaining({ id: Arg.any(), name: Arg.is.not((name: string) => name === '') })).returns('saved')
    expect(repo.save({ id: 7, name: 'ann', extra: true })).toBe('saved')
    expect(repo.save({ id: 7, name: '' })).not.toBe('saved')
    repo.received(2).save(Arg.all())
  })

  test('vitest\'s own equality', () => {
    expect({ id: 7, name: 'ann' }).toEqual({ id: Arg.any(), name: Arg.any('string') })
    expect([1, { id: 'x' }]).toEqual([Arg.is((n: number) => n === 1), { id: Arg.all() }])
    expect({ id: 7 }).not.toEqual({ id: Arg.any('string') })
    expect({ id: 7 }).not.toEqual({ id: Arg.is.not((n: number) => n === 7) })
    const fn = vi.fn()
    fn('a', { id: 1 })
    expect(fn).toHaveBeenCalledWith(Arg.any('string'), { id: Arg.any() })
  })

  test('Arg matchers and substitutes print as before (messages, snapshots)', () => {
    const repo = Substitute.for<any>()
    repo.find({ id: Arg.any(), tags: [Arg.all()] }, Arg.is.not((x: unknown) => x === null)).returns('found')
    repo.save(expect.objectContaining({ id: Arg.any('number') })).returns('saved')
    repo.find({ id: 1, tags: [] }, 2)
    expect(String(repo)).toBe([
      '@Substitute {',
      '  received:',
      '    find({ id: 1, tags: [] }, 2)',
      '  configured:',
      '    find({ id: Arg.any{any}, tags: [ Arg.all{} ] }, Not Arg.is{(x) => x === null}) => returns(\'found\')',
      '    save(ObjectContaining { id: Arg.any{number} }) => returns(\'saved\')',
      '}'
    ].join('\n'))
    expect({ repo, matchers: [Arg.any(), Arg.all()] }).toMatchSnapshot()
  })
})
