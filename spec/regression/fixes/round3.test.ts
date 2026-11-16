import test, { ExecutionContext } from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { inspect, promisify } from 'util'

import { Substitute, Arg, configure, mimick } from '../../../src'
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

  // unchanged: fewer expected reads than received is a property failure without the hint
  const fewer = messageOf(() => app.view.received(1).render)
  t.true(fewer.includes('Expected to receive 1 property read matching render, but received 2.'))
  t.false(fewer.includes('without being called'))
})
