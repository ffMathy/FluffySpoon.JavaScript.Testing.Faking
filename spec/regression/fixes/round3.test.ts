import test, { ExecutionContext } from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { inspect, promisify, types } from 'util'

import { Substitute, Arg, configure, didNotReceive, mimick, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 3: the runtime findings of the round-2 verification (ENG2-*, V2-*), decided in the fix spec as D25-D36.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')
const withoutCallSites = (message: string) => plain(message).split('\n').filter(line => !line.includes('called at')).join('\n')

const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return withoutCallSites(error.message)
  }
  throw new Error('expected the assertion to fail')
}

/** The message of a failure that is only reported later (D9, D33); asserts that nothing is thrown before. */
const deferredMessageOf = (t: ExecutionContext, assertion: () => unknown): string => {
  const clock = interceptDeferredReports()
  try {
    t.notThrows(assertion, 'nothing is thrown synchronously')
    return withoutCallSites(t.throws<SubstituteException>(() => clock.tick(), { instanceOf: SubstituteException }).message)
  } finally {
    clock.uninstall()
  }
}

const reportsNothingLater = (t: ExecutionContext, run: () => unknown) => {
  const clock = interceptDeferredReports()
  try {
    run()
    t.notThrows(() => clock.tick())
  } finally {
    clock.uninstall()
  }
}

// ---- D25: code under test for the chain tests, in functions of its own (as in a module under test) ----

function getConnection(cache: any, driver: any) {
  cache.get('conn')
  return driver.connect('db://x')
}

class Service {
  constructor(private readonly app: any) { }
  getLogger() { return this.app.logger }
}

// test helpers in the same file as the code under test
function arrangeOpen(connection: any) {
  connection.isOpen.returns(true)
}

function arrangeCalculator(app: any) {
  app.getCalc().add(1, 2).returns(99)
}

test('ENG2-1 / V2-1 (D25) a setup or check on a value the code under test returned keeps the call that returned it', t => {
  const cache = Substitute.for<any>()
  const driver = Substitute.for<any>()
  const connection = getConnection(cache, driver)
  connection.isOpen.returns(true)
  t.true(connection.isOpen)
  t.throws(() => driver.didNotReceive().connect('db://x'), { instanceOf: SubstituteException })
  t.notThrows(() => driver.received(1).connect('db://x'))
  t.notThrows(() => cache.received(1).get('conn'))

  // V2-1: a check on the returned auto-substitute
  const factory = Substitute.for<any>()
  const connect = () => factory.create('db')
  const created = connect()
  created.didNotReceive().close()
  t.notThrows(() => factory.received(1).create('db'))

  // a nested member returned by a method, checked with the string and the symbol forms, or configured
  const app = Substitute.for<any>()
  const logger = new Service(app).getLogger()
  logger.didNotReceive().info('x')
  logger[didNotReceive]().warn('x')
  logger[configure]().level.returns(3)
  t.is(logger.level, 3)
  t.notThrows(() => app.received(1).logger)

  // a value the code under test configured nothing on, asserted with a matcher call
  const repository = Substitute.for<any>()
  const users = (() => repository.table('users'))()
  users.find(Arg.any()).returns('found')
  t.is(users.find(1), 'found')
  t.notThrows(() => repository.received(1).table('users'))
})

test('ENG2-1 (D25) a chain written over several lines in one function is still one expression', t => {
  const app = Substitute.for<any>()
  app
    .getCalc()
    .add(1, 2)
    .returns(99)
  // E24 (round 7): the root also shows the setups of its auto-substitutes, under their paths
  t.is(inspect(app), '@Substitute {\n  configured:\n    getCalc().add(1, 2) => returns(99)\n}', 'nothing of the setup is recorded')
  t.is(app.getCalc().add(1, 2), 99)
  app.received(1).getCalc()

  const service = Substitute.for<any>()
  service.logger.info('hi')
  service
    .logger
    .received(1)
    .info('hi')
  service
    .logger[received](1)
    .info('hi')
  t.notThrows(() => service.received(1).logger, 'only the real read is left')

  // the test's own stored handle, used in the same function, is part of the setup (accepted by D25)
  const settings = Substitute.for<any>()
  const handle = settings.display
  handle.level.returns(3)
  t.is(settings.display.level, 3)
  t.notThrows(() => settings.received(1).display)
})

