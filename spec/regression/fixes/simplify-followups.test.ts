import test from 'ava'

import { Substitute, Arg, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Follow-ups of the removal of the performance mechanisms (fb85845): the findings of its reviewers (S-EQ-n, S-ADV-n).

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of a failing check, without colours. */
const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message)
  }
  throw new Error('expected the assertion to fail')
}

// ---- S-EQ-2: an order that matching ignores, one level inside an argument -----------------------------------------

test('S-EQ-2 keys or Map entries in another order one level inside an argument are printed as deep as the difference', t => {
  // the same keys in another order, differing four levels down: both lines print down to z
  const s = Substitute.for<any>()
  s.f({ o: { a: { q: 1 }, b: { x: { y: { z: 1 } } } } })
  const message = messageOf(() => s.received(1).f({ o: { b: { x: { y: { z: 7 } } }, a: { q: 1 } } }))
  t.true(message.includes('z: 7'), message)
  t.true(message.includes('z: 1'), message)
  t.false(message.includes('[Object]'), message)

  // the entries of a Map with object keys in another order
  const k1 = { k: 1 }
  const k2 = { k: 2 }
  const m = Substitute.for<any>()
  m.f({ m: new Map<object, unknown>([[k1, 1], [k2, { x: { y: { z: 1 } } }]]) })
  const mapMessage = messageOf(() => m.received(1).f({ m: new Map<object, unknown>([[k2, { x: { y: { z: 7 } } }], [k1, 1]]) }))
  t.true(mapMessage.includes('z: 7'), mapMessage)
  t.true(mapMessage.includes('z: 1'), mapMessage)
})

// ---- S-ADV-2: what a received call answered, after its argument changed --------------------------------------------

test('S-ADV-2 (E81) a check through a call with matchers counts the auto-substitute each call answered, also once its argument equals another call\'s', t => {
  const repo = Substitute.for<any>()
  const first = { id: 1 }
  const second = { id: 2 }
  repo.find(first).save()
  repo.find(second).save()
  second.id = 1 // changed after the call: now equal to the first call's argument
  t.notThrows(() => repo.find(Arg.any()).received(2).save())
  t.regex(messageOf(() => repo.find(Arg.any()).received(1).save()), /but received 2/)

  // with a predicate that both arguments pass now: each save() is on its own call's auto-substitute
  const orders = Substitute.for<any>()
  const a = { id: 1 }
  const b = { id: 2 }
  orders.find(a).save('a')
  orders.find(b).save('b')
  b.id = 1
  t.notThrows(() => orders.find(Arg.is((order: { id: number }) => order.id === 1)).received(1).save('b'))
  t.notThrows(() => orders.find(Arg.is((order: { id: number }) => order.id === 1)).received(1).save('a'))

  // the same through call (D26: the direct reading of the invocation)
  const viaCall = Substitute.for<any>()
  const c = { id: 1 }
  const d = { id: 2 }
  viaCall.find.call(viaCall, c).save()
  viaCall.find.call(viaCall, d).save()
  d.id = 1
  t.notThrows(() => viaCall.find(Arg.any()).received(2).save())
})

test('S-ADV-2 (E81) a service that changes a filter after using it: both queries\' results are counted', async t => {
  type Order = { id: string }
  const repo = Substitute.for<{ find(filter: { status: string }): { first(): Promise<Order | undefined> } }>()
  const paid = { status: 'paid' }
  const pending = { status: 'pending' }
  await repo.find(paid).first()
  await repo.find(pending).first()
  pending.status = 'paid'
  t.notThrows(() => (repo.find(Arg.any()) as any).received(2).first())
})

// ---- S-ADV-3: a failure message whose expected argument shares containers -----------------------------------------

