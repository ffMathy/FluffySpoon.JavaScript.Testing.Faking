import test from 'ava'
import { EventEmitter } from 'events'

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
