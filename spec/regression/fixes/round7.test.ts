import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg, configure, mimick, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 7: the behaviour findings of the fresh-eyes review of round 6 (R6FE-*), decided in the fix spec as E22-E28.

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

// ---- E27: __esModule (reverted by E34 in round 8) -----------------------------------------------

/** TypeScript's __importDefault (esModuleInterop), as compiled code under test runs it. */
const importDefault = (mod: any) => (mod && mod.__esModule) ? mod : { default: mod }

// Round 8 (E34) reverts E27: '__esModule' is an ordinary member again, as in 2.0.0-beta.4. The first test was changed
// accordingly (it asserted that an unconfigured read gives undefined and is not recorded); round8.test.ts covers the
// import forms.
test('R6FE-6 (E27, reverted by E34) __esModule is an ordinary member: an unconfigured read is a recorded auto-substitute', t => {
  const mailer = Substitute.for<any>()
  mailer.send('a@b.c', 'hi').returns(true)

  t.is(typeof mailer.__esModule, 'function')
  const imported = importDefault(mailer)
  t.is(imported, mailer, 'an unconfigured __esModule is truthy, so the substitute is the module namespace')
  t.is(imported.default, mailer.default, 'and its default export is the auto-substitute sub.default')
  t.true(imported.send('a@b.c', 'hi'))
  t.true(inspect(mailer).includes('__esModule'), 'the read is recorded like any other')
  t.notThrows(() => mailer.received(2).__esModule)
  t.notThrows(() => mailer.received(1).send('a@b.c', 'hi'))
})

test('R6FE-6 (E27) __esModule can still be configured through [configure]() and [mimick]', t => {
  const configured = Substitute.for<any>()
  configured[configure]().__esModule.returns(true)
  t.true(configured.__esModule)
  t.is(importDefault(configured), configured)

  const mimicking = Substitute.for<any>()
  mimicking[mimick]({ __esModule: true, default: 'the default export' })
  t.true(mimicking.__esModule)
  t.is(importDefault(mimicking).default, 'the default export')
})

// ---- E28: runtime validation for JavaScript users ---------------------------------------------

test('R6FE-5 (E28) Arg.any and Arg.any.not throw a TypeError for an unknown type name', t => {
  const any = Arg.any as unknown as (type?: unknown) => unknown
  const anyNot = Arg.any.not as unknown as (type?: unknown) => unknown
  for (const type of ['strnig', 'String', 'Object', 'nul', 'null', '', 5, null, {}]) {
    const error = t.throws(() => any(type), { instanceOf: TypeError }, String(type))
    t.regex(error.message, /^Arg\.any expects one of 'any', 'string', 'number', 'boolean', 'symbol', 'undefined', 'object', 'function', 'array', 'bigint' \(or no argument for 'any'\), but received /)
    const notError = t.throws(() => anyNot(type), { instanceOf: TypeError }, String(type))
    t.regex(notError.message, /^Arg\.any\.not expects one of /)
  }
  t.regex(t.throws(() => any('strnig')).message, /but received 'strnig'\.$/)

  // the documented names, 'bigint' and no argument keep working
  for (const type of ['any', 'string', 'number', 'boolean', 'symbol', 'undefined', 'object', 'function', 'array', 'bigint', undefined]) {
    t.notThrows(() => any(type), String(type))
    t.notThrows(() => anyNot(type), String(type))
  }
  const sub = Substitute.for<any>()
  sub.big(Arg.any('bigint' as any)).returns('a bigint')
  sub.big(Arg.any.not('bigint' as any)).returns('no bigint')
  t.is(sub.big(BigInt(1)), 'a bigint')
  t.is(sub.big(1), 'no bigint')

  // the probe of the finding: Arg.any.not('nul') used to match everything, null included
  const save = Substitute.for<any>()
  t.throws(() => save.save(anyNot('nul')).returns('not null'), { instanceOf: TypeError })
})