test('S-ADV-3 a failing check whose expected argument shares containers reports its failure (each shared container is copied once)', t => {
  // a resolved dependency graph: the packages of a layer share one array of dependencies (3^n paths through n layers)
  const graph = (version: string, layers: number) => {
    let next: unknown[] = []
    for (let layer = 0; layer < layers; layer++) {
      const current = Array.from({ length: 3 }, (_, index) => ({ name: `p${layer}-${index}`, version, deps: next }))
      next = current
    }
    return { root: true, deps: next }
  }
  const resolver = Substitute.for<any>()
  resolver.install(graph('1.0.0', 30))
  t.regex(messageOf(() => resolver.received(1).install(graph('1.0.1', 30))), /^Call count mismatch in @Substitute\.install:/)

  // a wide one, four levels deep: each level's 200 keys refer to the same object of the next level
  const wide = (leaf: number) => {
    let level: object = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, leaf]))
    for (let depth = 0; depth < 3; depth++) {
      const shared = level
      level = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`k${index}`, shared]))
    }
    return level
  }
  const store = Substitute.for<any>()
  store.save(wide(1))
  t.regex(messageOf(() => store.received(1).save(wide(2))), /^Call count mismatch in @Substitute\.save:/)

  // a matcher in a shared container stands for the received value at each of its places (the cities do not tell the
  // lines apart, so they are printed down to where they differ)
  const address = { city: Arg.any(), geo: { at: { lat: 1 } } }
  const trips = Substitute.for<any>()
  trips.book({ from: { city: 'A', geo: { at: { lat: 1 } } }, to: { city: 'B', geo: { at: { lat: 2 } } } })
  const message = messageOf(() => trips.received(1).book({ from: address, to: address }))
  t.true(message.includes('lat: 2'), message)
})

// ---- S-ADV-4: what the getters of the values compared do -----------------------------------------------------------

test('S-ADV-4 calls that a getter of an argument makes on a substitute while the library compares arguments are not recorded', t => {
  type Pricing = { priceOf(sku: string): number }
  const line = (pricing: Pricing, sku: string, qty: number) => ({ sku, get total() { return pricing.priceOf(sku) * qty }, qty })
  const pricing = Substitute.for<Pricing>()
  pricing.priceOf(Arg.any()).returns(10)
  const cart = Substitute.for<any>()
  // each call is compared with the auto-substitutes of the earlier ones, which runs the getter on both sides
  for (let qty = 1; qty <= 10; qty++) cart.add(line(pricing, 'A', qty))
  t.notThrows(() => pricing.didNotReceive().priceOf(Arg.any()))

  // compared with a literal setup: the getter sees the configured values, and uses up none of a returns() sequence
  const prices = Substitute.for<Pricing>()
  prices.priceOf('B').returns(5, 6)
  const checkout = Substitute.for<any>()
  checkout.add({ sku: 'B', total: 10, qty: 2 }).returns('added')
  t.is(checkout.add(line(prices, 'B', 2)), 'added')
  t.notThrows(() => prices.didNotReceive().priceOf(Arg.any()))
  t.is(prices.priceOf('B') as unknown, 5)
  t.notThrows(() => prices.received(1).priceOf('B'))
})

// ---- S-ADV-1: an Error.prepareStackTrace that writes no "Error" line ----------------------------------------------

test('S-ADV-1 with an Error.prepareStackTrace that writes the frames only, "called at" lines and deferred reports name the operation', t => {
  const original = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')
  const lineOf = (frame: string | undefined) => /:(\d+):\d+\)?$/.exec(frame ?? '')?.[1]
  // (the formatter below writes the caller's frame first)
  const here = () => new Error().stack!.split('\n')[1]
  const clock = interceptDeferredReports()
  Error.prepareStackTrace = (_error, callSites) => callSites.map(callSite => `    at ${callSite}`).join('\n')
  try {
    const calculator = Substitute.for<any>()
    // (each operation and the line it is on in one statement, which the compiled test keeps on one line)
    const addLine = (calculator.add(1, 2), here())
    const calledAt = messageOf(() => calculator.received(2).add(1, 2)).split('\n').filter(text => /called at /.test(text))
    t.is(calledAt.length, 1, calledAt.join('\n'))
    t.is(lineOf(calledAt[0]), lineOf(addLine))

    // the report of a property-style check that fails later, and of a check view that nothing follows
    const checkLine = (void calculator.received(2).add, here())
    const danglingLine = (calculator[received](1), here())
    const errors = clock.run()
    t.is(errors.length, 2)
    for (const [index, error] of errors.entries()) {
      const frames = (error as Error).stack!.split('\n').filter(text => /^\s+at /.test(text))
      t.is(frames.length, 1, (error as Error).stack)
      t.is(lineOf(frames[0]), lineOf(index === 0 ? checkLine : danglingLine), (error as Error).stack)
    }
  } finally {
    if (original === undefined) delete (Error as any).prepareStackTrace
    else Object.defineProperty(Error, 'prepareStackTrace', original)
    clock.uninstall()
  }
})