test('ENG2-1 (D25) chains in a helper function in the same file as the code under test', t => {
  const driver = Substitute.for<any>()
  const connection = getConnection(Substitute.for<any>(), driver)
  arrangeOpen(connection)
  t.true(connection.isOpen)
  t.notThrows(() => driver.received(1).connect('db://x'))

  const app = Substitute.for<any>()
  arrangeCalculator(app)
  t.is(inspect(app), '@Substitute {\n  configured:\n    getCalc().add(1, 2) => returns(99)\n}')
  t.is(app.getCalc().add(1, 2), 99)
})

test('ENG2-1 (D25) code under test defined as an arrow function inside the test function', t => {
  const driver = Substitute.for<any>()
  const open = (url: string) => driver.connect(url)
  const connection = open('db://y')
  connection.query('select 1').returns([1])
  t.deepEqual(connection.query('select 1'), [1])
  t.notThrows(() => driver.received(1).connect('db://y'))
  t.throws(() => driver.didNotReceive().connect('db://y'), { instanceOf: SubstituteException })

  const handlers = Substitute.for<any>()
  const register = function () { return handlers.on('click') }
  register().didNotReceive().off()
  t.notThrows(() => handlers.received(1).on('click'))
})

test('ENG2-1 (D25) without stack frames (Error.stackTraceLimit = 0) adjacency alone decides', t => {
  const stackTraceLimit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    const app = Substitute.for<any>()
    app.getCalc().add(1, 2).returns(99)
    t.is(inspect(app), '@Substitute {\n  configured:\n    getCalc().add(1, 2) => returns(99)\n}')
    t.is(app.getCalc().add(1, 2), 99)

    // the fallback: a setup right after the call that returned the value retracts that call...
    const driver = Substitute.for<any>()
    const connection = getConnection(Substitute.for<any>(), driver)
    connection.isOpen.returns(true)
    t.notThrows(() => driver.didNotReceive().connect('db://x'))
    // ... unless another operation on a substitute happened in between
    const other = Substitute.for<any>()
    const kept = getConnection(Substitute.for<any>(), other)
    Substitute.for<any>().ping()
    kept.isOpen.returns(true)
    t.notThrows(() => other.received(1).connect('db://x'))
  } finally {
    Error.stackTraceLimit = stackTraceLimit
  }
})

