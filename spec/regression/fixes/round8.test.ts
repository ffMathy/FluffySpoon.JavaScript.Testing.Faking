import test from 'ava'
import * as assert from 'assert'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { inspect } from 'util'

import { Substitute, Arg, configure, mimick, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 8: the behaviour findings of round 7 (R7V-*, R7FE-*, R7-ADV-*), decided in the fix spec as E33-E41.

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

// ---- E34: __esModule is an ordinary member again (E27 reverted) ---------------------------------

/*
 * The module interop helpers that code compiled from ES modules runs when it imports a CommonJS module (here: the
 * substitute that a jest.mock() factory returns for a whole module), as TypeScript 5 (esModuleInterop) and Babel 7 emit
 * them.
 */
const tsImportDefault = (mod: any) => (mod && mod.__esModule) ? mod : { default: mod }
const tsImportStar = (mod: any) => {
  if (mod && mod.__esModule) return mod
  const result: any = {}
  if (mod != null) for (const key of Object.getOwnPropertyNames(mod)) if (key !== 'default') {
    let descriptor = Object.getOwnPropertyDescriptor(mod, key)
    if (!descriptor || ('get' in descriptor ? !mod.__esModule : descriptor.writable || descriptor.configurable))
      descriptor = { enumerable: true, get: () => mod[key] }
    Object.defineProperty(result, key, descriptor)
  }
  Object.defineProperty(result, 'default', { enumerable: true, value: mod })
  return result
}
const babelInteropRequireDefault = (e: any) => e && e.__esModule ? e : { default: e }
const babelInteropRequireWildcard = (e: any) => {
  if (e && e.__esModule) return e
  const f: any = { __proto__: null, default: e }
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return f
  for (const key in e) if (key !== 'default' && Object.prototype.hasOwnProperty.call(e, key)) f[key] = e[key]
  return f
}

interface Mailer {
  send(to: string, body: string): boolean
  verify(address: string): boolean
}

/** A module substitute set up as the test would set it up (`jest.requireMock(path)`). */
const mailerModule = () => {
  const mailer = Substitute.for<Mailer>()
  mailer.send('a@b.c', 'hi').returns(true)
  mailer.verify('a@b.c').returns(true)
  return mailer
}

test('R7-ADV-3 (E34) a substitute standing in for a whole module keeps its members behind a namespace import (TypeScript __importStar)', t => {
  const mailer = mailerModule()
  // `import * as ns from './mailer'; ns.send(...)` compiled by tsc with esModuleInterop
  const ns = tsImportStar(mailer)
  t.is(typeof ns.send, 'function')
  t.true(ns.send('a@b.c', 'hi'))
  t.true(ns.verify('a@b.c'))
  t.notThrows(() => mailer.received(1).send('a@b.c', 'hi'))
  // a named import is `require('./mailer').send` in every compiler
  t.true(mailer.verify('a@b.c'))
})

test('R7-ADV-3 (E34) Babel\'s mixed `import mailer, { send }` (interopRequireWildcard) reaches the members', t => {
  const mailer = mailerModule()
  const wildcard = babelInteropRequireWildcard(mailer)
  t.true(wildcard.send('a@b.c', 'hi'), 'the named import')
  t.true(wildcard.verify('a@b.c'))
  t.is(wildcard.default, (mailer as any).default, 'the default import is the auto-substitute sub.default, as in 2.0.0-beta.4')
  t.notThrows(() => mailer.received(1).send('a@b.c', 'hi'))
})

test('R7FE-5 (E34) every import form of a module substitute: namespace, named, mixed, and the default import through the documented factory', t => {
  const mailer = mailerModule()
  t.true(tsImportStar(mailer).verify('a@b.c'), 'import * as m (tsc)')
  t.true(babelInteropRequireWildcard(mailer).verify('a@b.c'), 'import * as m / import m, { verify } (Babel)')
  t.true(mailer.verify('a@b.c'), 'import { verify } (any compiler)')
  t.is(tsImportDefault(mailer).default, (mailer as any).default, 'import m (tsc): the auto-substitute sub.default')
  t.is(babelInteropRequireDefault(mailer).default, (mailer as any).default, 'import m (Babel): the auto-substitute sub.default')

  // the documented factory for a default import of the substitute itself:
  // jest.mock('./mailer', () => ({ __esModule: true, default: sub }))
  const factory = { __esModule: true, default: mailer }
  t.is(tsImportDefault(factory).default, mailer)
  t.is(babelInteropRequireDefault(factory).default, mailer)
  t.true(tsImportDefault(factory).default.send('a@b.c', 'hi'))
})

test('R7V-4 (E34) __esModule reads like any other member: truthy unless configured, recorded, and configurable', t => {
  const mod = Substitute.for<any>()
  t.truthy(mod.__esModule)
  t.notThrows(() => mod.received(1).__esModule)
  t.is(String(mod), '@Substitute {\n  received:\n    __esModule\n}')

  const configured = Substitute.for<any>()
  configured.__esModule.returns(false)
  t.is(configured.__esModule, false, 'the plain setup works again (no configure view needed)')
  t.deepEqual(Object.keys(tsImportStar(configured)), ['default'])

  const mimicking = Substitute.for<any>()
  mimicking[mimick]({ send: () => 'real' })
  t.is(mimicking.__esModule, undefined, 'a mimicked instance without the member reads as undefined, like the instance')
  t.is(tsImportDefault(mimicking).default, mimicking)
})

// ---- E33: printing never recurses or hangs ----------------------------------------------------------------

/**
 * Runs a script with the library in a child process, so that a hang fails the test (after `timeout` ms) instead of
 * stopping the run, and returns what it prints, parsed as JSON.
 */
const isolated = (script: string, timeout = 8000): any => {
  const library = path.resolve(__dirname, '../../../src/index.js')
  const result = spawnSync(process.execPath, ['-e', `
    const { Substitute, Arg } = require(${JSON.stringify(library)})
    const { inspect } = require('util')
    const failureOf = check => { try { check() } catch (error) { return error.message } return 'passed' }
    ${script}
  `], { encoding: 'utf8', timeout, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } })
  if (result.error !== undefined) throw new Error(`the script did not finish: ${result.error.message}`)
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

test('R7V-3 (E33) a factory result stored on the object passed to it prints without recursing (two and ten of them)', t => {
  const printed = isolated(`
    const app = Substitute.for()
    const ctx = { name: 'root' }
    ctx.child0 = app.create0(ctx)
    ctx.child1 = app.create1(ctx)
    const started = Date.now()
    const outputs = {
      root: String(app), inspected: inspect(app), child: String(ctx.child0), ctx: inspect(ctx), json: JSON.stringify({ ctx }),
      message: failureOf(() => app.received(2).create0(ctx))
    }
    const many = Substitute.for()
    const container = { name: 'container' }
    for (let index = 0; index < 10; index++) container['service' + index] = many['create' + index](container)
    outputs.many = String(many).length + failureOf(() => many.received(2).create0(container)).length + inspect(container).length
    outputs.ms = Date.now() - started
    console.log(JSON.stringify(outputs))
  `)
  const child = "@Substitute.create0({ name: 'root', child0: @Substitute.create0(…), child1: @Substitute.create1(…) })"
  t.is(printed.child, child, 'a repeat of the call being printed shows (…)')
  t.true(printed.ctx.includes(`child0: ${child}`))
  t.true(printed.root.startsWith('@Substitute {\n  received:\n    create0({'))
  t.is(printed.inspected, printed.root)
  t.true(printed.json.includes('@Substitute.create1('))
  t.true(printed.message.startsWith('Call count mismatch in @Substitute.create0:\nExpected to receive 2 method calls matching create0({'))
  t.true(printed.message.includes('but received 1.'))
  for (const key of ['root', 'child', 'ctx', 'json', 'message']) t.true(printed[key].length < 2000, `${key}: ${printed[key].length} characters`)
  t.true(printed.many < 100000, `ten factory results: ${printed.many} characters`)
  t.true(printed.ms < 2000, `${printed.ms} ms`)
})

test('R7V-3 (E33) handlers bound to the instance that holds them print without recursing (String, inspect, messages)', t => {
  const printed = isolated(`
    class Widget { constructor(bus) { this.on0 = bus.handler0.bind(this); this.on1 = bus.handler1.bind(this) } }
    const bus = Substitute.for()
    const widget = new Widget(bus)
    const started = Date.now()
    const outputs = {
      bus: String(bus), widget: inspect(widget), handler: String(widget.on0),
      message: failureOf(() => bus.received(1).handler0('x')), bindMessage: failureOf(() => bus.handler0.received(2).bind(widget))
    }
    widget.on1('saved')
    outputs.called = failureOf(() => bus.received(1).handler1('saved'))
    outputs.ms = Date.now() - started
    console.log(JSON.stringify(outputs))
  `)
  t.is(printed.handler, '@Substitute.handler0.bind(Widget { on0: @Substitute.handler0.bind(…), on1: @Substitute.handler1.bind(…) })')
  t.true(printed.bus.includes('    handler0.bind(Widget {'))
  t.true(printed.widget.startsWith('Widget {\n  on0: @Substitute.handler0.bind(Widget { on0: @Substitute.handler0.bind(…)'))
  t.true(printed.message.startsWith('Call count mismatch in @Substitute.handler0:'))
  t.true(printed.bindMessage.startsWith('Call count mismatch in @Substitute.handler0.bind:'))
  t.is(printed.called, 'passed', 'invoking a bound handler is a call of the member')
  for (const key of ['bus', 'widget', 'handler', 'message', 'bindMessage']) t.true(printed[key].length < 2000, `${key}: ${printed[key].length} characters`)
  t.true(printed.ms < 2000, `${printed.ms} ms`)
})

test('R7V-3 (E33) a substitute inside the arguments of a path keeps primitive arguments, and the guard does not leak', t => {
  const app = Substitute.for<any>()
  t.is(String(app.save(app.getUser(1))), '@Substitute.save(@Substitute.getUser(1))')
  t.is(String(app.save({ user: app.getUser(2) })), '@Substitute.save({ user: @Substitute.getUser(2) })')
  t.is(String(app.wrap(app.save({ id: 1 }))), '@Substitute.wrap(@Substitute.save(…))', 'objects inside a path inside a path are left out')
  const ctx: any = { name: 'root' }
  ctx.child = app.create(ctx)
  t.is(String(ctx.child), "@Substitute.create({ name: 'root', child: @Substitute.create(…) })")
  // after printing, paths are shown in full again
  t.is(String(app.getUser(3)), '@Substitute.getUser(3)')
  t.is(inspect(app.load({ id: 1 }, 'x')), "@Substitute.load({ id: 1 }, 'x')")
})

/** The test of the jest and vitest mock serializers (pretty-format plugins), which a substitute must not pass. */
const isJestMock = (value: any) => !!(value && value._isMockFunction)

test('R7FE-3 (E33) _isMockFunction is a protocol key: undefined and not recorded unless configured, so snapshots do not treat substitutes as mocks', t => {
  const app = Substitute.for<any>()
  const user = app.user
  t.false(isJestMock(app))
  t.false(isJestMock(user))
  t.is(app._isMockFunction, undefined)
  t.false('_isMockFunction' in app)
  t.is(String(app), '@Substitute {\n  received:\n    user\n}', 'the probe is not recorded')
  t.notThrows(() => app.didNotReceive()._isMockFunction)

  const configured = Substitute.for<any>()
  configured[configure]()._isMockFunction.returns(true)
  t.true(configured._isMockFunction)
  const mimicking = Substitute.for<any>()
  mimicking[mimick]({ _isMockFunction: true })
  t.true(mimicking._isMockFunction)
})

// ---- E35: the in operator, and deep chains of auto-substitutes ----------------------------------------------

/** Code under test that feature-detects an optional logger method on every call (R7-ADV-1). */
class Reporter {
  constructor(private readonly logger: any) { }
  report(item: { id: number }) {
    if ('debug' in this.logger) this.logger.debug(item)
    else this.logger.log(`item ${item.id}`)
  }
}

/** The same code under test without the probe. */
class PlainReporter {
  constructor(private readonly logger: any) { }
  report(item: { id: number }) { this.logger.log(`item ${item.id}`) }
}

test('R7-ADV-1 (E35) key in sub does not scan the auto-substitutes: 10,000 probes interleaved with calls cost no more than the calls', t => {
  /**
   * 10,000 reports with the probe and 10,000 without, interleaved report by report (in alternating order), so that both
   * see the same load and the same garbage collections. The time of each one is added up.
   */
  const round = (): { probed: number, plain: number } => {
    const probedLogger = Substitute.for<any>()
    const plainLogger = Substitute.for<any>()
    const probedReporter = new Reporter(probedLogger)
    const plainReporter = new PlainReporter(plainLogger)
    let probed = 0
    let plain = 0
    const time = (report: () => void): number => {
      const started = performance.now()
      report()
      return performance.now() - started
    }
    for (let index = 0; index < 10000; index++) {
      const item = { id: index }
      if (index % 2 === 0) {
        probed += time(() => probedReporter.report(item))
        plain += time(() => plainReporter.report(item))
      } else {
        plain += time(() => plainReporter.report(item))
        probed += time(() => probedReporter.report(item))
      }
    }
    probedLogger.received(10000).log(Arg.any())
    plainLogger.received(10000).log(Arg.any())
    return { probed, plain }
  }
  round() // warm-up
  const rounds = [round(), round(), round(), round(), round()]
  const ratios = rounds.map(({ probed, plain }) => probed / plain).sort((a, b) => a - b)
  const ratio = ratios[2]
  t.log(`10,000 calls with an in probe each against 10,000 without, interleaved: ${ratios.map(value => value.toFixed(2)).join(', ')} (median ${ratio.toFixed(2)}x, ` +
    `${rounds.map(({ probed }) => probed.toFixed(0)).join(', ')} ms with the probe)`)
  // at 89e4175 the probes made it 15 to 50 times slower; at 74b8588 (no in trap) they cost nothing
  t.true(ratio < 1.3, `${ratio.toFixed(2)}x`)
})

test('R7-ADV-1 (E35) the cost of key in sub does not grow with the auto-substitutes of the substitute', t => {
  const probe = (logger: any): number => {
    const started = process.hrtime()
    let found = 0
    for (let index = 0; index < 10000; index++) if ('debug' in logger) found++
    const [seconds, nanoseconds] = process.hrtime(started)
    t.is(found, 0)
    return seconds * 1e3 + nanoseconds / 1e6
  }
  const fresh = Substitute.for<any>()
  const used = Substitute.for<any>()
  for (let index = 0; index < 10000; index++) used.log(`item ${index}`).flush()
  probe(fresh)
  probe(used)
  const freshTimes: number[] = []
  const usedTimes: number[] = []
  for (let round = 0; round < 5; round++) {
    freshTimes.push(probe(fresh))
    usedTimes.push(probe(used))
  }
  const best = (values: number[]) => Math.min(...values)
  t.log(`10,000 probes: ${best(freshTimes).toFixed(2)} ms on a new substitute, ${best(usedTimes).toFixed(2)} ms after 10,000 distinct calls`)
  // at 89e4175 every probe listed the 10,000 auto-substitutes (seconds in all); a few milliseconds of noise are allowed
  t.true(best(usedTimes) < 3 * best(freshTimes) + 5, `${best(usedTimes).toFixed(2)} ms against ${best(freshTimes).toFixed(2)} ms`)
})

test('E35 key in sub notes setups made deeper later, through any path, and only setups', t => {
  const app = Substitute.for<any>()
  app.logger.info('used')
  app.getUser(1).name
  t.false('logger' in app)
  t.false('getUser' in app)
  app.logger.child('x').level.returns(3)
  t.true('logger' in app, 'a setup two levels down')
  t.true('child' in app.logger)
  t.true('level' in app.logger.child('x'))
  t.false('info' in app.logger)
  app.getUser(2)[mimick]({ name: 'ann' })
  t.true('getUser' in app, 'an auto-substitute that mimicks an instance')
  app[configure]().settings.port.returns(80)
  t.true('settings' in app, 'a setup through the configure view')
  const other = Substitute.for<any>()
  other.repo(Arg.any()).find(Arg.is((id: number) => id > 0)).resolves({ id: 1 })
  t.true('repo' in other, 'a setup through a matcher chain')
})

test('R7-ADV-6 (E35) a check or a read through a matcher chain does not make the member `in` the substitute', t => {
  const app = Substitute.for<any>()
  t.false('repo' in app)
  app.repo(Arg.any()).didNotReceive().save(1)
  t.false('repo' in app)
  t.is(String(app), '@Substitute {\n}')

  const app2 = Substitute.for<any>()
  void app2.repo(Arg.any()).save
  t.false('repo' in app2)

  const app3 = Substitute.for<any>()
  app3.logger.received(0).info('x')
  t.false('logger' in app3)
})

test('R7-ADV-7 (E35) a deep chain of auto-substitutes prints, stringifies, answers `in` and clears without a RangeError, and small', t => {
  const list = Substitute.for<any>()
  let node = list
  for (let index = 0; index < 10000; index++) node = node.next
  const printed = String(list)
  t.true(printed.length < 20000, `${printed.length} characters`)
  t.true(printed.startsWith('@Substitute {\n  received:\n    next\n    next.next\n    next.next.next\n'))
  t.true(printed.includes('    next.next.next.next.next.next.next.next.next.next.next\n'))
  t.true(printed.includes('    next.next.next.….next.next.next.next.next.next.next\n'), 'long paths leave out their middle members')
  t.true(printed.endsWith('    … and 9949 more\n}'), 'its own read and at most 50 calls of the auto-substitutes are listed')
  t.is(inspect(list), printed)
  t.true(JSON.stringify({ list }).length < 20000)
  t.false('next' in list)
  t.false('value' in list)
  t.is(String(node), '@Substitute.next.next.next.….next.next.next.next.next.next')
  node.value.returns(1)
  t.true('next' in list, 'a setup at the end of the chain')
  t.notThrows(() => list[Symbol.for('@fluffy-spoon/substitute:clearReceivedCalls')]())
  t.is(node.value, 1)

  const db = Substitute.for<any>()
  let query = db.query('users')
  for (let index = 0; index < 6000; index++) query = query.where(`f${index}`, index)
  const printedDb = inspect(db)
  t.true(printedDb.length < 20000, `${printedDb.length} characters`)
  t.true(printedDb.includes("\n    query('users').where('f0', 0).where('f1', 1).….where('f42', 42).where('f43', 43).where('f44', 44).where('f45', 45).where('f46', 46).where('f47', 47).where('f48', 48)\n"))
  t.regex(printedDb, /\n {4}… and 59\d\d more\n\}$/)
  t.false('query' in db)
  t.true(String(query).startsWith("@Substitute.query('users').where('f0', 0).where('f1', 1).….where('f5994', 5994)"))
})

