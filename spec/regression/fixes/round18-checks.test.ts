import test, { ExecutionContext } from 'ava'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 18, engine (checks through a call with matchers, and through a concrete call that a setup with matchers
// answered): the round-17 findings R17-ADV-1, R17-ADV-2, R17-ADV-12 and R17V-1 (= R17-ADV-6), decided in the fix spec as
// E122, E123 and E124. (E121, R17V-2, is a timing test: see round18-checks-hashing.test.ts.)

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of the SubstituteException that `check` throws (failing the test if it throws none or another error). */
const failureOf = (t: ExecutionContext, check: () => void, label?: string): string => {
  try {
    check()
  } catch (error) {
    if (error instanceof SubstituteException) return plain(error.message)
    throw error
  }
  t.fail(`the check passed, but it should have failed${label === undefined ? '' : `: ${label}`}`)
  return ''
}

/**
 * The six forms of a check. A check through a concrete call is one expression with that call (D25), and one on a single
 * line when a step answers the substitute it was made on (E111), so the tests write it so:
 * `db('orders').where('id', 1)[form.key](...form.args(count)).first()`.
 */
type CheckForm = { name: string, key: PropertyKey, args: (count: number) => number[], passes: (count: number, actual: number) => boolean }
const checkForms: CheckForm[] = [
  { name: 'received()', key: 'received', args: () => [], passes: (_count, actual) => actual >= 1 },
  { name: 'received(n)', key: 'received', args: count => [count], passes: (count, actual) => actual === count },
  { name: 'didNotReceive()', key: 'didNotReceive', args: () => [], passes: (_count, actual) => actual === 0 },
  { name: '[received]()', key: received, args: () => [], passes: (_count, actual) => actual >= 1 },
  { name: '[received](n)', key: received, args: count => [count], passes: (count, actual) => actual === count },
  { name: '[didNotReceive]()', key: didNotReceive, args: () => [], passes: (_count, actual) => actual === 0 }
]

/** What a check gives: 'pass', 'fail' (a failed count) or 'usage' (a usage error, "Cannot check through ..."). */
const outcomeOf = (check: () => unknown): 'pass' | 'fail' | 'usage' => {
  const clock = interceptDeferredReports()
  try {
    check()
    return 'pass'
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return error.message.startsWith('Cannot check through') ? 'usage' : 'fail'
  } finally {
    clock.run()
    clock.uninstall()
  }
}

/** Every check form with the counts 0, 1 and 2 through `check`, each expected to pass exactly when the form passes for `actual` calls. */
const expectCounts = (t: ExecutionContext, label: string, actual: number, check: (form: CheckForm, count: number) => void): void => {
  for (const form of checkForms) {
    for (const count of [0, 1, 2]) {
      t.is(outcomeOf(() => check(form, count)), form.passes(count, actual) ? 'pass' : 'fail', `${label}: ${form.name} with ${count}, ${actual} received`)
    }
  }
}

/** Every check form with the counts 0, 1 and 2 through `check`, each expected to be a usage error. */
const expectUsageError = (t: ExecutionContext, label: string, check: (form: CheckForm, count: number) => void): void => {
  for (const form of checkForms) {
    for (const count of [0, 1, 2]) t.is(outcomeOf(() => check(form, count)), 'usage', `${label}: ${form.name} with ${count}`)
  }
}

// ---- E122 (R17-ADV-1, R17-ADV-2): a route goes on past a substitute handed out again in the same expression ---------

/** A knex-style query builder: db(table) answers the builder qb, whose where() and orderBy() answer qb itself. */
const knex = () => {
  const db = Substitute.for<any>()
  const qb = Substitute.for<any>()
  db(Arg.any()).returns(qb)
  qb.where(Arg.all()).returns(qb)
  qb.orderBy(Arg.all()).returns(qb)
  return { db, qb }
}

test('R17-ADV-1 (E122) the finding: a check through db(\'orders\') with a self-returning where() counts nothing that came through db(\'users\')', t => {
  const { db } = knex()
  db('users').where('id', 1).first() // the code under test queries users only
  // (5c41ddc: received(1) passed and didNotReceive() failed with "received 1": every call of the builder was counted)
  expectCounts(t, "db('orders').where('id', 1)", 0, (form, count) => db('orders').where('id', 1)[form.key](...form.args(count)).first())
  t.true(failureOf(t, () => db('orders').where('id', 1).received(1).first()).includes('but received none.'))
  expectCounts(t, "db('users').where('id', 1)", 1, (form, count) => db('users').where('id', 1)[form.key](...form.args(count)).first())
})

test('R17-ADV-1 (E122) each self-returning step narrows as E99 says: all, none or a usage error, at depth 2 and 3', t => {
  // the same step with other arguments only: none came through it
  let { db } = knex()
  db('orders').where('id', 2).first()
  expectCounts(t, "where('id', 1) after where('id', 2)", 0, (form, count) => db('orders').where('id', 1)[form.key](...form.args(count)).first())
  expectCounts(t, "where('id', 2)", 1, (form, count) => db('orders').where('id', 2)[form.key](...form.args(count)).first())

  // with these and other arguments: which calls came through it cannot be told
  ;({ db } = knex())
  db('orders').where('id', 1).first()
  db('orders').where('id', 2).first()
  expectUsageError(t, "where('id', 1) after where('id', 1) and where('id', 2)", (form, count) => db('orders').where('id', 1)[form.key](...form.args(count)).first())
  expectCounts(t, "db('users'), never called", 0, (form, count) => db('users').where('id', 1)[form.key](...form.args(count)).first())

  // depth 3: a second self-returning step
  ;({ db } = knex())
  db('orders').where('id', 1).orderBy('date').first()
  expectCounts(t, "where('id', 1).orderBy('date')", 1, (form, count) => db('orders').where('id', 1).orderBy('date')[form.key](...form.args(count)).first())
  expectCounts(t, "where('id', 1).orderBy('name')", 0, (form, count) => db('orders').where('id', 1).orderBy('name')[form.key](...form.args(count)).first())
  expectCounts(t, "db('users') at depth 3", 0, (form, count) => db('users').where('id', 1).orderBy('date')[form.key](...form.args(count)).first())
  db('orders').where('id', 1).orderBy('name').first()
  expectUsageError(t, "orderBy('date') after orderBy('date') and orderBy('name')", (form, count) => db('orders').where('id', 1).orderBy('date')[form.key](...form.args(count)).first())

  // the same step twice in one expression
  ;({ db } = knex())
  db('orders').where('id', 1).where('id', 1).first()
  expectCounts(t, "where('id', 1).where('id', 1)", 1, (form, count) => db('orders').where('id', 1).where('id', 1)[form.key](...form.args(count)).first())
  expectCounts(t, "db('users').where('id', 1).where('id', 1)", 0, (form, count) => db('users').where('id', 1).where('id', 1)[form.key](...form.args(count)).first())
})

test('R17-ADV-1 (E122) socket.io and fastify: to() and code()/header() answering what they were called on', t => {
  // socket.io: io.to(room) answers an operator, whose to() answers the operator itself
  const io = Substitute.for<any>()
  const operator = Substitute.for<any>()
  io.to(Arg.any()).returns(operator)
  operator.to(Arg.any()).returns(operator)
  io.to('a').to('c').emit('m') // the code under test
  expectCounts(t, "io.to('b').to('c')", 0, (form, count) => io.to('b').to('c')[form.key](...form.args(count)).emit('m'))
  expectCounts(t, "io.to('a').to('d')", 0, (form, count) => io.to('a').to('d')[form.key](...form.args(count)).emit('m'))
  expectCounts(t, "io.to('a').to('c')", 1, (form, count) => io.to('a').to('c')[form.key](...form.args(count)).emit('m'))

  // fastify: every step answers the reply itself
  const reply = Substitute.for<any>()
  reply.code(Arg.any()).returns(reply)
  reply.header(Arg.all()).returns(reply)
  reply.code(404).header('x-id', '1').send('not found') // the code under test
  expectCounts(t, "reply.code(404).header('x-id', '1')", 1, (form, count) => reply.code(404).header('x-id', '1')[form.key](...form.args(count)).send('not found'))
  expectCounts(t, "reply.code(500).header('x-id', '1')", 0, (form, count) => reply.code(500).header('x-id', '1')[form.key](...form.args(count)).send('not found'))
  expectCounts(t, "reply.code(404).header('x-id', '2')", 0, (form, count) => reply.code(404).header('x-id', '2')[form.key](...form.args(count)).send('not found'))

  // a mimicked fluent builder (return this), and the concrete call made through call()
  const db = Substitute.for<any>()
  const qb = Substitute.for<any>()
  db(Arg.any()).returns(qb)
  qb[mimick]({ where() { return this }, first(): undefined { return undefined } })
  db('users').where('id', 1).first() // the code under test
  expectCounts(t, "mimicked: db('orders').where('id', 1)", 0, (form, count) => db('orders').where('id', 1)[form.key](...form.args(count)).first())
  expectCounts(t, "mimicked: db('users').where('id', 1)", 1, (form, count) => db('users').where('id', 1)[form.key](...form.args(count)).first())
  expectCounts(t, "mimicked: db.call(undefined, 'orders').where('id', 1)", 0, (form, count) => db.call(undefined, 'orders').where('id', 1)[form.key](...form.args(count)).first())
})

test('R17-ADV-2 (E122) the finding: a substitute handed out twice in one expression (a cycle) keeps the top step of the route', t => {
  const io = Substitute.for<any>()
  const room = Substitute.for<any>()
  io.to(Arg.any()).returns(room)
  room.back(Arg.any()).returns(io)
  io.to('a').back(1).to('a').emit('m') // nothing ever went through to('b')
  // (5c41ddc: received(1) passed, as the route began at the second to(); 8be3a70 failed it with "received none")
  expectCounts(t, "io.to('b').back(1).to('a')", 0, (form, count) => io.to('b').back(1).to('a')[form.key](...form.args(count)).emit('m'))
  t.true(failureOf(t, () => io.to('b').back(1).to('a').received(1).emit('m')).includes('but received none.'))
  expectCounts(t, "io.to('a').back(1).to('a')", 1, (form, count) => io.to('a').back(1).to('a')[form.key](...form.args(count)).emit('m'))
  expectCounts(t, "io.to('a').back(2).to('a')", 0, (form, count) => io.to('a').back(2).to('a')[form.key](...form.args(count)).emit('m'))
  // a check that ends on the cycle's first substitute again
  expectCounts(t, "io.to('a').back(1)", 0, (form, count) => io.to('a').back(1)[form.key](...form.args(count)).emit('m'))
  io.to('a').back(1).emit('n')
  expectCounts(t, "io.to('a').back(1) after emit('n')", 1, (form, count) => io.to('a').back(1)[form.key](...form.args(count)).emit('n'))
  expectCounts(t, "io.to('b').back(1)", 0, (form, count) => io.to('b').back(1)[form.key](...form.args(count)).emit('n'))
})

test('R17-ADV-2 (E122) a route whose upper part is no longer known is a usage error, never a check of its lower part', t => {
  // to() runs a function that hands the same io out from another substitute (another expression) while the check
  // expression goes through io: the expression's own hand-out of io is no longer known
  const io = Substitute.for<any>()
  const room = Substitute.for<any>()
  const other = Substitute.for<any>()
  other.give(Arg.any()).returns(io)
  io.to(Arg.any()).mimicks(() => {
    other.give(1)
    return room
  })
  room.back(Arg.any()).returns(io)
  io.to('a').back(1).to('a').emit('m') // the code under test
  const message = failureOf(t, () => io.to('b').back(1).to('a').received(1).emit('m'))
  t.true(message.startsWith("Cannot check through @Substitute.to('a'): before it, the expression went through back(1)"), message)
  // direct checks still count
  t.notThrows(() => room.received(1).emit('m'))
})

test('E122: the notes of an expression are bounded by it, and checks after it start afresh', t => {
  const { db, qb } = knex()
  // a long chain of the code under test, then checks in other expressions
  let query = db('orders')
  for (let index = 0; index < 50; index++) query = query.where('id', index)
  query.first()
  // (qb was returned to where('id', 0) and to where('id', 1) to where('id', 49))
  expectUsageError(t, "db('orders').where('id', 0)", (form, count) => db('orders').where('id', 0)[form.key](...form.args(count)).first())
  expectCounts(t, "db('users').where('id', 0)", 0, (form, count) => db('users').where('id', 0)[form.key](...form.args(count)).first())
  t.notThrows(() => qb.received(1).first())
  t.notThrows(() => qb.received(50).where('id', Arg.any()))
  t.notThrows(() => db.received(1)('orders'))
})