test('ENG2-3 (D26) call/apply/bind on a function substitute or a call result behave like a direct call', t => {
  // a once()-style helper forwards with fn.apply(this, args)
  const once = (fn: any) => {
    let done = false
    let result: unknown
    return function (this: unknown, ...args: unknown[]) {
      if (!done) {
        done = true
        result = fn.apply(this, args)
      }
      return result
    }
  }
  const listener = Substitute.for<any>()
  listener('saved').returns('ack')
  t.is(once(listener)('saved'), 'ack')
  t.throws(() => listener[didNotReceive]()(Arg.all()), { instanceOf: SubstituteException })
  t.notThrows(() => listener[received](1)('saved'))
  t.notThrows(() => listener[received](1).apply(undefined, ['saved']), 'the member reading counts it too')
  t.is(inspect(listener).split('\n')[2], "    ('saved') via .apply(undefined, [ 'saved' ])", 'shown once')
  // the string forms followed by an invocation assert a direct call as well (D11 extended by D26)
  const before = inspect(listener)
  t.notThrows(() => listener.received(1)('saved'))
  t.throws(() => listener.didNotReceive()('saved'), { instanceOf: SubstituteException })
  t.throws(() => listener.received(Arg.any())('saved'), { instanceOf: SubstituteException, message: /Expected count/ })
  t.is(inspect(listener), before, 'and they are not recorded')

  const callback = Substitute.for<any>()
  callback(1).returns(5)
  t.is(callback.call(null, 1), 5)
  t.is(callback.apply(null, [1]), 5)
  t.is(callback.bind(null)(1), 5)
  t.is(callback.bind(null, 1)(), 5)
  t.notThrows(() => callback[received](4)(1))
  t.notThrows(() => callback[received](1).bind(null, 1), 'the bind call itself only counts as a call of the member bind')
  t.true(types.isProxy(callback.call(null, 9)))

  // call results and nested auto-substitutes
  const factory = Substitute.for<any>()
  factory.create()(2).returns('two')
  t.is(factory.create().call(null, 2), 'two')
  t.is(factory.create().apply(null, [2]), 'two')
  factory.handlers.onSave('x').returns('saved')
  t.is(factory.handlers.onSave.call(null, 'x'), 'saved')
  t.notThrows(() => factory.handlers.received(1).onSave('x'))

  // the thisArg reaches a mimicked function and mimicks(), also through the proxy apply trap
  const add = Substitute.for<any>()
  add[mimick](function (this: any, value: number) { return this.base + value })
  const calculator = { base: 5, add }
  t.is(calculator.add(1), 6)
  t.is(add.call({ base: 10 }, 1), 11)
  t.is(add.apply({ base: 20 }, [1]), 21)
  t.is(add.bind({ base: 30 })(1), 31)
  t.notThrows(() => add[received](4)(1))
  const scale = Substitute.for<any>()
  scale(Arg.any()).mimicks(function (this: any, value: number) { return this.factor * value })
  t.is(scale.call({ factor: 3 }, 2), 6)
  const scaler = { factor: 4, scale }
  t.is(scaler.scale(2), 8)
  const service = Substitute.for<any>()
  service[mimick]({ base: 1, plus(this: any, value: number) { return this.base + value } })
  t.is(service.plus(1), 2, 'a mimicked instance method still runs on the instance (D12)')
  t.is(service.plus.call({ base: 100 }, 1), 101, 'unless a thisArg is given')
})

test('ENG2-4 (D26) members named call/apply/bind keep their member reading', t => {
  const shop = Substitute.for<any>()
  const cart = { total: 10 }
  shop.discount.apply(cart)
  shop.socket.bind(8080)
  shop.rpc.call('getUser', 1)
  t.notThrows(() => shop.discount.received().apply(cart))
  t.notThrows(() => shop.socket.received().bind(8080))
  t.notThrows(() => shop.rpc.received().call('getUser', 1))
  t.notThrows(() => shop.rpc.received(1).call('getUser', Arg.any()))
  t.throws(() => shop.rpc.received().call('deleteUser', 1), { instanceOf: SubstituteException })
  // ... and the direct reading counts them as well (bind only when the bound function is invoked)
  t.notThrows(() => shop.received(1).rpc(1))
  t.notThrows(() => shop.received(1).discount())
  t.notThrows(() => shop.rpc.received(1)(1), 'invoking a member handle is a call of the member')
  t.notThrows(() => shop.rpc[received](1)(1))
  t.throws(() => shop.rpc[received](1)(2), { instanceOf: SubstituteException })
  t.notThrows(() => shop.received(1).socket, 'socket was only read: the bind call is a call of its member bind')
  // E24 (round 7): the call of socket's member bind is shown under its path
  t.is(inspect(shop), "@Substitute {\n  received:\n    discount() via .apply({ total: 10 })\n    socket\n    socket.bind(8080)\n    rpc(1) via .call('getUser', 1)\n}")
  const message = messageOf(() => shop.received(2).rpc(1))
  t.true(message.includes("› ✔ @Substitute.rpc(1) via .call('getUser', 1)"))

  // setups through call configure the member reading
  const app = Substitute.for<any>()
  app.rpc.call('getUser', 1).returns({ name: 'ann' })
  t.deepEqual(app.rpc.call('getUser', 1), { name: 'ann' })
  t.true(types.isProxy(app.rpc.call('deleteUser', 1)))
  t.true(types.isProxy(app.rpc(1)), 'the direct reading is not configured by it')
  app[configure]().rpc.call('list').returns(['a'])
  t.deepEqual(app.rpc.call('list'), ['a'])
  app.rpc.apply(Arg.any(), Arg.is((list: unknown[]) => list.length === 0)).returns('empty')
  t.is(app.rpc.apply(null, []), 'empty')
  app.bus.bind('topic').returns('subscription')
  t.is(app.bus.bind('topic'), 'subscription')
  t.true(types.isProxy(app.bus.bind('other')))
  t.is(inspect(app).includes('received:'), true)
  t.notThrows(() => app.rpc.received(1).call('getUser', 1))

  // a mimicked instance with a member named call answers under the member reading
  const client = Substitute.for<any>()
  client[mimick]({ call: (method: string, id: number) => `${method}:${id}` })
  t.is(client.call('getUser', 1), 'getUser:1')
  t.notThrows(() => client.received(1).call('getUser', 1))

  // a member named call configured as a property answers as a property
  const property = Substitute.for<any>()
  property[configure]().call.returns('configured')
  t.is(property.call, 'configured')
  // a substitute that mimicks an object without such a member reads it like the object does (D12)
  const plainObject = Substitute.for<any>()
  plainObject[mimick]({ name: 'x' })
  t.is(plainObject.call, undefined)
  t.is(plainObject.bind, undefined)
})