// ---- E38: handleEvent ---------------------------------------------------------------------------------------

/** How happy-dom calls an event listener: its handleEvent method when it has one, the listener itself otherwise. */
const dispatchLikeHappyDom = (listener: any, event: unknown) => {
  if (listener.handleEvent) listener.handleEvent.call(listener, event)
  else listener.call(undefined, event)
}

test('R7FE-2 (E38) a function substitute added as an event listener records the event as a call of itself (happy-dom, Node.js EventTarget)', t => {
  const onClick = Substitute.for<any>()
  t.is(onClick.handleEvent, undefined)
  dispatchLikeHappyDom(onClick, { type: 'click' })
  t.notThrows(() => onClick.received(1)(Arg.any()))
  t.is(String(onClick), "@Substitute {\n  received:\n    ({ type: 'click' }) via .call(undefined, { type: 'click' })\n}", 'handleEvent is not recorded')

  const target = new EventTarget()
  const onSave = Substitute.for<any>()
  target.addEventListener('save', onSave)
  target.dispatchEvent(new Event('save'))
  t.notThrows(() => onSave.received(1)(Arg.is((event: Event) => event.type === 'save')))
})

test('R7FE-2 (E38) handleEvent answers once it is configured or mimicked, and the wrapper workaround for EventListenerObject substitutes', t => {
  const configured = Substitute.for<any>()
  configured[configure]().handleEvent(Arg.any()).returns(undefined)
  dispatchLikeHappyDom(configured, { type: 'click' })
  t.notThrows(() => configured.received(1).handleEvent(Arg.any()))

  const mimicking = Substitute.for<any>()
  const seen: unknown[] = []
  mimicking[mimick]({ handleEvent: (event: unknown) => seen.push(event) })
  dispatchLikeHappyDom(mimicking, 'e')
  t.deepEqual(seen, ['e'])

  // an unconfigured handleEvent reads as undefined, also for code under test that calls it itself
  const unconfigured = Substitute.for<EventListenerObject>()
  t.throws(() => unconfigured.handleEvent(new Event('save')), { instanceOf: TypeError })

  // the documented workaround for a substitute of an EventListenerObject (DOM implementations other than happy-dom
  // call a substitute itself, because it is a function): configure handleEvent, and add a plain object that forwards
  const listener = Substitute.for<EventListenerObject>()
  listener[configure]().handleEvent(Arg.any()).returns(undefined)
  const target = new EventTarget()
  target.addEventListener('save', { handleEvent: event => listener.handleEvent(event) })
  target.dispatchEvent(new Event('save'))
  t.notThrows(() => listener.received(1).handleEvent(Arg.is((event: Event) => event.type === 'save')))
  t.true('handleEvent' in listener)
})

