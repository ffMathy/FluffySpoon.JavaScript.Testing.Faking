import test from 'ava'

import { Substitute, Arg, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 15, integration of fix/r15-engine-calls (E95: what a matcher's look does to substitutes leaves no trace) with
// E81 and fix/r15-engine-checks (E88-E90: checks through a call with matchers). A call with Arg matchers that a predicate
// makes while it runs is a setup or a check, as it is anywhere else: it records nothing, so E95 does not need to answer
// it as a plain call (which made a check through it count the calls of the auto-substitute of its matchers instead).

/** Runs `inner` inside an Arg.is predicate of a check that passes, and returns what `inner` did. */
const insidePredicate = (inner: () => void): 'passed' | string => {
  const target = Substitute.for<any>()
  target.f(1)
  let outcome = ''
  target.received(1).f(Arg.is(() => {
    try {
      inner()
      outcome = 'passed'
    } catch (error) {
      outcome = error instanceof SubstituteException ? 'SubstituteException' : String(error)
    }
    return true
  }))
  return outcome
}

test('E95 + E81 a check through a call with matchers made inside a predicate counts what the matching calls answered', t => {
  const bus = Substitute.for<any>()
  bus.on('saved', 1)()

  t.is(insidePredicate(() => bus.on('saved', Arg.any())[received](1)()), 'passed')
  t.is(insidePredicate(() => bus.on('saved', Arg.any()).received(1)()), 'passed')
  t.is(insidePredicate(() => bus.on('saved', Arg.any())[received](2)()), 'SubstituteException')
  // no vacuous pass
  t.is(insidePredicate(() => bus.on('saved', Arg.any())[didNotReceive]()()), 'SubstituteException')
  t.is(insidePredicate(() => bus.on('deleted', Arg.any())[didNotReceive]()()), 'passed')
  // the same as outside a predicate
  t.notThrows(() => bus.on('saved', Arg.any())[received](1)())
  t.throws(() => bus.on('saved', Arg.any())[didNotReceive]()(), { instanceOf: SubstituteException })
})

test('E95 + E81 + E91 the same through call, apply and a function substitute', t => {
  const client = Substitute.for<any>()
  client.rpc.call('getUser', 1).save()
  t.is(insidePredicate(() => client.rpc.call('getUser', Arg.any())[received](1).save()), 'passed')
  t.is(insidePredicate(() => client.rpc.call('getUser', Arg.any())[didNotReceive]().save()), 'SubstituteException')

  const api = Substitute.for<any>()
  api.fn.apply(null, [1]).go()
  t.is(insidePredicate(() => api.fn.apply(null, Arg.any())[didNotReceive]().go()), 'SubstituteException')

  const fn = Substitute.for<any>()
  fn(1).x()
  t.is(insidePredicate(() => fn(Arg.any())[received](1).x()), 'passed')
  t.is(insidePredicate(() => fn(Arg.any())[didNotReceive]().x()), 'SubstituteException')
})

test('E95 a setup made inside a predicate configures as anywhere else, and the predicate still leaves no trace', t => {
  const repo = Substitute.for<any>()
  t.is(insidePredicate(() => {
    repo.get(Arg.any()).returns(5)
    if (repo.get(1) !== 5) throw new Error('the setup does not answer')
    repo.bind(Arg.any()).returns('bound')
    if (repo.bind(null) !== 'bound') throw new Error('the bind setup does not answer')
  }), 'passed')
  // the calls the predicate made are not recorded
  t.notThrows(() => repo.didNotReceive().get(Arg.all()))
  t.notThrows(() => repo.didNotReceive().bind(Arg.all()))
  t.is(repo.get(2), 5)

  // a read that the code under test made, and invokes later, is not taken by a predicate's call with matchers
  const service = Substitute.for<any>()
  const getUser = service.getUser
  insidePredicate(() => service.getUser(Arg.any()))
  getUser(5)
  t.notThrows(() => service.received(1).getUser(5))
  t.is(String(service), '@Substitute {\n  received:\n    getUser(5)\n}')
})
