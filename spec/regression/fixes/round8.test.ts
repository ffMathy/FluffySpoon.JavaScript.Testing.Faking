import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { inspect } from 'util'

import { Substitute, Arg, configure, mimick } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

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