// ---- E40: errors among arguments, and the name of the proxy target -----------------------------------------

/** Code under test that logs the error of a failed parse (R7FE-6). */
const parseOrLog = (logger: any, text: string) => {
  try {
    return JSON.parse(text)
  } catch (error) {
    logger.error('parse failed', error)
    return undefined
  }
}

test('R7FE-6 (E40) failure messages and printouts show an Error argument as [Name: message], without its stack', t => {
  const logger = Substitute.for<any>()
  parseOrLog(logger, '{')
  const message = messageOf(() => logger.received(1).error('parse failed', Arg.is((error: Error) => error.message === 'nope')))
  t.regex(message, /› ✘ @Substitute\.error\('parse failed', \[SyntaxError: [^\]\n]+\]\)\n {4}called at /)
  t.false(message.includes('at JSON.parse'), message)
  t.true(message.split('\n').length <= 6, message)

  const expected = messageOf(() => logger.received(1).error('parse failed', new Error('bad')))
  t.true(expected.includes("matching error('parse failed', [Error: bad])"), expected)

  const cause = new TypeError('x is undefined')
  const failure = new (Error as any)('saving failed', { cause })
  const repo = Substitute.for<any>()
  repo.reject(failure)
  repo.code(Object.assign(new RangeError(''), { code: 'E_RANGE' }))
  t.is(String(repo), '@Substitute {\n  received:\n    reject([Error: saving failed] { [cause]: [TypeError: x is undefined] })\n    code([RangeError])\n}')
  t.is(String(repo.reject(failure)), '@Substitute.reject([Error: saving failed] { [cause]: [TypeError: x is undefined] })')
  repo.retry(Arg.any()).throws(new Error('again'))
  t.true(String(repo).includes("    retry(Arg.any{any}) => throws([Error: again])"), String(repo))
})