test('R6FE-5 (E28) mimicks() without a function throws a TypeError at the setup, naming the member', t => {
  const service = Substitute.for<any>()
  const callError = t.throws(() => service.m(1).mimicks('not a function'), { instanceOf: TypeError })
  t.is(callError.message, "mimicks() expects a function to call for @Substitute.m(1), but received 'not a function'.")
  t.regex(callError.stack!.split('\n')[1], /round7\.test\.[jt]s/, 'the stack starts at the setup')

  const propertyError = t.throws(() => service.config.mimicks({ port: 1 }), { instanceOf: TypeError })
  t.is(propertyError.message, 'mimicks() expects a function to call for @Substitute.config, but received { port: 1 }.')
  t.throws(() => service.nested.child(Arg.any()).mimicks(42), { instanceOf: TypeError, message: /for @Substitute\.nested\.child\(Arg\.any\{any\}\), but received 42\./ })
  t.throws(() => service[configure]().m(2).mimicks(), { instanceOf: TypeError, message: /for @Substitute\.m\(2\), but received no argument\./ })
  t.throws(() => service[configure]().p.mimicks(null), { instanceOf: TypeError, message: /for @Substitute\.p, but received null\./ })
  t.throws(() => service.seq(1).mimicks(() => 1, 'two'), { instanceOf: TypeError, message: /but received 'two'\./ })
  const fn = Substitute.for<any>()
  t.throws(() => fn('x').mimicks(undefined), { instanceOf: TypeError, message: /for @Substitute\('x'\), but received undefined\./ })

  // nothing was configured by the refused setups, and the code under test is not reached with a broken setup
  t.is(typeof service.m(1), 'function', 'm(1) still returns its auto-substitute')
  t.notThrows(() => service.received(1).m(1))

  // functions (substitutes included) are accepted
  service.ok(1).mimicks((x: number) => x + 1)
  t.is(service.ok(1), 2)
  const delegate = Substitute.for<any>()
  delegate(1).returns('from a substitute')
  service.viaSubstitute(1).mimicks(delegate)
  t.is(service.viaSubstitute(1), 'from a substitute')
})

// ---- E22: omitted trailing arguments ----------------------------------------------------------

interface Users {
  find(name?: string): string
  list(page?: number, size?: number): string[]
}
const findAll = (users: Users) => users.find()
const firstPage = (users: Users, options?: { size?: number }) => users.list(1, options?.size)

test('R6FE-2 (E22) an omitted trailing argument matches a literal undefined or a matcher that accepts undefined (the cases of the finding)', t => {
  const byType = Substitute.for<Users>()
  byType.find(Arg.any('undefined')).returns('all users')
  t.is(findAll(byType), 'all users')

  const byAny = Substitute.for<Users>()
  byAny.find(Arg.any()).returns('anything')
  t.is(findAll(byAny), 'anything')

  const checked = Substitute.for<Users>()
  firstPage(checked)
  t.notThrows(() => checked.received(1).list(1))
  t.notThrows(() => checked.received(1).list(1, undefined))
  t.notThrows(() => checked.received(1).list(1, Arg.any()))
  t.notThrows(() => (checked.received(1) as any).list(Arg.any(), Arg.any(), Arg.any()))

  const configured = Substitute.for<Users>()
  configured.list(1).returns(['a'])
  t.deepEqual(firstPage(configured), ['a'])
  t.deepEqual(firstPage(configured, { size: undefined }), ['a'])
})

