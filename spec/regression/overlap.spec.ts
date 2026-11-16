import test from 'ava'

import { Substitute, received, didNotReceive } from '../../src'

// D11: when T has a member named received/didNotReceive (or returns/throws/resolves/rejects/mimicks), the typings only
// offer the symbol forms [received]/[didNotReceive]. The string forms keep working at runtime (for JavaScript users),
// which is what the `as any` lines below exercise.
export interface OverlappingInterface {
  received(value: number): string
  didNotReceive(): unknown
  clearReceivedCalls(): void
}

test('(clearReceivedCalls) handles overlaps safely without substitutions', t => {
  const substitute = Substitute.for<Omit<OverlappingInterface, 'received'>>()
  substitute.clearReceivedCalls()
  t.notThrows(() => (substitute as any).received(1).clearReceivedCalls())
  t.throws(() => substitute[didNotReceive]().clearReceivedCalls())
  })

test('(clearReceivedCalls) handles overlaps safely with substitutions', t => {
  const substitute = Substitute.for<Omit<OverlappingInterface, 'received'>>()
  substitute.clearReceivedCalls().returns()
  substitute.clearReceivedCalls()
  t.notThrows(() => (substitute as any).received(1).clearReceivedCalls())
  t.throws(() => substitute[didNotReceive]().clearReceivedCalls())
})

test('(received) handles overlaps safely without substitutions', t => {
  const substitute = Substitute.for<Omit<OverlappingInterface, 'didNotReceive'>>()
  substitute.received(10)
  t.notThrows(() => substitute[received](1).received(10))
  t.throws(() => (substitute as any).didNotReceive().received(10))
})

test('(received) handles overlaps safely with substitutions', t => {
  const substitute = Substitute.for<Omit<OverlappingInterface, 'didNotReceive'>>()
  substitute.received(10).returns('foo')
  t.is('foo', substitute.received(10))
  t.notThrows(() => substitute[received](1).received(10))
  t.throws(() => (substitute as any).didNotReceive().received(10))
})

test('(didNotReceive) handles overlaps safely without substitutions', t => {
  const substitute = Substitute.for<Omit<OverlappingInterface, 'received'>>()
  substitute.didNotReceive()
  t.notThrows(() => (substitute as any).received(1).didNotReceive())
  t.throws(() => substitute[didNotReceive]().didNotReceive())
})

test('(didNotReceive) handles overlaps safely with substitutions', t => {
  const substitute = Substitute.for<Omit<OverlappingInterface, 'received'>>()
  substitute.didNotReceive().returns('foo')
  t.is('foo' as unknown, substitute.didNotReceive())
  t.notThrows(() => (substitute as any).received(1).didNotReceive())
  t.throws(() => substitute[didNotReceive]().didNotReceive())
})
