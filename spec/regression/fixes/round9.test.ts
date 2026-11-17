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