test('R6FE-2 (E22) both directions, with literals and matchers, in setups and checks', t => {
  const c = Substitute.for<any>()
  c.set('a', 1)
  t.notThrows(() => c.received(1).set('a', 1, undefined))
  t.notThrows(() => c.received(1).set('a', 1, Arg.any()))
  t.notThrows(() => c.received(1).set('a', 1, Arg.any('undefined')))
  t.notThrows(() => c.received(1).set('a', 1, Arg.is((value: unknown) => value === undefined)))
  t.notThrows(() => c.received(1).set('a', 1, Arg.any.not('number')))
  t.notThrows(() => c.received(1).set('a', 1, undefined, undefined))
  // matchers that do not accept undefined, and other values, do not match an omitted argument
  t.notThrows(() => c.didNotReceive().set('a', 1, Arg.any('number')))
  t.notThrows(() => c.didNotReceive().set('a', 1, Arg.any.not('undefined')))
  t.notThrows(() => c.didNotReceive().set('a', 1, Arg.is((value: number) => value > 0)))
  t.notThrows(() => c.didNotReceive().set('a', 1, null))
  t.notThrows(() => c.didNotReceive().set('a', 1, 2))
  t.notThrows(() => c.didNotReceive().set('a'), 'a missing argument is not a match for a value the call has')

  c.put('a', 1, undefined)
  t.notThrows(() => c.received(1).put('a', 1))
  t.notThrows(() => c.received(1).put('a', Arg.any()))
  t.notThrows(() => c.didNotReceive().put('a', 1, 2))

  c.get('k', undefined).returns('v')
  t.is(c.get('k'), 'v')
  c.get2('k').returns('v2')
  t.is(c.get2('k', undefined), 'v2')
  t.is(c.get2('k', undefined, undefined), 'v2')
  c.get3('k', Arg.any()).returns('v3')
  t.is(c.get3('k'), 'v3')
  c.get4('k', Arg.any('number')).returns('v4')
  t.is(typeof c.get4('k'), 'function', 'a matcher that rejects undefined does not answer the shorter call')
  t.is(c.get4('k', 4), 'v4')
})

test('R6FE-2 (E22) the number of arguments still separates f(1) from f(1, 2), and Arg.all() is unchanged', t => {
  const f = Substitute.for<any>()
  f.one(1).returns('one')
  f.two(1, 2).returns('two')
  t.is(typeof f.one(1, 2), 'function')
  t.is(typeof f.two(1), 'function')
  t.is(typeof f.two(1, undefined), 'function')
  t.is(f.two(1, 2, undefined), 'two')
  t.notThrows(() => f.didNotReceive().one(1))
  t.notThrows(() => f.received(1).one(1, 2))
  t.notThrows(() => f.received(1).two(1, 2), 'two(1, 2, undefined) is two(1, 2)')
  t.notThrows(() => f.received(2).two(1), 'two(1) and two(1, undefined)')

  const log = Substitute.for<any>()
  log.log('x', Arg.all()).returns('logged')
  t.is(log.log('x'), 'logged')
  t.is(log.log('x', 1, 2), 'logged')
  t.is(typeof log.log(), 'function', 'the arguments before Arg.all() must match: a missing one is undefined')
  log.any(Arg.all()).returns('all')
  t.is(log.any(), 'all')
  t.is(log.any(undefined, 1), 'all')
  t.notThrows(() => log.received(1).log())
  t.notThrows(() => log.received(3).log(Arg.all()))
})

test('R6FE-2 (E22) received(n) and didNotReceive count calls with and without the trailing undefined, and messages show them as made', t => {
  const sub = Substitute.for<any>()
  sub.f(1)
  sub.f(1, undefined)
  sub.f()
  sub.f(undefined)
  t.notThrows(() => sub.received(2).f(1))
  t.notThrows(() => sub.received(2).f(1, undefined))
  t.notThrows(() => sub.received(2).f())
  t.notThrows(() => sub.received(2).f(undefined))
  t.notThrows(() => sub.received(4).f(Arg.any()), 'f() and f(undefined) included')
  t.notThrows(() => sub.received(2).f(Arg.any('number')))
  const message = messageOf(() => sub.didNotReceive().f(1))
  t.true(message.includes('Expected to receive 0 method calls matching f(1), but received 2.'))
  t.true(message.includes('› ✔ @Substitute.f(1)\n'))
  t.true(message.includes('› ✔ @Substitute.f(1, undefined)\n'))
  t.true(message.includes('› ✘ @Substitute.f()\n'))
  t.true(message.includes('› ✘ @Substitute.f(undefined)\n'))
  t.true(messageOf(() => sub.didNotReceive().f(Arg.any())).includes('but received 4.'), 'Arg.any() also matches f()')
})

