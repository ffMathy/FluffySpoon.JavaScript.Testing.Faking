import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 5: the runtime findings of the round-4 verification (R4-ADV-*), decided in the fix spec as E8-E12.

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

// ---- code under test for E8, in functions of its own (as in a module under test) ----

/** Invokes the method it was given on the client it was given, as `this`. */
class Loader {
  constructor(private readonly client: unknown, private readonly fetch: (id: number) => any) { }
  load(id: number) { return Reflect.apply(this.fetch, this.client, [id]) }
}

const uncurryCall: (method: Function, thisArg: unknown, ...args: any[]) => any = Function.prototype.call.bind(Function.prototype.call)

/** A generic retry helper that invokes a method on its owner through an uncurried Function.prototype.call. */
function retry(owner: unknown, method: Function, ...args: any[]) {
  return uncurryCall(method, owner, ...args)
}

/** Wraps a method of a client, and invokes it on the client. */
function timed(client: unknown, method: Function) {
  return (...args: any[]) => Reflect.apply(method, client, args)
}

test('R4-ADV-1 (E8) a method reference that the code under test invokes with the substitute as `this` is a call made where it is invoked', t => {
  // Reflect.apply(fetch, client, [id]) in the code under test: right after the read, with this === the substitute
  const api = Substitute.for<any>()
  const loader = new Loader(api, api.getUser) // the test hands over a method reference
  const user = loader.load(1) // the code under test calls api.getUser(1)
  user.name.returns('ann') // the test configures the value it got back
  t.is(user.name, 'ann')
  t.notThrows(() => api.received(1).getUser(1))
  t.throws(() => api.didNotReceive().getUser(1), { instanceOf: SubstituteException })
  t.regex(messageOf(() => api.received(2).getUser(1)), /› ✔ @Substitute\.getUser\(1\)\n {4}called at Loader\.load /)

  // an uncurried Function.prototype.call in the code under test
  const repository = Substitute.for<any>()
  const order = retry(repository, repository.findOrder, 7)
  order.total.returns(99)
  t.is(order.total, 99)
  t.notThrows(() => repository.received(1).findOrder(7))
  t.throws(() => repository.didNotReceive().findOrder(7), { instanceOf: SubstituteException })

  // a wrapper that the test creates with a method reference, and calls
  const client = Substitute.for<any>()
  const getUser = timed(client, client.getUser)
  const result = getUser(2)
  result.id.returns(2)
  t.is(result.id, 2)
  t.notThrows(() => client.received(1).getUser(2))
  t.throws(() => client.didNotReceive().getUser(2), { instanceOf: SubstituteException })
  t.regex(messageOf(() => client.received(2).getUser(2)), /called at <anonymous> |called at .*round5\.test\.(ts|js):\d+/)
})

test('R4-ADV-1 (E8) a method read and invoked in the test is still one expression, also through Reflect.apply or call', t => {
  const app = Substitute.for<any>()
  app.getCalc().add(1, 2).returns(3)
  app.logger.child('x').info.returns(undefined)
  app.getUser(1).name.returns('ann')
  // builtins such as Reflect.apply and Function.prototype.call have no frame of their own: the test invokes the method
  ;(Reflect.apply(app.getUser, app, [2]) as any).name.returns('bob')
  ;(Function.prototype.call.call(app.getUser, app, 3) as any).name.returns('cid')
  // E24 (round 7): the root also shows the setups of its auto-substitutes, under their paths; nothing is recorded
  t.is(inspect(app), "@Substitute {\n  configured:\n    getCalc().add(1, 2) => returns(3)\n    logger.child('x').info => returns(undefined)\n" +
    "    getUser(1).name => returns('ann')\n    getUser(2).name => returns('bob')\n    getUser(3).name => returns('cid')\n}", 'the setups recorded nothing')
  t.is(app.getCalc().add(1, 2), 3)
  t.is(app.getUser(1).name, 'ann')
  t.is(app.getUser(2).name, 'bob')
  t.is(app.getUser(3).name, 'cid')

  // a call in the test is a call made in the test
  const logger = Substitute.for<any>()
  logger.info('started')
  t.regex(messageOf(() => logger.received(2).info('started')), /called at .*round5\.test\.(ts|js):\d+/)
  t.notThrows(() => logger.received(1).info('started'))
})

test('R4-ADV-1 (E8) a method reference invoked by a builtin (Array.prototype.map) is a call made by the builtin', t => {
  const api = Substitute.for<any>()
  const users: any[] = [1, 2].map(api.getUser)
  users[1].name.returns('bob')
  t.is(users[1].name, 'bob')
  // map passes the item, its index and the array
  t.notThrows(() => api.received(2).getUser(Arg.all()))
  t.notThrows(() => api.received(1).getUser(2, 1, Arg.all()))
})

/** How many call sites an operation captures (each capture is most of what an operation costs, E11). */
const capturesOf = (run: () => void): number => {
  const original = Error.captureStackTrace
  let count = 0
  Error.captureStackTrace = function (this: unknown, ...args: Parameters<typeof Error.captureStackTrace>) {
    count++
    return original.apply(this, args)
  }
  try {
    run()
  } finally {
    Error.captureStackTrace = original
  }
  return count
}

test('E11 a recorded operation captures its call site once', t => {
  // one capture per recorded operation: four reads and one call. Reading frames for the chain (D25) captures nothing
  // more: it looks at the call sites of the records themselves.
  const app = Substitute.for<any>()
  t.is(capturesOf(() => app.a.b.c.d(1)), 5)
  const sub = Substitute.for<any>()
  t.is(capturesOf(() => sub.f(1)), 2)
  t.is(capturesOf(() => void sub.prop), 1)
  // the frames were read without taking the text of the call sites
  t.regex(messageOf(() => app.a.b.c.received(2).d(1)), /called at .*round5\.test\.(ts|js):\d+/)
  t.regex(messageOf(() => app.a.received(2).b), /called at .*round5\.test\.(ts|js):\d+/)
})
