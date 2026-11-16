import test from 'ava'
import { types } from 'util'

import { Substitute, received, didNotReceive, mimick } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

const substitutionNames = ['returns', 'throws', 'resolves', 'rejects', 'mimicks']

test('G:RG-1 symbol assertions on members named returns/throws/resolves/rejects/mimicks are evaluated', t => {
  for (const name of substitutionNames) {
    const neverRead = Substitute.for<any>()
    t.throws(() => neverRead[received](1)[name], { instanceOf: SubstituteException }, `${name}: never read`)

    const readOnce = Substitute.for<any>()
    void readOnce[name]
    t.throws(() => readOnce[received](2)[name], { instanceOf: SubstituteException }, `${name}: read once, received(2)`)
    t.throws(() => readOnce[didNotReceive]()[name], { instanceOf: SubstituteException }, `${name}: read once, didNotReceive()`)
    t.notThrows(() => readOnce[received](1)[name], `${name}: read once, received(1)`)

    // invoked members: the assertion checks the arguments instead of configuring the member
    const invoked = Substitute.for<any>()
    invoked[name](7)
    t.throws(() => invoked[received](1)[name](5), { instanceOf: SubstituteException }, `${name}(7) called, received(1).${name}(5)`)
    t.throws(() => invoked[didNotReceive]()[name](7), { instanceOf: SubstituteException }, `${name}(7) called, didNotReceive().${name}(7)`)
    t.notThrows(() => invoked[received](1)[name](7), `${name}(7) called, received(1).${name}(7)`)
    t.notThrows(() => invoked[didNotReceive]()[name](5), `${name}(7) called, didNotReceive().${name}(5)`)

    // an assertion never turns into a substitution: later assertions keep working
    const called = Substitute.for<any>()
    called.add(1, 2)
    t.throws(() => called[received](1)[name](1), { instanceOf: SubstituteException }, `${name}: never called`)
    t.notThrows(() => called.received(1).add(1, 2), `${name}: follow-up`)
    t.notThrows(() => called[received](1).add(1, 2), `${name}: follow-up (symbol)`)
  }
})

test('G:RG-2 received(n) with a negative, fractional or NaN count throws', t => {
  const expected = 3
  const cases: Array<[string, (substitute: any) => unknown]> = [
    ['received(-1).add()', s => s.received(-1).add()],
    ['received(0.5).add()', s => s.received(0.5).add()],
    ['received(NaN).add()', s => s.received(NaN).add()],
    ['received(expected / 2).add()', s => { s.add(); return s.received(expected / 2).add() }],
    ['received(-1).v = 1', s => { s.received(-1).v = 1 }],
    ['[received](-1)', s => s[received](-1)]
  ]
  for (const [label, run] of cases)
    t.throws(() => run(Substitute.for<any>()), { instanceOf: SubstituteException }, label)
})

test('G:RG-5 received/didNotReceive below the root are ordinary members unless invoked as assertions', t => {
  // code under test reading a nested member called received
  const inbox = Substitute.for<any>()
  t.is(typeof inbox.latest.received.getTime(), 'function')
  t.notThrows(() => { inbox.latest.received.total = 3 })

  // nested assertions check the nested substitute, not root members with the same name
  const withChild = Substitute.for<any>()
  withChild.child.save()
  t.notThrows(() => withChild.child.received().save())
  t.throws(() => withChild.received().save(), { instanceOf: SubstituteException })

  const repository = Substitute.for<any>()
  const user = repository.getUser(1)
  user.save()
  t.notThrows(() => user.received().save())

  const rootOnly = Substitute.for<any>()
  rootOnly.save()
  t.throws(() => rootOnly.child.received().save(), { instanceOf: SubstituteException })
  t.notThrows(() => rootOnly.child.didNotReceive().save())
})

test('G:RG-7 the string mimick is an ordinary member and sub[mimick](instance) is implemented', t => {
  const real = { add: (a: number, b: number) => a + b }
  const viaString = Substitute.for<any>()
  viaString.mimick(real)
  t.true(types.isProxy(viaString.add(1, 2)))
  t.notThrows(() => viaString.received(1).mimick(real))

  const viaSymbol = Substitute.for<any>()
  viaSymbol[mimick](real)
  t.is(viaSymbol.add(1, 2), 3)
  t.notThrows(() => viaSymbol.received(1).add(1, 2))
  t.notThrows(() => viaSymbol.didNotReceive().mimick(real))
})
