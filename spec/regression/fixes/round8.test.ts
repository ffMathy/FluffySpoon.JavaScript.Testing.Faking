import test from 'ava'
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