test('ENG2-5 (D27) Arg matchers nested in plain objects and arrays match deeply, and make the call a setup', t => {
  const repository = Substitute.for<any>()
  repository.save({ id: Arg.any(), name: 'bob' }).returns('saved')
  t.is(repository.save({ id: 1, name: 'bob' }), 'saved')
  t.is(repository.save({ name: 'bob', id: 'x' }), 'saved', 'in any key order')
  t.true(types.isProxy(repository.save({ id: 1, name: 'ann' })))
  t.true(types.isProxy(repository.save({ id: 1, name: 'bob', extra: true })), 'the same keys are needed')
  t.true(types.isProxy(repository.save({ name: 'bob' })))
  t.true(types.isProxy(repository.save(Object.assign(Object.create(null), { id: 1, name: 'bob' }))), 'and the same prototype')
  // D3: the setup was not recorded, the six real calls were
  repository.received(6).save(Arg.all())
  repository.received(2).save({ id: Arg.any(), name: 'bob' })
  repository.received(1).save({ id: Arg.is((id: unknown) => id === 1), name: 'bob' })
  repository.didNotReceive().save({ id: Arg.any('string'), name: 'ann' })
  t.throws(() => repository.received(1).save({ id: Arg.any('boolean') }), { instanceOf: SubstituteException })

  // arrays: the same length, item by item; Arg.all() as the last item matches the remaining items
  const list = Substitute.for<any>()
  list.add([Arg.any('number'), 'x']).returns('pair')
  t.is(list.add([1, 'x']), 'pair')
  t.true(types.isProxy(list.add([1, 'x', 2])))
  t.true(types.isProxy(list.add(['1', 'x'])))
  list.log(['level', Arg.all()]).returns('rest')
  t.is(list.log(['level']), 'rest')
  t.is(list.log(['level', 1, { a: 2 }]), 'rest')
  t.true(types.isProxy(list.log(['other'])))
  t.throws(() => list.find([Arg.all(), 1]), { instanceOf: SubstituteException, message: /must be the last item/ })

  // deep nesting, null-prototype objects, symbol keys, Arg.all() as an object value
  const key = Symbol('key')
  const deep = Substitute.for<any>()
  deep.post({ body: { items: [{ sku: Arg.is((sku: string) => sku.startsWith('A')) }] }, [key]: Arg.all() }).returns('deep')
  t.is(deep.post({ body: { items: [{ sku: 'A-1' }] }, [key]: undefined }), 'deep')
  t.true(types.isProxy(deep.post({ body: { items: [{ sku: 'B-1' }] }, [key]: 1 })))
  t.true(types.isProxy(deep.post({ body: { items: [{ sku: 'A-1' }] } })))
  deep.put(Object.assign(Object.create(null), { id: Arg.any() })).returns('bare')
  t.is(deep.put(Object.assign(Object.create(null), { id: 7 })), 'bare')

  // D4: ranked "with-predicate": a literal setup wins, and it wins over a wildcard
  const ranked = Substitute.for<any>()
  ranked.get(Arg.all()).returns('wildcard')
  ranked.get({ id: Arg.any() }).returns('nested')
  ranked[configure]().get({ id: 1 }).returns('literal') // get({ id: 1 }) already answers 'nested' (D5)
  t.is(ranked.get({ id: 1 }), 'literal')
  t.is(ranked.get({ id: 2 }), 'nested')
  t.is(ranked.get(3), 'wildcard')
  // re-configuring the same nested specification replaces it
  ranked.get({ id: Arg.any() }).returns('nested again')
  t.is(ranked.get({ id: 2 }), 'nested again')
  t.is(inspect(ranked).split('nested').length - 1, 1, 'one nested substitution, printed with its matcher')
  t.true(inspect(ranked).includes("get({ id: Arg.any{any} }) => returns('nested again')"))

  // a throwing predicate is a non-match, and the message says so
  const throwing = Substitute.for<any>()
  throwing.run({ value: 1 })
  const message = messageOf(() => throwing.received(1).run({ value: Arg.is(() => { throw new Error('boom') }) }))
  t.true(message.includes('an Arg.is predicate threw while matching this call: Error: boom'))

  // matchers inside class instances, Maps and Sets stay literal (the call is a real call)
  const literal = Substitute.for<any>()
  class Box { constructor(public value: unknown) { } }
  literal.put(new Box(Arg.any()))
  literal.put(new Map([['k', Arg.any()]]))
  literal.received(2).put(Arg.all())

  // looking for nested matchers runs no getters of the arguments, and survives revoked proxies
  let getterReads = 0
  const lazy = {}
  Object.defineProperty(lazy, 'value', { enumerable: true, get() { getterReads++; return 1 } })
  const scanned = Substitute.for<any>()
  scanned.take(lazy)
  scanned.take(lazy)
  t.true(getterReads <= 1, `${getterReads} getter reads`)
  const { proxy: revoked, revoke } = Proxy.revocable({}, {})
  revoke()
  t.notThrows(() => scanned.take(revoked))
  t.throws(() => scanned.received(2).take(revoked), { instanceOf: SubstituteException })

  // cycles end, in the specification and in the actual arguments
  const cyclicSpecification: any = { name: Arg.any() }
  cyclicSpecification.self = cyclicSpecification
  const cycles = Substitute.for<any>()
  cycles.visit(cyclicSpecification).returns('cyclic')
  const cyclicValue: any = { name: 'x' }
  cyclicValue.self = cyclicValue
  t.is(cycles.visit(cyclicValue), 'cyclic')
  cycles.visit({ name: 'x', self: { name: 'y', self: cyclicValue } })
  t.notThrows(() => cycles.received(2).visit(Arg.all()))
})