test('R7FE-7 (E40) util.inspect without custom inspection (node:assert) does not show the internal name returnThis', t => {
  const app = Substitute.for<any>()
  const user = app.getUser(1)
  for (const value of [app, user, app.logger, app[configure](), app.received(), app.getUser.bind(null)]) {
    const shown = inspect(value, { customInspect: false })
    t.false(shown.includes('returnThis'), shown)
    t.regex(shown, /^\[Function: bound substitute\]/)
  }
  const error = t.throws(() => assert.strictEqual(user, 'ann'))
  t.false(error!.message.includes('returnThis'), error!.message)
  t.true(error!.message.includes('[Function: bound substitute]'), error!.message)
})

// ---- E36: new.target ----------------------------------------------------------------------------------------

class RealBase {
  public readonly kind: string
  constructor(public readonly name: string) { this.kind = new.target.name }
  hello() { return `hi ${this.name}` }
}

test('R7-ADV-2 (E36) a subclass of a substitute that mimicks a class, Reflect.construct with a newTarget, and a bound constructor', t => {
  const Base = Substitute.for<any>()
  Base[mimick](RealBase)
  class Derived extends (Base as unknown as typeof RealBase) { extra() { return 'extra' } }
  const derived = new Derived('d')
  t.is(Object.getPrototypeOf(derived), Derived.prototype)
  t.true(derived instanceof Derived)
  t.is(derived.kind, 'Derived', 'new.target is the subclass')
  t.is(derived.extra(), 'extra')
  t.is(derived.hello(), 'hi d')
  t.notThrows(() => Base.received(1)('d'), 'the construction is recorded')
  t.true(String(Base).includes("new @Substitute('d')"))

  const ns = Substitute.for<any>()
  ns.Model(Arg.all()).mimicks(RealBase)
  class Other { }
  const other: any = Reflect.construct(ns.Model, ['m'], Other)
  t.is(Object.getPrototypeOf(other), Other.prototype)
  t.is(other.kind, 'Other')
  t.is(other.name, 'm')
  t.notThrows(() => ns.received(1).Model('m'))

  class Connection { public readonly address: string; constructor(host: string, port: number) { this.address = `${host}:${port}` } }
  const net = Substitute.for<any>()
  net.Connection(Arg.all()).mimicks(Connection.bind(null, 'db'))
  const connection = new net.Connection(5432)
  t.is(connection.address, 'db:5432', 'a bound constructor is constructed, not called')
  t.true(connection instanceof Connection)
  const viaMimick = Substitute.for<any>()
  viaMimick[mimick](Connection.bind(null, 'cache'))
  t.is(new viaMimick(6379).address, 'cache:6379')
  // an arrow function is still called
  const arrows = Substitute.for<any>()
  arrows.make(Arg.all()).mimicks((value: number) => ({ value }))
  t.deepEqual(new arrows.make(1), { value: 1 })
})