test('R6FE-2 (E22) literal setups, re-configuration and the auto-substitute cache agree', t => {
  const sub = Substitute.for<any>()
  const request = { id: 1 }
  sub.fetch(request).returns('by identity')
  t.is(sub.fetch(request, undefined), 'by identity')
  t.is(sub.fetch({ id: 1 }, undefined), 'by identity', 'by deep equality')
  sub.load({ id: 2 }, undefined, undefined).returns('loaded')
  t.is(sub.load({ id: 2 }), 'loaded')
  for (let index = 0; index < 200; index++) sub.many(index, undefined).returns(index)
  t.is(sub.many(150), 150)

  // the same specification: the later setup replaces the earlier one
  sub.again(1).returns('first')
  sub[configure]().again(1, undefined).returns('second')
  t.is(sub.again(1), 'second')
  t.is(inspect(sub).split('again(').length - 1, 2, 'one call and one setup of again')

  // one auto-substitute for f(1) and f(1, undefined)
  t.is(sub.child(1), sub.child(1, undefined))
  sub.child(1).name.returns('ann')
  t.is(sub.child(1, undefined).name, 'ann')
  t.not(sub.child(1), sub.child(1, 2))
})

// ---- E23: new -----------------------------------------------------------------------------------

interface ApiClient { get(path: string): Promise<string> }
type ClientFactory = new (baseUrl: string) => ApiClient

/** Code under test that is given a class (or a constructor) to instantiate. */
class UserService {
  constructor(private readonly Client: ClientFactory) { }
  load() { return new this.Client('https://api').get('/users') }
}

/** Code under test that instantiates a class it finds on an injected namespace, in a class field. */
class Connection {
  private readonly client = new this.sdk.Client({ region: 'eu' })
  constructor(private readonly sdk: any) { }
  open() { return this.client.connect() }
}

const instantiate = (Klass: any, ...args: any[]) => new Klass(...args)
const createClient = (sdk: any) => new sdk.Client({ a: 1 })

test('R6FE-3 (E23) new on a substitute is a recorded call that answers with the configured object (the case of the finding)', async t => {
  const Client = Substitute.for<ClientFactory>()
  const client = Substitute.for<ApiClient>()
  client.get('/users').resolves('[]')
  ;(Client as any)('https://api').returns(client)

  t.is(await new UserService(Client).load(), '[]')
  t.notThrows(() => (Client as any).received(1)('https://api'))
  t.notThrows(() => (Client as any)[received](1)('https://api'))
  t.throws(() => (Client as any).didNotReceive()('https://api'), { instanceOf: SubstituteException })
  t.regex(inspect(Client), /received:\n {4}new @Substitute\('https:\/\/api'\)/)
  t.true(messageOf(() => (Client as any).received(2)('https://api')).includes("› ✔ new @Substitute('https://api')\n"))
})