test('ENG2-6 (D28) unconfigured well-known protocol symbols read as undefined and are not recorded', async t => {
  const callback = Substitute.for<any>()
  t.is([].concat(callback).length, 1)
  t.true([() => 1].concat(callback).includes(callback))
  const toArray = (value: any) => typeof value[Symbol.iterator] === 'function' ? [...value] : [value]
  t.is(toArray(callback).length, 1)
  t.is(Object.prototype.toString.call(callback), '[object Function]')
  await t.throwsAsync(Promise.all(callback), { instanceOf: TypeError })

  const deps = Substitute.for<any>()
  t.notThrows(() => 'https://x/a'.startsWith(deps.baseUrl))
  t.false(new Error() instanceof deps.HttpError)
  for (const key of [Symbol.iterator, Symbol.asyncIterator, Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol.match,
    Symbol.matchAll, Symbol.replace, Symbol.search, Symbol.split, Symbol.species, Symbol.toStringTag, Symbol.unscopables,
    promisify.custom])
    t.is(deps[key], undefined, String(key))
  t.is(deps.nested.member[Symbol.iterator], undefined)
  t.is(deps.call(1)[Symbol.asyncIterator], undefined)

  const fs = Substitute.for<any>()
  fs.readFile(Arg.any(), Arg.any()).mimicks((file: string, done: Function) => done(null, `contents of ${file}`))
  t.is(await promisify(fs.readFile)('/etc/app.json'), 'contents of /etc/app.json')
  fs.received(1).readFile('/etc/app.json', Arg.any('function'))

  // none of the probes is recorded
  t.is(inspect(callback), '@Substitute {\n}')
  t.notThrows(() => deps.didNotReceive()[Symbol.iterator])
  t.notThrows(() => deps.received(1).HttpError)

  // explicit configuration and mimicking still answer
  const numbers = Substitute.for<any>()
  numbers[configure]()[Symbol.iterator]().returns([1, 2][Symbol.iterator]())
  t.deepEqual([...numbers], [1, 2])
  numbers.received(1)[Symbol.iterator]()
  const tagged = Substitute.for<any>()
  tagged[configure]()[Symbol.toStringTag].returns('Tagged')
  t.is(Object.prototype.toString.call(tagged), '[object Tagged]')
  const list = Substitute.for<any>()
  list[mimick](['a', 'b'])
  t.deepEqual([...list], ['a', 'b'])
  const readFile = Substitute.for<any>()
  readFile[mimick]({ [promisify.custom]: async () => 'custom' })
  t.is(typeof readFile[promisify.custom], 'function')
})

