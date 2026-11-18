import test from 'ava'
import { EventEmitter } from 'events'
import * as path from 'path'

import * as library from '../../../src'
import { Substitute } from '../../../src'

// Round 11: the open findings of round 10 (R10-ADV-*, R10V-*), decided in the fix spec as E59-E63.

// ---- E62 (R10V-3): Object.setPrototypeOf on a frozen, sealed or non-extensible substitute -----------------------

test('R10V-3 (E62) Object.setPrototypeOf on a frozen, sealed or non-extensible substitute throws a TypeError that names it', t => {
  const restrict: Record<string, (value: unknown) => unknown> = { freeze: Object.freeze, seal: Object.seal, preventExtensions: Object.preventExtensions }
  for (const how of Object.keys(restrict)) {
    const root = Substitute.for<any>()
    restrict[how](root)
    const app = Substitute.for<any>()
    const auto = app.events
    restrict[how](auto)
    for (const [substitute, path] of [[root, '@Substitute'], [auto, '@Substitute.events']] as const) {
      const viaObject = t.throws(() => Object.setPrototypeOf(substitute, EventEmitter.prototype), { instanceOf: TypeError }, how)
      t.is(viaObject!.message, `${path} is not extensible: its prototype cannot be changed after Object.freeze(), Object.seal() or Object.preventExtensions()`)
      t.false(/trap|falsish|proxy/i.test(viaObject!.message), viaObject!.message)
      // (a trap cannot tell Reflect.setPrototypeOf apart: it throws the same error, where an ordinary object gives false)
      t.throws(() => Reflect.setPrototypeOf(substitute, EventEmitter.prototype), { instanceOf: TypeError, message: viaObject!.message })

      // the prototype it already has: no change, so it succeeds, as for an ordinary non-extensible object
      t.is(Object.setPrototypeOf(substitute, Object.getPrototypeOf(substitute)), substitute)
      t.true(Reflect.setPrototypeOf(substitute, Object.getPrototypeOf(substitute)))
      // and the substitute still works
      substitute.emit('x')
      t.notThrows(() => substitute.received(1).emit('x'))
    }
  }
  // a substitute that is not frozen still takes a new prototype (E55)
  const open = Substitute.for<any>()
  t.is(Object.setPrototypeOf(open, EventEmitter.prototype), open)
  t.true(open instanceof EventEmitter)
})

// ---- E63 (R10-ADV-2): two copies of the library share the printing and comparing guard ---------------------------

/** Loads a second, independent copy of the package (as duplicate installs do), as duplicate-copies.test.ts does. */
const loadSecondCopy = (): typeof library => {
  const entry = require.resolve('../../../src')
  const root = path.dirname(entry) + path.sep
  const saved = new Map<string, NodeModule>()
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) {
      saved.set(key, require.cache[key]!)
      delete require.cache[key]
    }
  }
  try {
    return require(entry)
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key]
    for (const [key, module] of saved) require.cache[key] = module
  }
}

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/**
 * R10-ADV-2's scenario: a host substitute of `hostLibrary` receives instances of a class that extends a substitute of
 * this copy, and is checked (its copy compares them, and prints them for the failure). What the substitute of this copy
 * recorded.
 */
const recordedThroughInheritance = (hostLibrary: typeof library): string => {
  const sdk = Substitute.for<any>()
  class Plugin extends sdk.Base { constructor(readonly id: number) { super() } }
  const host = hostLibrary.Substitute.for<any>()
  host.register(new Plugin(1))
  try { host.received(1).register(new Plugin(2)) } catch { /* fails, and is printed */ }
  host.didNotReceive().register(new Plugin(2))
  return plain(String(sdk))
}

test('R10-ADV-2 (E63) reads that another copy of the library makes while it compares or prints record nothing on a substitute', t => {
  const copyB = loadSecondCopy()
  t.not(copyB.Substitute, Substitute)
  const withOneCopy = recordedThroughInheritance(library)
  const withTwoCopies = recordedThroughInheritance(copyB)
  // 8ce308a: with two copies, also `Base.prototype.href` twice (Node.js 22; href, protocol and auth on Node.js 20)
  t.is(withTwoCopies, withOneCopy)
  t.false(/href|protocol|auth/.test(withTwoCopies), withTwoCopies)
  t.true(withOneCopy.includes('new Base()'), withOneCopy)

  // the same for an object that inherits from a substitute through Object.create, compared by the other copy
  const sdk = Substitute.for<any>()
  const derived = Object.create(sdk)
  derived.name = 'derived'
  const host = copyB.Substitute.for<any>()
  host.use(derived)
  t.notThrows(() => host.received(1).use(derived))
  t.throws(() => host.received(1).use({ name: 'other' }))
  t.notThrows(() => sdk.didNotReceive().href)
  t.notThrows(() => sdk.didNotReceive().protocol)
  t.false(/href|protocol|auth|name/.test(plain(String(sdk))), plain(String(sdk)))
})

test('R10-ADV-2 (E63) a substitute of another copy among the arguments prints as its path, as one of the same copy does', t => {
  const copyB = loadSecondCopy()
  for (const hostLibrary of [library, copyB]) {
    const dependency = Substitute.for<any>()
    dependency.load(1)
    dependency.save(2).returns(true)
    const host = hostLibrary.Substitute.for<any>()
    host.use(dependency)
    const error = t.throws(() => host.received(1).use(1))
    t.true(plain(error!.message).includes('› ✘ @Substitute.use(@Substitute)\n'), error!.message)
    t.is(plain(String(host)), '@Substitute {\n  received:\n    use(@Substitute)\n}')
  }
})