test('R6FE-3 (E23) new on a member: recorded as new Client(args), configured with call syntax, otherwise an auto-substitute', t => {
  const ns = Substitute.for<any>()
  // in code under test (a setup on the result in the test's own expression would retract the call, D25)
  const o = createClient(ns)
  t.is(typeof o, 'function', 'an auto-substitute')
  o.connect().returns('connected')
  t.notThrows(() => ns.received(1).Client({ a: 1 }))
  t.is(ns.Client({ a: 1 }).connect(), 'connected', 'the same auto-substitute as the call')
  t.true(inspect(ns).includes('    new Client({ a: 1 })\n    Client({ a: 1 })\n'))
  const message = messageOf(() => ns.received(3).Client({ a: 1 }))
  t.true(message.includes('Expected to receive 3 method calls matching Client({ a: 1 }), but received 2.'))
  t.true(message.includes('› ✔ new @Substitute.Client({ a: 1 })\n'))
  t.true(message.includes('› ✔ @Substitute.Client({ a: 1 })\n'))

  const instance = { configured: true }
  ns.Configured(Arg.any()).returns(instance)
  t.is(new ns.Configured(1), instance)
  ns.Factory(Arg.any()).returns(() => 'a function')
  t.is(new ns.Factory(1)(), 'a function', 'a function is an object for new')
  ns.Primitive(Arg.any()).returns(5)
  const fromPrimitive = new ns.Primitive(1)
  t.is(typeof fromPrimitive, 'function', 'a primitive configured: the auto-substitute of the call')
  t.is(fromPrimitive, new ns.Primitive(1))
  t.is(ns.Primitive(1), 5, 'the call itself still answers with the primitive')
  ns.Failing(Arg.any()).throws(new Error('cannot connect'))
  t.throws(() => new ns.Failing(1), { message: 'cannot connect' })
  ns.Async(Arg.any()).resolves('ready')
  t.true(new ns.Async(1) instanceof Promise)
})

test('R6FE-3 (E23) Reflect.construct, new (sub.Member)(), class fields and a substitute passed as a class', t => {
  const Ctor = Substitute.for<any>()
  const made = { made: true }
  Ctor(Arg.all()).returns(made)
  t.is(Reflect.construct(Ctor, [1, 2]), made)
  t.is(instantiate(Ctor), made)
  t.notThrows(() => Ctor.received(1)(1, 2))
  t.notThrows(() => Ctor.received(1)())

  const ns = Substitute.for<any>()
  t.is(typeof new (ns.Member)(), 'function')
  t.notThrows(() => ns.received(1).Member())

  const sdk = Substitute.for<any>()
  sdk.Client(Arg.any()).returns({ connect: () => 'open' })
  t.is(new Connection(sdk).open(), 'open')
  t.notThrows(() => sdk.received(1).Client({ region: 'eu' }))

  // new on a bound substitute constructs it with the bound arguments first
  const Bound = ns.Bound.bind(null, 'a')
  t.is(typeof new Bound('b'), 'function')
  t.notThrows(() => ns.received(1).Bound('a', 'b'))

  // setups and checks can be written with new as well
  new ns.Late(Arg.any()).returns({ late: true })
  t.true(new ns.Late(2).late)
  new (ns[configure]().Configured)(1).returns({ configured: true })
  t.true(new ns.Configured(1).configured)
  t.notThrows(() => new (ns.received(1).Configured)(1))
})

test('R6FE-3 (E23) a mimicked class, or a class given to mimicks(), is constructed; an arrow function is called', t => {
  class Real { constructor(public readonly value: number) { } }
  const Mimicking = Substitute.for<any>()
  Mimicking[mimick](Real)
  const real = new Mimicking(3)
  t.true(real instanceof Real)
  t.is(real.value, 3)
  t.notThrows(() => Mimicking.received(1)(3))

  const holder = Substitute.for<any>()
  holder[mimick]({ Real })
  t.true(new holder.Real(4) instanceof Real)

  const factories = Substitute.for<any>()
  factories.Make(Arg.any()).mimicks(Real)
  t.is(new factories.Make(7).value, 7)
  factories.Arrow(Arg.any()).mimicks((value: number) => ({ arrow: value }))
  t.is(new factories.Arrow(8).arrow, 8)
  factories.Plain(Arg.any()).mimicks(function (this: any, value: number) { this.plain = value })
  t.is(new factories.Plain(9).plain, 9)
  factories.called(Arg.any()).mimicks(Real as any)
  t.throws(() => factories.called(1), { instanceOf: TypeError }, 'a call of a mimicked class still calls it')
})