test('ENG2-7 (D28) a substitute is not a jest asymmetric matcher unless asymmetricMatch is configured', t => {
  // the check @jest/expect-utils uses to recognise asymmetric matchers
  const isAsymmetric = (value: any) => !!value && typeof value.asymmetricMatch === 'function'
  const logger = Substitute.for<any>()
  t.false(isAsymmetric(logger))
  t.false(isAsymmetric(logger.child))
  t.false(isAsymmetric(logger.create('x')))
  t.is(inspect(logger), '@Substitute {\n  received:\n    child\n    create(\'x\')\n}')

  const matcher = Substitute.for<any>()
  matcher[configure]().asymmetricMatch(Arg.any()).returns(true)
  t.true(isAsymmetric(matcher))
  t.true(matcher.asymmetricMatch(42))
  matcher.received(1).asymmetricMatch(42)
})

test('ENG2-11 (D31) nested configure() setups through a configured or mimicked member go to its substitute, or fail', t => {
  // a property configured to return a substitute: the nested setup goes to that substitute
  const app = Substitute.for<any>()
  const config = Substitute.for<any>()
  config.port.returns(80)
  app.config.returns(config)
  app[configure]().config.port.returns(1)
  t.is(app.config, config)
  t.is(app.config.port, 1)

  // a call configured to return a substitute: the earlier setups of that substitute are kept
  const container = Substitute.for<any>()
  const repository = Substitute.for<any>()
  repository.find(2).returns('two')
  container.getRepo().returns(repository)
  container[configure]().getRepo().find(1).returns('one')
  t.is(container.getRepo(), repository)
  t.is(container.getRepo().find(1), 'one')
  t.is(container.getRepo().find(2), 'two')
  // ... also when a matcher setup answers the call, and for a function substitute that is called
  const lookup = Substitute.for<any>()
  lookup.get(Arg.any()).returns(repository)
  lookup[configure]().get(5).find(3).returns('three')
  t.is(lookup.get(5), repository)
  t.is(repository.find(3), 'three')
  const callback = Substitute.for<any>()
  const factory = Substitute.for<any>()
  factory.make().returns(callback)
  factory[configure]().make()(7).returns('seven')
  t.is(callback(7), 'seven')

  // mimicked: a substitute value gets the setup, a real value is a usage error
  const mimicked = Substitute.for<any>()
  mimicked[mimick]({ config, settings: { port: 80 } })
  mimicked[configure]().config.host.returns('example.org')
  t.is(mimicked.config, config)
  t.is(mimicked.config.host, 'example.org')
  const mimickedError = t.throws<SubstituteException>(() => mimicked[configure]().settings.port.returns(1), { instanceOf: SubstituteException })
  t.true(plain(mimickedError.message).startsWith(
    'Cannot configure @Substitute.settings.port: settings is mimicked with { port: 80 }, which is not a substitute, ' +
    'and members of a real value cannot be configured.'))
  t.is(mimicked.settings.port, 80)

  // configured real values are a usage error, and nothing is replaced
  const real = Substitute.for<any>()
  real.options.returns({ retries: 3 })
  real.load().returns([1])
  real.connection.throws(new Error('down'))
  t.throws(() => real[configure]().options.retries.returns(5), { instanceOf: SubstituteException, message: /options returns \{ retries: 3 \}, which is not a substitute/ })
  t.throws(() => real[configure]().load().length.returns(5), { instanceOf: SubstituteException, message: /Cannot configure @Substitute\.load\(\)\.length: load\(\) returns \[ 1 \]/ })
  t.throws(() => real[configure]().connection.isOpen.returns(true), { instanceOf: SubstituteException, message: /connection is configured with throws\(\)/ })
  t.deepEqual(real.options, { retries: 3 })
  t.deepEqual(real.load(), [1])

  // members that do not answer with a value yet keep working as before
  const fresh = Substitute.for<any>()
  fresh[configure]().config.port.returns(1)
  fresh[configure]().getRepo(Arg.any()).find(1).returns('one')
  t.is(fresh.config.port, 1)
  t.is(fresh.getRepo(9).find(1), 'one')
  const partial = Substitute.for<any>()
  partial[mimick]({ load: () => 'real' })
  partial[configure]().config.port.returns(2)
  t.is(partial.config.port, 2)
})