test('R7FE-4 (E36) a class extending an unconfigured or configured substitute member keeps its own methods, and each new gives a new instance', t => {
  const sdk = Substitute.for<any>()
  sdk.Base(Arg.all()).mimicks(RealBase)
  class Derived extends (sdk.Base as typeof RealBase) {
    constructor() { super('d') }
    own() { return 'own' }
  }
  const derived = new Derived()
  t.true(derived instanceof Derived)
  t.is(derived.own(), 'own')
  t.is(derived.kind, 'Derived')
  t.is(derived.name, 'd', 'constructed by the mimicked class')
  // (the prototype a class inherits from a member is the member's `prototype`, an auto-substitute: the methods of the
  // mimicked class are not inherited; a substitute that mimicks the class itself, `Base[mimick](RealBase)`, reads it
  // from the class)
  t.is(typeof derived.hello, 'function')

  const unconfigured = Substitute.for<any>()
  class Plugin extends (unconfigured.Base as typeof RealBase) {
    static instances = 0
    public ready: boolean
    constructor(name: string) {
      super(name)
      this.ready = true
      Plugin.instances++
    }
    own() { return 'own' }
  }
  const first = new Plugin('a')
  const second = new Plugin('b')
  t.true(first instanceof Plugin)
  t.is(first.own(), 'own')
  t.not(first, second, 'not the cached auto-substitute of the call')
  // assignments to the instance (and to the class) create its own properties, as with an ordinary base class
  t.true(first.ready)
  t.deepEqual(Object.keys(first), ['ready'])
  t.is(Plugin.instances, 2)
  t.false(String(unconfigured).includes('ready'), 'and are not recorded on the substitute')
  t.notThrows(() => unconfigured.received(1).Base('a'))
  t.notThrows(() => unconfigured.received(2).Base(Arg.any()))
  t.true(String(unconfigured).includes("new Base('a')"))

  // without a subclass, new still gives the configured object or the auto-substitute of the call
  t.is(new unconfigured.Base('a'), unconfigured.Base('a'))
  const instance = { configured: true }
  unconfigured.Made(Arg.any()).returns(instance)
  t.is(new unconfigured.Made(1), instance)
  class FromConfigured extends (unconfigured.Made as new (...args: any[]) => object) { }
  t.is(new FromConfigured(1), instance, 'a configured object is what super() returns, as in JavaScript')
})

