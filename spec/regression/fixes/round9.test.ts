import test from 'ava'
import { inspect, isDeepStrictEqual } from 'util'

import { Substitute, Arg, configure, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 9: the behaviour findings of round 8 (R8V-*, R8-ADV-*, R8FE-*) assigned to engine B, decided in the fix spec as
// E46-E52.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message)
  }
  throw new Error('expected the assertion to fail')
}

/** What a substitute recorded and has configured, without the colours. */
const printout = (substitute: unknown) => plain(inspect(substitute))

// ---- E46: objects that inherit from a substitute are ordinary objects --------------------------------------------

class RealBase {
  constructor(public readonly name?: string) { }
}

test('R8V-2 (E46) an instance of a class that extends an unconfigured substitute member is an ordinary argument: recorded, checked and matched', t => {
  const sdk = Substitute.for<any>()
  class Plugin extends (sdk.Base as typeof RealBase) {
    public readonly id: string
    constructor(id: string) {
      super(id)
      this.id = id
    }
    describe() { return `plugin ${this.id}` }
  }
  const plugin = new Plugin('audit')
  t.is(plugin.describe(), 'plugin audit')
  const host = Substitute.for<any>()

  const answer = host.register(plugin)
  t.true(typeof answer === 'function', 'the auto-substitute of the call, not a configure view')
  t.false(printout(answer).includes('(configure)'))
  t.notThrows(() => host.received(1).register(plugin))
  t.notThrows(() => host.received(1).register(Arg.any()))
  t.notThrows(() => host.received(1).register(Arg.is(value => value instanceof Plugin)))
  t.throws(() => host.didNotReceive().register(plugin), { instanceOf: SubstituteException })

  // a setup made with an instance answers the call made with it, and one made with an equal instance (deep equality)
  const other = Substitute.for<any>()
  other.register(plugin).returns('ok')
  t.is(other.register(plugin), 'ok')
  other.register(new Plugin('copy')).returns('copy ok')
  t.is(other.register(new Plugin('copy')), 'copy ok')
  t.true(isDeepStrictEqual(new Plugin('copy'), new Plugin('copy')))

  // the matcher scan and the library's other probes recorded nothing on sdk: only the class definition's read of
  // Base.prototype and the construction
  t.is(printout(sdk), "@Substitute {\n  received:\n    Base.prototype\n    new Base('audit')\n" + "    new Base('copy')\n".repeat(4) + '}')
  // and a message that prints such an instance as an argument records nothing either
  const message = messageOf(() => host.received(2).register(plugin))
  t.true(message.includes("register(Plugin { id: 'audit' })"), message)
  t.false(printout(sdk).includes('href'))
})

test('R8V-2 (E46) instances of subclasses of a configured member, of a member that mimicks a class, and of a root substitute are ordinary arguments', t => {
  // a member whose prototype has a setup
  const sdk = Substitute.for<any>()
  sdk.Base.prototype.greet().returns('configured greeting')
  class Configured extends (sdk.Base as typeof RealBase) { }
  const configured: any = new Configured('c')
  t.is(configured.greet(), 'configured greeting', 'a configured member of the prototype answers as before')

  // a member that mimicks a class (the README example): RealBase constructs the instance
  const errors = Substitute.for<any>()
  errors.Err(Arg.all()).mimicks(RealBase)
  class MyErr extends (errors.Err as typeof RealBase) { }
  const error = new MyErr('boom')
  t.true(error instanceof MyErr)
  t.is(error.name, 'boom')

  // a class that extends a root substitute
  const Root = Substitute.for<any>()
  class FromRoot extends (Root as typeof RealBase) { }
  const fromRoot = new FromRoot('r')

  for (const [label, instance] of [['configured member', configured], ['mimicking member', error], ['root', fromRoot]] as const) {
    const logger = Substitute.for<any>()
    logger.error('failed', instance)
    t.notThrows(() => logger.received(1).error('failed', instance), label)
    t.notThrows(() => logger.received(1).error('failed', Arg.any('object')), label)
    logger.warn(instance).returns(label)
    t.is(logger.warn(instance), label)
  }
  t.false(printout(sdk).includes('Symbol('))
  t.false(printout(errors).includes('Symbol('))
  t.false(printout(Root).includes('Symbol('))
})