// ---- E24: printing auto-substitutes ---------------------------------------------------------------

/** Code under test that uses a logger it gets from the application. */
const start = (app: any) => {
  app.logger.info('started')
  app.logger.info('x')
}

test('R6FE-1 (E24) an auto-substitute prints its path, and its setups and received calls when it has any', t => {
  const app = Substitute.for<any>()
  app.logger.level.returns(3)
  start(app)
  const logger = app.logger
  const expected = "@Substitute.logger {\n  received:\n    info('started')\n    info('x')\n  configured:\n    level => returns(3)\n}"
  t.is(String(logger), expected)
  t.is(inspect(logger), expected)
  t.is(`${logger}`, expected)

  // nothing to show: only the path, without a dangling ': '
  t.is(String(app.other), '@Substitute.other')
  t.is(inspect(app.getUser(1)), '@Substitute.getUser(1)')
  t.is(`${app.a.b('x', { id: 1 }).c}`, "@Substitute.a.b('x', { id: 1 }).c")
  const fn = Substitute.for<any>()
  t.is(String(fn('saved')), "@Substitute('saved')")

  const user = (() => app.getUser(2))()
  user.name.returns('ann')
  t.is(inspect(user), "@Substitute.getUser(2) {\n  configured:\n    name => returns('ann')\n}")
  t.is(inspect({ user, n: 1 }), "{\n  user: @Substitute.getUser(2) {\n    configured:\n      name => returns('ann')\n  },\n  n: 1\n}")
})

test('R6FE-1 (E24) the root shows the setups and calls of its auto-substitutes under their paths, in order', t => {
  const app = Substitute.for<any>()
  app.logger.level.returns(3)
  app.getUser(1).name.returns('ann')
  start(app)
  app.save({ id: 1 })
  t.is(inspect(app), [
    '@Substitute {',
    '  received:',
    '    logger',
    "    logger.info('started')",
    '    logger',
    "    logger.info('x')",
    '    save({ id: 1 })',
    '  configured:',
    '    logger.level => returns(3)',
    "    getUser(1).name => returns('ann')",
    '}'
  ].join('\n'))
  t.is(inspect(Substitute.for<any>()), '@Substitute {\n}', 'an empty substitute is unchanged')
})

test('R6FE-1 (E24) an auto-substitute among the arguments of a failure message, or of another printout, shows its path', t => {
  const bus = Substitute.for<any>()
  const user = Substitute.for<any>()
  const app = Substitute.for<any>()
  app.child.name.returns('configured, but only the path is shown')
  bus.emit('created', user)
  bus.emit('created', app.child)
  const message = messageOf(() => bus.received(1).emit('deleted', user))
  t.true(message.includes("› ✘ @Substitute.emit('created', @Substitute)\n"))
  t.true(message.includes("› ✘ @Substitute.emit('created', @Substitute.child)\n"))
  t.false(message.includes('property<'))
  t.is(inspect(bus), "@Substitute {\n  received:\n    emit('created', @Substitute)\n    emit('created', @Substitute.child)\n}")
  t.is(String(app.save(app.child)), '@Substitute.save(@Substitute.child)')

  // the other views of a member print their paths too
  const both = Substitute.for<any>()
  both.value(2).returns(3)
  both.value.returns(1)
  t.is(String(both.value), '@Substitute.value', 'a member configured as a property and as a method')
  t.is(String(both[configure]().make(Arg.any())), '@Substitute.make(Arg.any{any}) (configure)')
})

// ---- E25: freeze, seal, preventExtensions, defineProperty ------------------------------------------

/** Code under test that freezes the options it is given (the case of the finding). */
class FrozenOptionsService {
  private readonly options: any
  constructor(options: any) { this.options = Object.freeze(options) }
  label() { return `${this.options.name} (${this.options.timeout})` }
}

