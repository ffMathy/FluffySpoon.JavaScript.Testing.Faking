import { describe, expect, jest, test } from '@jest/globals'
import { expect as expect29 } from 'expect-jest29'
import Substitute, { Arg } from '@fluffy-spoon/substitute'

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

// Round 8 (E33): snapshots and failure diffs of values that hold substitutes. pretty-format's mock serializer probes
// `_isMockFunction`, which a substitute no longer answers unless it is configured, and printing paths never recurses
// (a factory result stored on the object passed to it, handlers bound to the instance that holds them). Each one must
// finish quickly. jest's snapshots print a function as `[Function]` (without its name); its failure diffs print
// `[Function <name>]`, where the name of a substitute is the path of its `name` member.
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

describe('R8 jest snapshots and diffs of values that hold substitutes', () => {
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
    expect(message).toContain('@Substitute.getUser(1).name')
    expect(message).toContain('@Substitute.create0({ name: \'root\', child0: @Substitute.create0(…)')
    expect(message).toContain('@Substitute.handler0.bind(Widget {')
    expect(message).not.toContain('MockFunction')
  })
})

// Round 9 (E46, R8V-2, R8-ADV-2): an instance of a class that extends a substitute member is an ordinary object to
// jest: toEqual and toHaveBeenCalledWith compare its fields, and pretty-format prints them (not the substitute's path).
describe('E46 instances of classes that extend a substitute', () => {
  const modelClass = () => {
    const orm = Substitute.for<any>()
    class User extends (orm.Model as new (options: object) => object) {
      constructor(public readonly id: number, public readonly name: string) { super({ table: 'users' }) }
    }
    return { orm, User }
  }

  test('toEqual compares their fields', () => {
    const { User } = modelClass()
    expect(new User(1, 'ann')).toEqual(new User(1, 'ann'))
    expectAssertionFailure(failureOf(() => expect(new User(1, 'ann')).toEqual(new User(2, 'bob'))), 'toEqual')
  })

  test('toHaveBeenCalledWith matches them by their fields', () => {
    const { User } = modelClass()
    const save = jest.fn()
    save(new User(1, 'ann'))
    expect(save).toHaveBeenCalledWith(new User(1, 'ann'))
    expectAssertionFailure(failureOf(() => expect(save).toHaveBeenCalledWith(new User(2, 'bob'))), 'toHaveBeenCalledWith')
  })

  test('failure messages and snapshots print their fields', () => {
    const { User } = modelClass()
    const message = failureOf(() => expect(new User(1, 'ann')).toEqual({ id: 2 })).message
    expect(message).toContain('"name": "ann"')
    expect(message).not.toContain('@Substitute')
    expect(new User(3, 'cy')).toMatchInlineSnapshot(`
User {
  "id": 3,
  "name": "cy",
}
`)
  })

  test('a substitute checks calls made with them, and setups made with them answer', () => {
    const { User } = modelClass()
    const repository = Substitute.for<any>()
    repository.save(new User(1, 'ann')).returns('saved')
    expect(repository.save(new User(1, 'ann'))).toBe('saved')
    repository.received(1).save(new User(1, 'ann'))
  })
})

// Round 13 (E75, R12FE-1): jest's asymmetric matchers (expect.any, expect.anything, expect.stringContaining,
// expect.objectContaining, expect.arrayContaining, expect.closeTo, the expect.not forms) in the expected arguments of a
// check or a setup match as they do in jest's own equality, at the top level and nested in plain objects and arrays, and
// a failure message prints them as jest does. Before, they were compared as values: didNotReceive() with them always
// passed, and setups with them never answered.
describe('E75 jest asymmetric matchers in checks and setups', () => {
  test('didNotReceive() with them fails when a matching call was made, and received() with them passes', () => {
    const mailer = Substitute.for<any>()
    mailer.send('ann@example.com', 'welcome', { customer: 'cus_1', tags: ['vip'] })
    expect(() => mailer.didNotReceive().send(expect.any(String), 'welcome', expect.anything())).toThrow(
      "Expected to receive 0 method calls matching send(Any<String>, 'welcome', Anything), but received 1."
    )
    mailer.received(1).send(expect.stringContaining('@'), 'welcome', expect.objectContaining({ customer: 'cus_1' }))
    mailer.received(1).send(expect.stringMatching(/^ann@/), expect.not.stringContaining('dunning'), {
      customer: expect.any(String),
      tags: expect.arrayContaining(['vip'])
    })
    mailer.didNotReceive().send(expect.any(Number), Arg.all())
    expect(() => mailer.received(2).send(expect.stringContaining('@'), 'welcome', expect.objectContaining({ customer: 'cus_1' }))).toThrow(
      "matching send(StringContaining '@', 'welcome', ObjectContaining { customer: 'cus_1' })"
    )
  })

  test('setups with them answer the calls they match, and calls with them are setups, not calls', async () => {
    const mailer = Substitute.for<any>()
    mailer.send(expect.any(String), 'dunning').resolves({ messageId: 'm1' })
    await expect(mailer.send('bob@example.com', 'dunning')).resolves.toEqual({ messageId: 'm1' })
    expect(typeof mailer.send('bob@example.com', 'welcome')).toBe('function')
    const calc = Substitute.for<any>()
    calc.add(expect.closeTo(0.3, 5), Arg.any()).returns(42)
    expect(calc.add(0.1 + 0.2, 1)).toBe(42)
    calc.received(1).add(expect.closeTo(0.3, 5), Arg.any())
    calc.received(1).add(Arg.all())
  })

  test('substitutes still compare by identity in jest\'s own matchers', () => {
    const logger = Substitute.for<Logger>()
    const fn = jest.fn()
    fn(logger)
    expect(fn).toHaveBeenCalledWith(logger)
    expect(fn).toHaveBeenCalledWith(expect.anything())
    expectAssertionFailure(failureOf(() => expect(fn).toHaveBeenCalledWith(Substitute.for())), 'toHaveBeenCalledWith')
  })
})