test('ENG2-12 (D32) methods read from the value of a member configured as property and method run on that value', t => {
  const sizes = Substitute.for<any>()
  sizes.size(Arg.any()).returns(10)
  sizes.size.returns(3)
  t.is(sizes.size.toFixed(1), '3.0')
  t.is(sizes.size(1), 10)

  const dates = Substitute.for<any>()
  dates.when(Arg.all()).returns('x')
  dates.when.returns(new Date(0))
  t.is(dates.when.getTime(), 0)

  const maps = Substitute.for<any>()
  maps.items(Arg.all()).returns([])
  maps.items.returns(new Map([['a', 1]]))
  t.is(maps.items.get('a'), 1)
  t.true(maps.items.has('a'))

  const names = Substitute.for<any>()
  names.name(1).returns('x')
  names.name.returns('Ann')
  t.is(names.name.toUpperCase(), 'ANN')
  t.is(names.name.length, 3)

  // a substitute value records and resolves its own calls
  const inner = Substitute.for<any>()
  inner.greet().returns('hi')
  const outer = Substitute.for<any>()
  outer.child(1).returns(1)
  outer.child.returns(inner)
  t.is(outer.child.greet(), 'hi')
  inner.received(1).greet()
})

test('ENG2-13 (D33) a property-style didNotReceive().m on a member that was only invoked is reported later', t => {
  const logger = Substitute.for<any>()
  logger.error('disk full')
  const message = deferredMessageOf(t, () => logger.didNotReceive().error)
  t.is(message.split('\n')[1],
    'Expected to receive 0 property reads or method calls matching error, but received 1 method call. ' +
    'error was called 1 time as a method; to assert calls, invoke it: sub.didNotReceive().error(...)')
  t.true(message.includes("\n› ✘ @Substitute.error('disk full')"))

  // received(0) is didNotReceive(), also on nested substitutes and with several calls
  const app = Substitute.for<any>()
  app.logger.warn(1)
  app.logger.warn(2)
  t.true(deferredMessageOf(t, () => app.logger.received(0).warn)
    .includes('warn was called 2 times as a method; to assert calls, invoke it: sub.logger.didNotReceive().warn(...)'))

  // invoking the member right away cancels the report: the method assertion decides
  reportsNothingLater(t, () => t.notThrows(() => logger.didNotReceive().error('other')))
  reportsNothingLater(t, () => t.throws(() => logger.didNotReceive().error('disk full'), { instanceOf: SubstituteException }))
  reportsNothingLater(t, () => t.notThrows(() => logger.didNotReceive().error(Arg.is((text: string) => text.startsWith('x')))))

  // nothing to report for members that were never touched, or that are properties
  const settings = Substitute.for<any>()
  reportsNothingLater(t, () => t.notThrows(() => settings.didNotReceive().flag))
  settings.flag = 1
  reportsNothingLater(t, () => t.notThrows(() => settings.didNotReceive().flag))
})

