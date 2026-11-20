import test, { ExecutionContext } from 'ava'
import { interceptDeferredReports } from '../../helpers/deferredReports'
import { EventEmitter } from 'events'
import { inspect, types } from 'util'

import { Substitute, Arg, received, clearReceivedCalls } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

/*
 * The tests of the other round-1 engine (branch fix/engine-a) that depend on its message wording, ported with
 * this engine's wording (see ported-from-a.spec.ts for the ones ported unchanged). Every check is kept, except
 * where engine A pinned its strict D9 (a property-style failure on a member that was only invoked thrown at once):
 * the amended D9 reports that case on process.nextTick, and the ported check says so.
 */

const plain = (message: string) => message.replace(/\x1b\[\d+m/g, '')
const withoutCallSites = (message: string) => plain(message).split('\n').filter(line => !line.includes('called at')).join('\n')
// runtime behaviour only: the substitutes are untyped so that the specs do not depend on the typings
const substitute = <T = unknown>(): any => Substitute.for<T>()

/** The message of a failure that is only reported on process.nextTick; nothing may be thrown before. */
const messageOnNextTick = (cb: () => unknown, t: ExecutionContext): string => {
  const clock = interceptDeferredReports()
  try {
    t.notThrows(cb)
    return plain(t.throws<SubstituteException>(() => clock.tick(1), { instanceOf: SubstituteException }).message)
  } finally {
    clock.uninstall()
  }
}

test('A:RT-3 a method that was only read is not a received method call', t => {
  const handler = substitute()
  new EventEmitter().on('click', handler.onClick)

  t.throws(() => handler.received().onClick(42), { instanceOf: SubstituteException })
  t.throws(() => handler.received(1).onClick(42), { instanceOf: SubstituteException })
  const { message } = t.throws(() => handler.received(1).onClick('x', 1), { instanceOf: SubstituteException })
  t.true(plain(message).includes('Expected to receive 1 method call matching onClick(\'x\', 1), but received none.'))
  t.true(plain(message).includes('was read 1 time without being called'))

  // once the reads are cleared, didNotReceive().onClick(...) is a method assertion (see the D9 spec for why it is not before)
  handler[clearReceivedCalls]()
  t.notThrows(() => handler.didNotReceive().onClick(42))
})

test('A:RT-8 mutually referencing substitutes give a SubstituteException, not a stack overflow', t => {
  const parent = substitute()
  const child = substitute()
  parent.addChild(child)
  child.setParent(parent)

  const { message } = t.throws(() => parent.received().addChild(parent), { instanceOf: SubstituteException })
  // (round 9, E52: the expected and the received call print alike apart from the substitute passed, so the message
  // numbers the substitutes)
  t.true(withoutCallSites(message).includes('› ✘ @Substitute#1.addChild(@Substitute#2)'))
  t.notThrows(() => parent.received().addChild(child))

  const self = substitute()
  self.link(self)
  t.throws(() => self.received().link(2), { instanceOf: SubstituteException })
  t.notThrows(() => self.received(1).link(self))
  // wording: this engine prints the received calls of a substitute under "received:"
  t.regex(inspect(self), /@Substitute \{\n {2}received:\n {4}link\(@Substitute\)\n\}/)

  const value: { self?: unknown } = {}
  const holder = substitute()
  value.self = holder
  holder.take(value)
  const { message: objectMessage } = t.throws(() => holder.received().take(5), { instanceOf: SubstituteException })
  t.true(withoutCallSites(objectMessage).includes('@Substitute.take({ self: @Substitute })'))
  t.notThrows(() => holder.received().take({ self: holder }))
})

test('A:RT-9 a never-called method is not reported as "property calls"; expected arguments are included when known', t => {
  const calculator = substitute()
  const { message } = t.throws(() => calculator.received(3).add(1, Arg.any()), { instanceOf: SubstituteException })
  t.false(plain(message).includes('property call'))
  // wording: decided when add is read (D9), before the arguments are known, so both kinds are named
  t.is(plain(message), 'Call count mismatch in @Substitute.add:\nExpected to receive 3 property reads or method calls matching add, but received none.')

  calculator.multiply(7, 8)
  const { message: withArguments } = t.throws(() => calculator.received(1).multiply(7, Arg.is((x: number) => x > 8)), { instanceOf: SubstituteException })
  t.true(plain(withArguments).startsWith(
    'Call count mismatch in @Substitute.multiply:\n' +
    'Expected to receive 1 method call matching multiply(7, Arg.is{(x) => x > 8}), but received none.\n' +
    'All property or method calls to @Substitute.multiply received so far:\n' +
    '› ✘ @Substitute.multiply(7, 8)'
  ))

  calculator.isEnabled = true
  const { message: setMessage } = t.throws(() => { calculator.received(1).isEnabled = false }, { instanceOf: SubstituteException })
  t.true(plain(setMessage).startsWith(
    'Call count mismatch in @Substitute.isEnabled:\n' +
    'Expected to receive 1 property assignment matching isEnabled = false, but received none.\n' +
    'All property assignments to @Substitute.isEnabled received so far:\n' +
    '› ✘ @Substitute.isEnabled = true'
  ))
})

test('A:RT-12 failing assertions with recorded calls build their message when Error.stackTraceLimit is 0 (D18)', t => {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 0
  try {
    const calculator = substitute()
    calculator.add(1, 2)
    const { message } = t.throws(() => calculator.received().add(9, 9), { instanceOf: SubstituteException })
    t.is(plain(message), 'Call count mismatch in @Substitute.add:\n' +
      'Expected to receive 1 or more method calls matching add(9, 9), but received none.\n' +
      'All property or method calls to @Substitute.add received so far:\n' +
      '› ✘ @Substitute.add(1, 2)\n')
  } finally {
    Error.stackTraceLimit = limit
  }
})

test('A:RT-13 Arg.is() with a predicate that is not a function throws a TypeError right away (D17)', t => {
  for (const predicate of [undefined, null, 5, 'x', {}, Object.create(null)]) {
    t.throws(() => Arg.is(predicate as any), { instanceOf: TypeError, message: /Arg\.is expects a predicate function/ })
    t.throws(() => Arg.is.not(predicate as any), { instanceOf: TypeError, message: /Arg\.is expects a predicate function/ })
  }
})

test('D9 a property-style assertion is decided when the member is read; reading a method fails didNotReceive() on it', t => {
  // A never-invoked member that was read cannot be told apart from a property: the assertion is decided when it is
  // read (synchronously), so didNotReceive().onClick(...) fails after onClick was only read (e.g. to register it as a
  // callback). Clearing the received calls after reading it is the way to assert it is never invoked.
  const handler = substitute()
  const callback = handler.onClick
  const { message } = t.throws(() => handler.didNotReceive().onClick(42), { instanceOf: SubstituteException })
  // E77 (R12FE-2): the kind-neutral wording, as for any member that was read and never called
  t.true(plain(message).includes('Expected to receive 0 property reads or method calls matching onClick, but received 1 property read and no method calls.'))
  t.true(plain(message).includes('Call sub[clearReceivedCalls]() after the arrange step to reset the reads.'))

  handler[clearReceivedCalls]()
  t.notThrows(() => handler.didNotReceive().onClick(42))
  callback(42)
  t.throws(() => handler.didNotReceive().onClick(42), { instanceOf: SubstituteException })
  t.notThrows(() => handler.didNotReceive().onClick(43))

  // "1 or more" is satisfied by a property read as well as by an invocation of the member
  const component = substitute()
  component.render()
  t.notThrows(() => component.received().render)
  t.notThrows(() => component.received().render())
})

test('D11 the string received/didNotReceive is the assertion API only when invoked and followed by a member access', t => {
  const message = substitute()
  t.is(typeof message.received.getTime(), 'function')
  t.true(types.isProxy(message.received.x.y))
  message.didNotReceive.value = 1

  const overlapping = substitute()
  overlapping.received(10).returns('ten')
  overlapping.didNotReceive().returns('nothing')
  t.is(overlapping.received(10), 'ten')
  t.is(overlapping.didNotReceive(), 'nothing')
  t.notThrows(() => overlapping[received](1).received(10))
  t.notThrows(() => overlapping[received](1).didNotReceive())

  const calculator = substitute()
  calculator.add(1)
  t.notThrows(() => calculator.received(1).add(1))
  t.throws(() => calculator.received(2).add(1), { instanceOf: SubstituteException })
  // wording: "Expected count has to be a non-negative integer (or omitted for "1 or more"), but received ..."
  t.throws(() => calculator.received('x').add(1), { instanceOf: SubstituteException, message: /non-negative integer/ })
  t.throws(() => calculator.received(Arg.any()).add(1), { instanceOf: SubstituteException, message: /non-negative integer/ })
  t.notThrows(() => calculator.didNotReceive(Arg.any()).add(2))
  t.notThrows(() => { calculator.didNotReceive(Arg.any()).value = 1 })
  t.throws(() => { calculator.received(Arg.any()).value = 1 }, { instanceOf: SubstituteException, message: /non-negative integer/ })
  t.notThrows(() => calculator.didNotReceive().received)
})

test('D18 messages: kind-neutral wording when the kind is unknown, expected arguments when known', t => {
  const calculator = substitute()
  calculator.add(1, 2)
  void calculator.total

  // D36 (round 3): total was only read, with a count above the reads, so it fails for both readings
  t.is(plain(t.throws(() => calculator.received(2).total)!.message).split('\n')[1],
    'Expected to receive 2 property reads or method calls matching total, but received 1 property read and no method calls.')
  // amended D9: add was only invoked, so a property-style failure is reported on process.nextTick (engine A threw it
  // at once) and says that add was called as a method
  t.is(messageOnNextTick(() => calculator.received(2).add, t).split('\n')[1],
    'Expected to receive 2 property reads matching add, but received none. ' +
    'add was never read as a property; it was called 1 time as a method. To assert calls, invoke it: sub.received(2).add(...)')
  t.is(plain(t.throws(() => calculator.received().missing)!.message).split('\n')[1], 'Expected to receive 1 or more property reads or method calls matching missing, but received none.')
  t.is(plain(t.throws(() => calculator.received(1).add(1, Arg.any('string')))!.message).split('\n')[1], 'Expected to receive 1 method call matching add(1, Arg.any{string}), but received none.')
  t.is(plain(t.throws(() => calculator.received(0).add(1, 2))!.message).split('\n')[1], 'Expected to receive 0 method calls matching add(1, 2), but received 1.')

  const many = substitute()
  for (let index = 0; index < 60; index++) many.log(index)
  const { message } = t.throws(() => many.received(1).log('x'), { instanceOf: SubstituteException })
  t.true(plain(message).includes('› … and 10 more'))
})

interface Repository { add(a: number, b: number): number }

test('R:RT-6 received() with an invalid count throws synchronously', t => {
  for (const count of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, {}]) {
    const repository = substitute<Repository>()
    // wording: "Expected count has to be a non-negative integer (or omitted for "1 or more"), but received ..."
    t.throws(() => repository.received(count as any).add(1, 2), { instanceOf: SubstituteException, message: /non-negative integer/ }, String(count))
    t.throws(() => repository[received](count as any), { instanceOf: SubstituteException, message: /non-negative integer/ }, String(count))
  }

  const repository = substitute<Repository>()
  repository.add(1, 2)
  t.notThrows(() => repository.received(1).add(1, 2))
  t.notThrows(() => repository.received(undefined).add(1, 2))
  t.notThrows(() => repository.received(0).add(2, 1))
  t.throws(() => repository.received(0).add(1, 2), { instanceOf: SubstituteException })
})