// R13FE-5 (E82): jest.fn(implementation) calls its implementation with `implementation.apply(this, arguments)`, as other
// wrappers do. With a function substitute as the implementation, the mock answers what the substitute answers for the
// call, including the same auto-substitute (with the nested setups made on it), and the call is checked on the substitute.
describe('R13FE-5 jest.fn(substitute) answers what the substitute answers', () => {
  test('the auto-substitute of the call, with its nested setups; its calls are checked on the substitute', () => {
    const fetchUser = Substitute.for<any>()
    fetchUser(1).name.returns('ann')
    const mock = jest.fn(fetchUser)
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
    expect(jest.fn(api.getOrder)(2)).toEqual({ id: 2 })
    expect(jest.fn(api.getUser)(1).name).toBe('bob')
    api.received(1).getOrder(2)
    api.received(1).getUser(1)
  })
})

// Round 15 (E96, R14FE-4): an Arg matcher inside the sample of one of jest's asymmetric matchers matches as the Arg
// matcher (jest's equality asks it, through its asymmetricMatch method), in checks and setups, and in jest's own
// toEqual. Before, jest compared it as a plain object: setups with it never answered, received() failed and
// didNotReceive() passed although a matching call was made. Checked with the expect of jest 30 (this runner) and of
// jest 29 (the expect package that jest 29 uses, installed as expect-jest29).
describe('E96 Arg matchers inside jest\'s asymmetric matchers', () => {
  for (const [version, jestExpect] of [['jest 30', expect], ['jest 29', expect29]] as const) {
    test(`checks and setups (${version})`, () => {
      const producer = Substitute.for<any>()
      producer.send({ topic: 'orders', messages: [{ key: 'o1', value: 1 }] })
      producer.received(1).send(jestExpect.objectContaining({ topic: Arg.any('string') }))
      producer.received(1).send({ topic: 'orders', messages: jestExpect.arrayContaining([{ key: Arg.any(), value: Arg.is((v: number) => v > 0) }]) })
      producer.didNotReceive().send(jestExpect.objectContaining({ topic: Arg.any('number') }))
      expect(() => producer.didNotReceive().send(jestExpect.objectContaining({ topic: Arg.any('string') }))).toThrow(
        'Expected to receive 0 method calls matching send(ObjectContaining { topic: Arg.any{string} }), but received 1.'
      )

      const repo = Substitute.for<any>()
      repo.save(jestExpect.objectContaining({ id: Arg.any(), name: Arg.is.not((name: string) => name === '') })).returns('saved')
      expect(repo.save({ id: 7, name: 'ann', extra: true })).toBe('saved')
      expect(repo.save({ id: 7, name: '' })).not.toBe('saved')
      repo.received(2).save(Arg.all())
    })

    test(`jest's own equality (${version})`, () => {
      jestExpect({ id: 7, name: 'ann' }).toEqual({ id: Arg.any(), name: Arg.any('string') })
      jestExpect([1, { id: 'x' }]).toEqual([Arg.is((n: number) => n === 1), { id: Arg.all() }])
      jestExpect({ id: 7 }).not.toEqual({ id: Arg.any('string') })
      jestExpect({ id: 7 }).not.toEqual({ id: Arg.is.not((n: number) => n === 7) })
      const fn = jest.fn()
      fn('a', { id: 1 })
      jestExpect(fn).toHaveBeenCalledWith(Arg.any('string'), { id: Arg.any() })
    })
  }

  test('Arg matchers and substitutes print as before (messages, snapshots, diffs)', () => {
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
    const message = failureOf(() => expect({ id: 1, name: 'ann' }).toEqual({ id: Arg.any(), name: 'bob' })).message
    expect(message).toContain('-   "name": "bob",')
    expect(message).toContain('+   "name": "ann",')
    expect(message).not.toContain('+   "id": 1,')
  })
})