test('R6FE-4 (E25) a frozen, sealed or non-extensible substitute keeps working', t => {
  const options = Substitute.for<any>()
  options.name.returns('billing')
  options.timeout.returns(30)
  t.is(new FrozenOptionsService(options).label(), 'billing (30)')
  t.true(Object.isFrozen(options))
  t.notThrows(() => options.received(1).name)

  for (const [operation, change] of [['freeze', Object.freeze], ['seal', Object.seal], ['preventExtensions', Object.preventExtensions]] as const) {
    const sub = Substitute.for<any>()
    t.false(Object.isFrozen(sub), operation)
    t.true(Object.isExtensible(sub), operation)
    t.is((change as (value: unknown) => unknown)(sub), sub, operation)
    t.false(Object.isExtensible(sub), operation)
    t.true(Object.isFrozen(sub) && Object.isSealed(sub), `${operation}: a substitute without own properties counts as frozen`)
    t.is(String(sub.name), '@Substitute.name', operation)
    t.is(String(sub.length), '@Substitute.length', operation)
    sub.f(1).returns(2)
    t.is(sub.f(1), 2, operation)
    sub.child.value.returns('nested')
    t.is(sub.child.value, 'nested', operation)
    sub.x = 1
    t.notThrows(() => sub.received(1).x = 1, operation)
    t.notThrows(() => sub.received(1).f(1), operation)
    t.is(inspect(sub).split('\n')[0], '@Substitute {', operation)
  }

  // an auto-substitute can be frozen as well
  const app = Substitute.for<any>()
  const logger = app.logger
  Object.freeze(logger)
  logger.level.returns(3)
  t.is(app.logger.level, 3)
})

test('R6FE-4 (E25) a property defined with Object.defineProperty is a real property that reads and assignments use, not recorded', t => {
  const sub = Substitute.for<any>()
  Object.defineProperty(sub, 'tag', { value: 1, configurable: true, writable: true, enumerable: true })
  Object.defineProperty(sub, 'computed', { get: () => 7, configurable: true })
  Object.defineProperty(sub, 'fixed', { value: 'f' })
  t.is(sub.tag, 1)
  t.is(sub.computed, 7)
  t.is(sub.fixed, 'f')
  sub.tag = 2
  t.is(sub.tag, 2)
  t.deepEqual(Object.keys(sub), ['tag'])
  // E65: and the `length` and `name` that every function has, while it is extensible
  t.deepEqual(Reflect.ownKeys(sub), ['tag', 'computed', 'fixed', 'length', 'name'])
  t.deepEqual(Object.getOwnPropertyDescriptor(sub, 'tag'), { value: 2, writable: true, enumerable: true, configurable: true })
  t.deepEqual({ ...sub }, { tag: 2 })
  t.true('tag' in sub)
  t.is(inspect(sub), '@Substitute {\n}', 'reads and assignments of defined properties are not recorded')
  t.notThrows(() => sub.didNotReceive().tag)
  t.true(delete sub.tag)
  t.false('tag' in sub)
  t.is(typeof sub.tag, 'function', 'after delete, the member is an ordinary member again')

  // freezing keeps the defined values, and the rules of a frozen object apply to them
  Object.freeze(sub)
  t.is(sub.fixed, 'f')
  t.is(sub.computed, 7)
  t.throws(() => { sub.fixed = 'changed' }, { instanceOf: TypeError })
  t.is(sub.fixed, 'f')
  t.false(Reflect.deleteProperty(sub, 'fixed'))
})