// ---- E37: a check whose argument throws a usage error ----------------------------------------------------------

test('R7V-1 (E37) a check whose matcher throws a usage error leaves no deferred report behind', t => {
  const clock = interceptDeferredReports()
  try {
    const logger = Substitute.for<any>()
    logger.log('a')
    logger.log(2)
    const anyNot = Arg.any as unknown as (type: string) => unknown
    t.throws(() => logger.received(2).log(anyNot('String')), { instanceOf: TypeError, message: /^Arg\.any expects one of/ })
    t.notThrows(() => clock.tick(), 'Arg.any: no report of log as a property')
    t.throws(() => logger.received(2).log((Arg.any.not as any)('Number')), { instanceOf: TypeError })
    t.notThrows(() => clock.tick(), 'Arg.any.not')
    t.throws(() => logger.received(2).log(Arg.is('not a function' as any)), { instanceOf: TypeError, message: /^Arg\.is expects a predicate function/ })
    t.notThrows(() => clock.tick(), 'Arg.is')

    // a property-style check that is really not invoked still reports
    void logger.received(2).log
    t.throws(() => clock.tick(), { instanceOf: SubstituteException, message: /log was never read as a property/ })
    // and so does one made after a usage error
    t.throws(() => Arg.any('nope' as any))
    void logger.received(3).log
    t.throws(() => clock.tick(), { instanceOf: SubstituteException })
  } finally {
    clock.uninstall()
  }
})