test('ENG2-14 (D34) deferred reports are not swallowed by fake timers installed after the library was loaded', t => {
  const library = path.resolve(__dirname, '../../../src/index.js')
  const fakeTimers = require.resolve('@sinonjs/fake-timers')
  const script = `
    const { Substitute } = require(${JSON.stringify(library)})
    const FakeTimers = require(${JSON.stringify(fakeTimers)})
    const clock = FakeTimers.install({ toFake: ['nextTick', 'setTimeout', 'setImmediate', 'queueMicrotask'] })
    process.on('uncaughtException', error => {
      console.log('reported: ' + error.constructor.name + ': ' + error.message.split('\\n')[1])
    })
    const calculator = Substitute.for()
    calculator.add(1, 2)
    calculator.add(1, 2)
    calculator.add(3, 4)
    calculator.received(2).add
    console.log('nothing thrown synchronously; the fake clock is never advanced')
  `
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  t.is(result.stderr, '')
  t.is(result.stdout,
    'nothing thrown synchronously; the fake clock is never advanced\n' +
    'reported: SubstituteException: Expected to receive 2 property reads matching add, but received none. ' +
    'add was never read as a property; it was called 3 times as a method. To assert calls, invoke it: sub.received(2).add(...)\n')
})

test('V2-3 (D36) received(n).m(...) on a method that was only read gives a kind-neutral failure with the read hint', t => {
  const handler = Substitute.for<any>()
  const registered = handler.onClick
  t.is(typeof registered, 'function')

  const message = messageOf(() => handler.received(2).onClick(42))
  const lines = message.split('\n')
  t.is(lines[1], 'Expected to receive 2 property reads or method calls matching onClick, but received 1 property read and no method calls.')
  t.is(lines[3], '› ✘ @Substitute.onClick')
  t.true(message.endsWith('\n@Substitute.onClick was read 1 time without being called; reading a method does not count as calling it.\n'))

  // the same failure for the property-style form (it is decided at the read) and on nested substitutes
  const app = Substitute.for<any>()
  void app.view.render
  void app.view.render
  const nested = messageOf(() => app.view.received(3).render)
  t.true(nested.includes('Expected to receive 3 property reads or method calls matching render, but received 2 property reads and no method calls.'))
  t.true(nested.includes('@Substitute.view.render was read 2 times without being called'))

  // E77 (R12FE-2): fewer expected reads than received gets the same kind-neutral failure with the hint (it was a property
  // failure without the hint before)
  const fewer = messageOf(() => app.view.received(1).render)
  t.true(fewer.includes('Expected to receive 1 property read or method call matching render, but received 2 property reads and no method calls.'))
  t.true(fewer.includes('@Substitute.view.render was read 2 times without being called'))
})