test('R6FE-4 (E25) a substitute has no own properties of its own, so nothing internal shows', t => {
  const sub = Substitute.for<any>()
  // E65: only the `length` and `name` that every function has, with neutral values (not those of the internal target)
  t.deepEqual(Reflect.ownKeys(sub), ['length', 'name'])
  t.deepEqual(Object.getOwnPropertyNames(sub), ['length', 'name'])
  t.deepEqual(Object.getOwnPropertyDescriptor(sub, 'name'), { value: '', writable: false, enumerable: false, configurable: true })
  t.deepEqual(Object.getOwnPropertyDescriptor(sub, 'length'), { value: 0, writable: false, enumerable: false, configurable: true })
  t.true(Object.prototype.hasOwnProperty.call(sub, 'name'))
  t.true(delete sub.name)
  t.is(String(sub.name), '@Substitute.name')

  // the views the library hands out refuse the change with a usage error that names the operation
  const bound = sub.method.bind(null)
  const freezeError = t.throws(() => Object.freeze(bound), { instanceOf: SubstituteException })
  t.regex(freezeError.message, /^Object\.preventExtensions\(\) \(or Object\.freeze\(\), Object\.seal\(\)\) cannot be used on @Substitute\.method\.bind\(null\)/)
  t.throws(() => Object.defineProperty(sub[configure](), 'x', { value: 1 }), { instanceOf: SubstituteException, message: /^Object\.defineProperty\(\) cannot be used on @Substitute\[configure\]\(\)/ })
  t.throws(() => Object.seal(sub[received]()), { instanceOf: SubstituteException })
  t.deepEqual(Reflect.ownKeys(bound), ['length', 'name'])
  t.is(bound(1), sub.method(1), 'the bound function still works')
})

// ---- E26: the in operator ----------------------------------------------------------------------------

/** Code under test that feature-detects a member (the case of the finding). */
const close = (stream: any) => {
  if ('destroy' in stream) stream.destroy()
  else stream.end()
}

test('R6FE-8 (E26) key in sub is true for keys with a setup and for keys of a mimicked instance', t => {
  const sub = Substitute.for<any>()
  sub.flush().returns(1)
  sub.level.returns(3)
  sub.cfg.port.returns(8080)
  sub.getUser(1).name.returns('ann')
  sub[configure]().nested(Arg.any()).value.returns(1)
  for (const key of ['flush', 'level', 'cfg', 'getUser', 'nested']) t.true(key in sub, key)
  t.true(Reflect.has(sub, 'flush'))
  t.true('port' in sub.cfg)
  t.false('other' in sub.cfg)

  const stream = Substitute.for<any>()
  stream.destroy().returns(undefined)
  close(stream)
  t.notThrows(() => stream.received(1).destroy())
  t.notThrows(() => stream.didNotReceive().end())

  const mimicking = Substitute.for<any>()
  mimicking[mimick]({ flush() { return 2 } })
  t.true('flush' in mimicking)
  t.true('toString' in mimicking, 'key in instance, inherited members included')
  t.false('other' in mimicking)
  t.is(mimicking.flush(), 2)
  const fn = Substitute.for<any>()
  fn[mimick](function named() { })
  t.true('call' in fn)
})

test('R6FE-8 (E26) key in sub is false for unconfigured keys, protocol keys and the library\'s own members, and records nothing', t => {
  const sub = Substitute.for<any>()
  sub.logger.info('x') // used, but not configured
  void sub.read
  for (const key of ['logger', 'read', 'other', 'then', 'toJSON', 'call', 'apply', 'bind', 'toString', 'constructor', 'name', 'length',
    '__esModule', 'asymmetricMatch', 'received', 'didNotReceive', 'returns'])
    t.false(key in sub, key)
  for (const key of [Symbol.iterator, Symbol.asyncIterator, Symbol.hasInstance, Symbol.toPrimitive, inspect.custom, received, configure, mimick])
    t.false(key in sub, String(key))
  t.is(inspect(sub), "@Substitute {\n  received:\n    logger\n    logger.info('x')\n    read\n}", 'in records nothing')
  t.false('anything' in sub.logger)

  // a protocol key is present once it is configured
  sub[configure]()[Symbol.iterator].returns(function* () { yield 1 })
  t.true(Symbol.iterator in sub)
  sub[configure]().__esModule.returns(true)
  t.true('__esModule' in sub)
})