test('R8-ADV-2 (E46) JSON.stringify, String(), template strings and util.inspect of an instance show its own fields, not the substitute', t => {
  const orm = Substitute.for<any>()
  class User extends (orm.Model as new (options: object) => object) {
    public readonly name = 'ann'
    constructor(public readonly id: number) { super({ table: 'users' }) }
  }
  const user = new User(1)
  t.true(user instanceof User)
  t.deepEqual(Object.keys(user), ['id', 'name'])
  t.is(JSON.stringify(user), '{"id":1,"name":"ann"}')
  t.is(String(user), '[object Object]', 'Object.prototype.toString, as for an empty base class')
  t.is(`${user}`, '[object Object]')
  t.is((user as any) + 1, '[object Object]1')
  t.is(inspect(user), "User { id: 1, name: 'ann' }")
  t.is(Object.prototype.toString.call(user), '[object Object]')
  t.is((user as any).valueOf(), user)
  t.is((user as any).then, undefined)

  // a class that extends a root substitute
  const Base = Substitute.for<any>()
  class Derived extends (Base as new () => object) { public readonly k = 2 }
  t.is(JSON.stringify(new Derived()), '{"k":2}')
  t.is(inspect(new Derived()), 'Derived { k: 2 }')
  t.is(String(new Derived()), '[object Object]')

  // Object.create(sub), Object.create(sub.Member), and objects created from such instances
  const service = Substitute.for<any>()
  const created = Object.assign(Object.create(service), { a: 1 })
  const fromMember = Object.assign(Object.create(service.config), { b: 2 })
  const fromInstance = Object.assign(Object.create(user), { c: 3 })
  for (const [value, json] of [[created, '{"a":1}'], [fromMember, '{"b":2}'], [fromInstance, '{"c":3}']] as const) {
    t.is(JSON.stringify(value), json)
    t.is(String(value), '[object Object]')
    t.is(`${value}`, '[object Object]')
    t.false(inspect(value).includes('@Substitute'), inspect(value))
    const sink = Substitute.for<any>()
    sink.accept(value)
    t.notThrows(() => sink.received(1).accept(value))
  }

  // nothing of this was recorded (the class definition read Model.prototype, and `new User` constructed a Model)
  t.false(printout(orm).includes('toJSON'))
  t.false(printout(orm).includes('toString'))
  t.false(printout(orm).includes('valueOf'))
  t.false(printout(orm).includes('Symbol('))
  // (util.inspect itself reads `href` of the objects it prints on Node.js 22 and newer, to tell URLs apart; that read
  // reaches the substitute like any other read of the code under test, and is recorded)
  t.false(/toJSON|toString|valueOf|Symbol\(|then/.test(printout(service)), printout(service))
})

test('R8V-2 (E46) a class that extends a substitute, and objects that inherit from one, are no substitutes and no matchers to the library', t => {
  const sdk = Substitute.for<any>()
  class Plugin extends (sdk.Base as typeof RealBase) { }
  // a class is a function: Arg.any('object') matches substitutes, but not a class that extends one
  t.false(Arg.any('object').matches(Plugin))
  t.true(Arg.any('object').matches(sdk.Base))
  t.is((Plugin as any)[received], undefined)
  t.is((Plugin as any)[configure], undefined)
  t.is((new Plugin() as any)[received], undefined)
  t.is((new Plugin() as any)[Symbol.for('@fluffy-spoon/substitute:argument')], undefined)
  t.is(typeof (Plugin as any).toString(), 'string')
  t.true((Plugin as any).toString().startsWith('class Plugin'))

  // a static method of the class, and the class passed as an argument
  const registry = Substitute.for<any>()
  registry.add(Plugin)
  t.notThrows(() => registry.received(1).add(Plugin))
  t.notThrows(() => registry.received(1).add(Arg.any('function')))

  // an object that inherits from a substitute that mimicks or configures toString still uses it
  const named = Substitute.for<any>()
  named.toString().returns('named')
  t.is(String(Object.create(named)), 'named')
})

// ---- E47: a matcher usage error cancels only the report of its own check -----------------------------------------

const anyOf = Arg.any as unknown as (type: string) => unknown

test('R8V-1 (E47) a caught matcher usage error does not cancel the report of an earlier, unrelated check', t => {
  const clock = interceptDeferredReports()
  try {
    const s = Substitute.for<any>()
    s.m(1)
    void s.didNotReceive().m // D33: m was only invoked, so this is reported later
    try { anyOf('Strin') } catch { /* e.g. expect(() => Arg.any('Strin')).toThrow() */ }
    t.throws(() => clock.tick(), { instanceOf: SubstituteException, message: /m was called 1 time as a method/ })

    // also when the usage error is made on the same line, inside a function of its own
    void s.didNotReceive().m; t.throws(() => anyOf('Strin'), { instanceOf: TypeError })
    t.throws(() => clock.tick(), { instanceOf: SubstituteException, message: /m was called 1 time as a method/ })
  } finally {
    clock.uninstall()
  }
})

test('R8-ADV-3 (E47) a failing property-style check is still reported after a later, caught usage error', t => {
  const clock = interceptDeferredReports()
  try {
    const logger = Substitute.for<any>()
    logger.log('a')
    void logger.received(3).log
    try { Arg.is('not a function' as any) } catch { /* caught */ }
    t.throws(() => clock.tick(), { instanceOf: SubstituteException, message: /Call count mismatch in @Substitute\.log/ })

    // the check whose own argument has the usage error still reports only that error, also when it is written over
    // several lines with the arguments on the member's line
    t.throws(() => logger
      .received(2)
      .log(anyOf('String')), { instanceOf: TypeError })
    t.notThrows(() => clock.tick())
    t.throws(() => logger.received(2).log((Arg.any.not as any)('Number')), { instanceOf: TypeError })
    t.notThrows(() => clock.tick())
  } finally {
    clock.uninstall()
  }
})

// ---- E48: a check view with nothing after it ---------------------------------------------------------------------

/** The messages of the reports thrown by `tick()`, one tick per report. */
const reportsOf = (clock: ReturnType<typeof interceptDeferredReports>, count: number): string[] => {
  const messages: string[] = []
  for (let index = 0; index < count; index++) {
    try {
      clock.tick()
    } catch (error) {
      if (!(error instanceof SubstituteException)) throw error
      messages.push(plain(error.message))
    }
  }
  return messages
}

test('R8FE-10 (E48) a symbol-form check view that nothing follows is reported from a microtask as checking nothing', t => {
  const clock = interceptDeferredReports()
  try {
    const middleware = (_req: any, res: any, next: any) => { res.status(401); next() } // calls next() after responding
    const req = Substitute.for<any>()
    const res = Substitute.for<any>()
    const next = Substitute.for<any>()
    middleware(req, res, next)

    t.notThrows(() => next[didNotReceive](), 'not thrown right away')
    let messages = reportsOf(clock, 1)
    t.deepEqual(messages, ['@Substitute[didNotReceive]() checked nothing: it was not followed by a call or a member. ' +
      'Complete the check: sub[didNotReceive]()(Arg.all()) checks the calls of the substitute itself, ' +
      'sub[didNotReceive]().member(...) the calls of one of its members, and sub[didNotReceive]().member its property reads.'])

    void res[received](2)
    void req[received]()
    void req.headers[didNotReceive]()
    messages = reportsOf(clock, 1)
    t.is(messages.length, 1, 'one tick throws the first report')
    t.true(messages[0].startsWith('@Substitute[received](2) checked nothing'), messages[0])
    t.true(messages[0].includes('sub[received](2)(Arg.all())'), messages[0])
    t.true(messages[0].includes('sub[received](2).member its property reads'), messages[0])
    // (the interceptor's tick rethrows the first report; the other two were thrown as well)

    // the complete forms report nothing (and check)
    t.throws(() => next[didNotReceive]()(Arg.all()), { instanceOf: SubstituteException })
    t.notThrows(() => res[received](1).status(401))
    t.notThrows(() => { res[didNotReceive]().statusCode = 200 })
    t.throws(() => new (next[didNotReceive]() as any)(), { instanceOf: SubstituteException })
    t.notThrows(() => clock.tick())

    // printing or awaiting the view does not complete it
    void String(next[received]())
    void inspect(req.headers[received](1))
    messages = reportsOf(clock, 1)
    t.true(messages[0].startsWith('@Substitute[received]() checked nothing'), messages[0])
  } finally {
    clock.uninstall()
  }
})

test('R8FE-10 (E48) a string-form check view that nothing follows is reported, unless the member of that name is configured or checked', t => {
  const clock = interceptDeferredReports()
  try {
    const next = Substitute.for<any>()
    const res = Substitute.for<any>()
    next()
    res.status(401)

    next.didNotReceive()
    let messages = reportsOf(clock, 1)
    t.deepEqual(messages, ['@Substitute.didNotReceive() checked nothing: it was not followed by a call or a member. ' +
      'Complete the check: sub.didNotReceive()(Arg.all()) checks the calls of the substitute itself, ' +
      'sub.didNotReceive().member(...) the calls of one of its members, and sub.didNotReceive().member its property reads. ' +
      'If the substituted type has a member called didNotReceive of its own, configure its calls ' +
      '(sub[configure]().didNotReceive(Arg.all()).returns(...)): then such a call is not taken for a check.'])
    next.received(0)
    t.true(reportsOf(clock, 1)[0].startsWith('@Substitute.didNotReceive() checked nothing'), 'received(0) is didNotReceive()')
    res.received(2)
    t.true(reportsOf(clock, 1)[0].startsWith('@Substitute.received(2) checked nothing'))
    res.logger.received()
    messages = reportsOf(clock, 1)
    t.true(messages[0].startsWith('@Substitute.logger.received() checked nothing'), messages[0])
    t.true(messages[0].includes('sub.logger.received()(Arg.all())'), messages[0])
    // (the string form is still recorded as a call of a member called received, D11)
    t.true(printout(res).includes('received(2)'))

    // complete forms and setups report nothing
    t.throws(() => next.didNotReceive()(Arg.all()), { instanceOf: SubstituteException })
    t.notThrows(() => res.received(1).status(401))
    t.notThrows(() => { res.didNotReceive().statusCode = 200 })
    const ownMember = Substitute.for<any>()
    ownMember.received(1).returns('one')
    t.is(ownMember.received(1), 'one', 'a configured call of a member called received is no check')
    t.notThrows(() => clock.tick())

    // a type with a member of that name of its own: the bare call is not reported when the member gets a setup, is
    // checked as a member, or the call does not have the arguments of a check
    const inbox = Substitute.for<any>()
    inbox.received(5)
    inbox[configure]().received(Arg.any()).returns([])
    const outbox = Substitute.for<any>()
    outbox.didNotReceive()
    t.notThrows(() => outbox[received](1).didNotReceive())
    const mailbox = Substitute.for<any>()
    mailbox.received(new Date(0))
    mailbox.received(1, 2)
    mailbox.didNotReceive('x')
    void mailbox.received
    const mimicked = Substitute.for<any>()
    mimicked[mimick]({ received: (n: number) => n })
    t.is(mimicked.received(3), 3)
    t.notThrows(() => clock.tick())
  } finally {
    clock.uninstall()
  }
})

test('R8FE-10 (E48) a usage error on the view itself (freezing it) reports nothing more', t => {
  const clock = interceptDeferredReports()
  try {
    const sub = Substitute.for<any>()
    t.throws(() => Object.freeze(sub[received]()), { instanceOf: SubstituteException })
    t.throws(() => Object.defineProperty(sub[didNotReceive](), 'x', { value: 1 }), { instanceOf: SubstituteException })
    t.notThrows(() => clock.tick())
  } finally {
    clock.uninstall()
  }
})

// ---- E49: usage errors for JavaScript slips with matchers --------------------------------------------------------

test('R8FE-5 (E49) a matcher function passed without calling it to a setup or a check is a usage error that names it', t => {
  const uncalled = (name: string, call: string) => ({
    instanceOf: SubstituteException,
    message: `${name} was passed as an argument without calling it, so it would only match the function ${name} itself. Did you mean ${call}?`
  })
  const anyMatcher = Arg.any as any
  const repo = Substitute.for<any>()
  t.throws(() => repo.find(anyMatcher).returns('user'), uncalled('Arg.any', 'Arg.any()'))
  t.throws(() => repo.find(Arg.is as any).returns('user'), uncalled('Arg.is', 'Arg.is(predicate)'))
  t.throws(() => repo.find(1, Arg.any.not as any).returns('user'), uncalled('Arg.any.not', 'Arg.any.not(type)'))
  t.throws(() => repo.find(Arg.is.not as any).returns('user'), uncalled('Arg.is.not', 'Arg.is.not(predicate)'))
  t.throws(() => repo.find(Arg.all as any).returns('user'), uncalled('Arg.all', 'Arg.all()'))
  t.throws(() => repo[configure]().find(anyMatcher), uncalled('Arg.any', 'Arg.any()'))
  t.throws(() => repo.find(anyMatcher, Arg.any()).returns('user'), uncalled('Arg.any', 'Arg.any()'))
  t.false(printout(repo).includes('configured'), 'nothing was configured')

  // checks: positive and, above all, negative ones no longer pass for calls that were made
  repo.find(2)
  repo.delete(42)
  t.throws(() => repo.received(2).find(anyMatcher), uncalled('Arg.any', 'Arg.any()'))
  t.throws(() => repo.didNotReceive().delete(anyMatcher), uncalled('Arg.any', 'Arg.any()'))
  t.throws(() => repo[didNotReceive]().delete(anyMatcher), uncalled('Arg.any', 'Arg.any()'))
  t.throws(() => { repo.received().limit = anyMatcher }, uncalled('Arg.any', 'Arg.any()'))
  const next = Substitute.for<any>()
  next(new Error('boom'))
  t.throws(() => next.didNotReceive()(anyMatcher), uncalled('Arg.any', 'Arg.any()'))
  t.throws(() => next.didNotReceive()(Arg.all()), { instanceOf: SubstituteException, message: /Call count mismatch/ })

  // the functions are named after the matcher in printouts, and the code under test may still pass them around
  t.is(Arg.any.name, 'any')
  t.is(Arg.is.name, 'is')
  t.is(Arg.any.not.name, 'not')
  t.false(inspect(Arg.any).includes('inversable'), inspect(Arg.any))
  const registry = Substitute.for<any>()
  registry.register(anyMatcher)
  t.true(printout(registry).includes('register([Function: any]'), printout(registry))
})

test('R8FE-4 (E49) an Arg.is predicate that returns a promise is a usage error, and leaves no unhandled rejection', async t => {
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => { rejections.push(reason) }
  process.on('unhandledRejection', onRejection)
  try {
    const asyncPredicate = Arg.is((async (user: any) => (await Promise.resolve(user)).profile.name === 'ann') as any)
    const repo = Substitute.for<any>()
    repo.save(asyncPredicate).returns('saved')
    // the call of the code under test: the predicate rejects (no profile), and the call reports the usage error
    const usage = { instanceOf: TypeError, message: /returned a promise \(or another thenable\), but an Arg\.is predicate must return whether the value matches synchronously/ }
    t.throws(() => repo.save({ id: 1 }), usage)
    t.throws(() => repo.save({ id: 2, profile: { name: 'bob' } }), usage)
    // a check with an async predicate does not pass
    t.throws(() => repo.received(2).save(Arg.is((async () => false) as any)), usage)
    t.throws(() => repo.didNotReceive().save(Arg.is((async () => true) as any)), usage)
    // a thenable that is no promise, too
    t.throws(() => Arg.is(() => ({ then: () => undefined }) as any).matches(1), usage)
    await new Promise(resolve => setTimeout(resolve, 20))
    t.deepEqual(rejections, [], 'the rejected promises were handled')

    // a predicate that returns any other value matches when the value is truthy (as before, documented as "true")
    const named = Substitute.for<any>()
    named.greet(Arg.is((user: any) => user.name)).returns('hi')
    t.is(named.greet({ name: 'ann' }), 'hi')
    t.not(named.greet({ name: '' }), 'hi')
  } finally {
    process.removeListener('unhandledRejection', onRejection)
  }
})

// ---- E50: conversions to a primitive follow a configured or mimicked toString / valueOf ----------------------------

test('R8FE-6 (E50) a configured toString() or valueOf() is used when the code under test converts the substitute', t => {
  const describe = (id: unknown, logger: any) => logger.info(`saving ${id}`) // the code under test
  const id = Substitute.for<any>()
  id.toString().returns('u1')
  const logger = Substitute.for<any>()
  describe(id, logger)
  t.notThrows(() => logger.received(1).info('saving u1'))
  t.is(String(id), 'u1')
  t.is(`${id}`, 'u1')
  t.is(id + '!', 'u1!', "hint 'default': valueOf() is not configured, so toString() answers")
  t.notThrows(() => id.received(4).toString(), 'the conversions are calls of toString()')
  t.true(inspect(id).startsWith('@Substitute {'), 'util.inspect still shows the printout')

  const money = Substitute.for<any>()
  money.valueOf().returns(5)
  t.is((money as any) + 1, 6)
  t.true((money as any) > 3)
  t.is(String(money), '5', "hint 'string': toString() is not configured, so valueOf() answers")
  t.notThrows(() => money.received(3).valueOf())

  // a setup for other arguments, or one that does not give a primitive, leaves the printout
  const radix = Substitute.for<any>()
  radix.toString(16).returns('ff')
  t.true(String(radix).startsWith('@Substitute {'), String(radix))
  t.notThrows(() => radix.didNotReceive().toString(), 'and records nothing')
  const objectValue = Substitute.for<any>()
  objectValue.valueOf().returns({ not: 'a primitive' })
  t.true(`${objectValue}`.startsWith('@Substitute {'))
  t.true(String(Substitute.for<any>()).startsWith('@Substitute'), 'unconfigured: the printout, as before')

  // an auto-substitute, and a property setup whose value is a function
  const order = Substitute.for<any>()
  order.id.toString().returns('o-7')
  t.is(`${order.id}`, 'o-7')
  const named = Substitute.for<any>()
  named[configure]().toString.returns(() => 'named')
  t.is(`${named}`, 'named')
})

test('R8FE-6 (E50) a mimicked instance\'s toString(), valueOf() and Symbol.toPrimitive are used, its default ones are not', t => {
  const money = Substitute.for<any>()
  money[mimick]({ amount: 5, valueOf() { return 5 }, toString() { return '5 EUR' } })
  t.is(money + 1, 6)
  t.is(`${money}`, '5 EUR')
  t.true(money > 3)
  t.notThrows(() => money.received(1).toString())

  const date = Substitute.for<any>()
  date[mimick](new Date(0))
  t.is(`${date}`, String(new Date(0)))
  t.is(+date, 0)

  class Id { constructor(private readonly value: string) { } toString() { return `id:${this.value}` } }
  const id = Substitute.for<any>()
  id[mimick](new Id('7'))
  t.is(`${id}`, 'id:7')

  // a plain object or a function has only the default conversions: the printout, as before
  const config = Substitute.for<any>()
  config[mimick]({ port: 80 })
  t.true(`${config}`.startsWith('@Substitute'), `${config}`)
  const fn = Substitute.for<any>()
  fn[mimick](function real() { return 1 })
  t.true(String(fn).startsWith('@Substitute'), String(fn))
})

// ---- E51: a mimicked substitute enumerates like its instance ------------------------------------------------------

test('R8FE-2 (E51) a mimicked substitute has the instance\'s enumerable own keys: keys, entries, spread, for-in, assign, JSON', t => {
  const hidden = Symbol('hidden')
  const shown = Symbol('shown')
  const options = Object.defineProperty({ port: 80, host: 'localhost', [shown]: true }, 'secret', { value: 's', enumerable: false })
  Object.defineProperty(options, hidden, { value: 1, enumerable: false })
  const config = Substitute.for<any>()
  config[mimick](options)
  config[configure]().host.returns('example.org') // a setup still comes first

  t.true('port' in config)
  t.deepEqual(Object.keys(config), ['port', 'host'])
  t.deepEqual(Reflect.ownKeys(config), ['port', 'host', shown])
  t.deepEqual(Object.entries(config), [['port', 80], ['host', 'example.org']])
  t.deepEqual({ ...config }, { port: 80, host: 'example.org', [shown]: true })
  t.deepEqual(Object.assign({ port: 1, debug: true }, config), { port: 80, host: 'example.org', debug: true, [shown]: true })
  const forIn: string[] = []
  for (const key in config) forIn.push(key)
  t.deepEqual(forIn, ['port', 'host'])
  t.deepEqual(Object.getOwnPropertyDescriptor(config, 'port'), { value: 80, writable: true, enumerable: true, configurable: true })
  t.is(Object.getOwnPropertyDescriptor(config, 'secret'), undefined)
  t.is(JSON.stringify(config), '{"port":80,"host":"localhost"}', 'JSON.stringify serializes the instance')
  t.notThrows(() => config.received().port, 'the reads of the code under test are recorded as usual')

  // the instance's own toJSON
  const money = Substitute.for<any>()
  money[mimick]({ amount: 5, toJSON: () => '5 EUR' })
  t.is(JSON.stringify({ price: money }), '{"price":"5 EUR"}')

  // a substitute that mimicks nothing, or a function, has no keys, and JSON.stringify gives the printout as before
  const plainSub = Substitute.for<any>()
  t.deepEqual(Object.keys(plainSub), [])
  t.is(JSON.stringify(plainSub), '"@Substitute {\\n}"')
  const fn = Substitute.for<any>()
  fn[mimick](Object.assign(() => 1, { flag: true }))
  t.deepEqual(Object.keys(fn), ['flag'])
  t.true(JSON.stringify(fn).startsWith('"@Substitute'))

  // freezing and defining properties still work (E25): then the substitute's keys are the ones defined on it
  const frozen = Substitute.for<any>()
  frozen[mimick]({ a: 1 })
  t.deepEqual(Object.keys(frozen), ['a'])
  Object.freeze(frozen)
  t.true(Object.isFrozen(frozen))
  t.deepEqual(Object.keys(frozen), [])
  t.is(frozen.a, 1)
})