// ---- E39: chains through a member configured to return a substitute ---------------------------------------------

test('R7FE-11 (E39) a setup or check chained through a member configured to return a substitute leaves out the leading read or call', t => {
  const app = Substitute.for<any>()
  const calc = Substitute.for<any>()
  app.getCalc().returns(calc)
  app.getCalc().add(1, 2).returns(3)
  const compute = (a: any) => a.getCalc().add(1, 2)
  t.is(compute(app), 3)
  t.notThrows(() => app.received(1).getCalc(), 'the setup through the configured call is not a call')
  t.notThrows(() => calc.received(1).add(1, 2))

  const logger = Substitute.for<any>()
  const child = Substitute.for<any>()
  logger.child(Arg.any()).returns(child)
  const log = (l: any) => l.child({ c: 1 }).info('x')
  log(logger)
  logger.child({ c: 1 }).received(1).info('x')
  t.notThrows(() => logger.received(1).child({ c: 1 }), 'the check through the configured call is not a call')

  const service = Substitute.for<any>()
  const serviceLogger = Substitute.for<any>()
  service.logger.returns(serviceLogger)
  const start = (s: any) => s.logger.info('started')
  start(service)
  service.logger.received(1).info('started')
  service.logger[received](1).info('started')
  t.notThrows(() => service.received(1).logger, 'the checks through the configured property are not reads')

  // reads and calls by the code under test stay recorded
  const viaCode = Substitute.for<any>()
  const repo = Substitute.for<any>()
  viaCode.repo.returns(repo)
  const getRepo = (s: any) => s.repo
  getRepo(viaCode).save(1)
  t.notThrows(() => viaCode.received(1).repo)
  const handed = getRepo(viaCode)
  handed.find(1).returns('one')
  t.notThrows(() => viaCode.received(2).repo, 'a value the code under test returned, configured by the test')

  // a mimicked instance's substitute member, and a direct call of a configured function substitute
  const mimicking = Substitute.for<any>()
  const nested = Substitute.for<any>()
  mimicking[mimick]({ nested })
  mimicking.nested.value.returns(5)
  t.is(nested.value, 5)
  t.notThrows(() => mimicking.didNotReceive().nested)
  const factory = Substitute.for<any>()
  const listener = Substitute.for<any>()
  factory.listener().returns(listener)
  factory.listener()('x').returns('y')
  t.is(listener('x'), 'y')
  t.notThrows(() => factory.didNotReceive().listener())
})

test('E39 a configured value that is the substitute itself (a fluent `return this`) does not continue the expression', t => {
  // the test calls the substitute and checks it in the next statement, which starts from the same substitute
  const map = Substitute.for<any>()
  map.set(Arg.all()).returns(map)
  t.is(map.set('b', 2), map)
  t.notThrows(() => map.received(1).set('b', 2))

  const builder = Substitute.for<any>()
  builder.where(Arg.all()).returns(builder)
  const query = (b: any) => b.where('a', 1).where('b', 2)
  t.is(query(builder), builder)
  t.notThrows(() => builder.received(2).where(Arg.all()))
})
