import test from 'ava'
import { mock } from 'node:test'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import * as CallSite from '../../../src/internals/CallSite'

// Round 18 integration: interactions between the round-18 branches (fix/r18-lines E125-E127, fix/r18-checks E121-E124,
// fix/r18-mimick E129-E132) that no branch's own tests cover.

/** How many times the library read a stack frame (CallSite.frameOfStack / currentFrame) while `run` ran. */
const framesReadBy = (run: () => void): number => {
  const callSite = CallSite as any
  const frameOfStack = callSite.frameOfStack
  const currentFrame = callSite.currentFrame
  let reads = 0
  callSite.frameOfStack = (...args: any[]) => { reads++; return frameOfStack(...args) }
  callSite.currentFrame = (...args: any[]) => { reads++; return currentFrame(...args) }
  try {
    run()
  } finally {
    callSite.frameOfStack = frameOfStack
    callSite.currentFrame = currentFrame
  }
  return reads
}

test.serial('E122 x E126: the hand-out notes of a fluent method\'s calls (E122) read no stack frames when they are made (E126)', t => {
  const fluent = Substitute.for<any>()
  fluent[mimick]({ on() { return this } })
  const res = Substitute.for<any>()
  res.status(Arg.any()).returns(res)
  const reads = framesReadBy(() => {
    for (let index = 0; index < 100; index++) {
      fluent.on('a', index).on('b', index)
      fluent.on('c', index)
      res.status(200)
      res.status(201).status(202)
    }
  })
  t.is(reads, 0)
  t.notThrows(() => fluent.received(100).on('c', Arg.any()))
  t.notThrows(() => res.received(100).status(202))
})

test('E122 x E126: notes of fluent calls on earlier lines are decided when a check reads them, as if at once', t => {
  // a mimicked emitter whose on() and to() return the instance (E76: the substitute), and whose sel() hands out room
  const room = Substitute.for<any>()
  const emitter = Substitute.for<any>()
  emitter[mimick]({ on() { return this }, to() { return this }, sel() { return room } })
  emitter.on('x', 1)
  emitter.on('y', 2)
  emitter.to('a').on('z', 3).sel(1).emit('q')
  // nothing came through to('b'); what came through to('a') is a usage error (on('z', 3) answers what every call gets)
  t.throws(() => emitter.to('b').on('z', 3).sel(1).received(1).emit('q'), { message: /^Call count mismatch in @Substitute\.to\('b'\)\.on\('z', 3\)\.sel\(1\)\.emit/ })
  t.notThrows(() => emitter.to('b').on('z', 3).sel(1)[didNotReceive]().emit('q'))
  t.throws(() => emitter.on('y', 2).sel(1).received(1).emit('q'), { message: /^Cannot check through @Substitute\.on\('y', 2\)/ })

  // knex: a self-returning where() below a shared db(Arg.any()), with where() calls on lines of their own in between
  const db = Substitute.for<any>()
  const qb = Substitute.for<any>()
  db(Arg.any()).returns(qb)
  qb.where(Arg.all()).returns(qb)
  db('users').where('id', 1).where('x', 2).first()
  qb.where('y', 3)
  qb.where('z', 4)
  t.throws(() => db('orders').where('id', 1).where('x', 2).received(1).first(), { message: /^Call count mismatch in @Substitute\('orders'\)\.where\('id', 1\)\.where\('x', 2\)\.first/ })
  t.notThrows(() => db('orders').where('id', 1).where('x', 2)[didNotReceive]().first())
  t.throws(() => db('users').where('id', 1).where('x', 2)[received](1).first(), { message: /^Cannot check through @Substitute\('users'\)\.where\('id', 1\)/ })
})

test('E129 x E122 x E126: node:test\'s mock of a fluent member of a mimicked substitute keeps the chain on the substitute, and a check through a shared route narrows as without the mock', t => {
  const f = () => { }
  for (const withMock of [false, true]) {
    const listeners: Record<string, unknown[]> = {}
    const instance = { on(event: string, listener: unknown) { (listeners[event] = listeners[event] ?? []).push(listener); return this } }
    const emitter = Substitute.for<any>()
    emitter[mimick](instance)
    const spied = withMock ? mock.method(emitter, 'on') : undefined
    try {
      t.is(emitter.on('a', f).on('b', f), emitter, 'E76: the chain stays on the substitute')
      emitter.on('c', f)
      t.throws(() => emitter.didNotReceive().on('c', f), { message: /^Call count mismatch in @Substitute\.on/ }, 'E126: decided by the line rule, on the next line')
      t.deepEqual(Object.keys(listeners), ['a', 'b', 'c'], 'the instance ran each call')
      if (spied !== undefined) t.is(spied.mock.callCount(), 3, 'E129: the mock saw each call')
      // E122: a shared route below io.to(Arg.any()) whose answer is the emitter, with its fluent on() on the same line
      const io = Substitute.for<any>()
      io.to(Arg.any()).returns(emitter)
      io.to('r1').on('m', f).on('n', f)
      t.throws(() => io.to('r2').on('m', f).received(1).on('n', f), { message: /^Call count mismatch in @Substitute\.to\('r2'\)\.on\('m', \[Function: f\]\)\.on/ })
      t.notThrows(() => io.to('r2').on('m', f)[didNotReceive]().on('n', f))
    } finally {
      mock.restoreAll()
    }
  }
})

test('E132 x E122: the check remedies of the fluent-chain hint on shared and self-returning routes make the check pass when followed', t => {
  const remedyOf = (check: () => void): string => {
    try { check() } catch (error) { return String((error as Error).message).split('\n').find(line => / was not called on /.test(line)) ?? '' }
    return 'passed'
  }
  // written as code: below self-returning shared steps (E122), the remedy names the substitute itself
  const io = Substitute.for<any>()
  io.to(Arg.any()).returns(io)
  io.of(Arg.any()).returns(io)
  io.to('a').of('/x').broadcast.emit('m')
  const selfHint = remedyOf(() => io.to('a').of('/x').received(1).emit('m'))
  t.regex(selfHint, /check that substitute: sub\.broadcast\.received\(1\)\.emit\(\.\.\.\)$/)
  t.notThrows(() => new Function('sub', 'sub.broadcast.received(1).emit("m")')(io))

  // a Date on the route (E132): no code; reached with the same arguments, the check passes
  const date = new Date(0)
  const sub = Substitute.for<any>()
  sub.to(Arg.any()).except(Arg.all()).returns(true)
  sub.to(date).broadcast.emit('m')
  const dateHint = remedyOf(() => sub.to(date).received(1).emit('m'))
  t.regex(dateHint, /check that substitute, @Substitute\.to\(1970-01-01T00:00:00\.000Z\)\.broadcast, reached with the same arguments, with received\(1\) on it; its arguments cannot be written as code\.$/)
  t.notThrows(() => sub.to(date).broadcast.received(1).emit('m'))

  // a shared builder (knex-like) whose self-returning where() leads to an unconfigured read: code, and it passes
  const db = Substitute.for<any>()
  const qb = Substitute.for<any>()
  db(Arg.any()).returns(qb)
  qb.where(Arg.all()).returns(qb)
  db('users').where('id', 1).meta.limit(1)
  t.regex(remedyOf(() => qb.received(1).limit(1)), /check that substitute: sub\.meta\.received\(1\)\.limit\(\.\.\.\)$/)
  t.notThrows(() => new Function('sub', 'sub.meta.received(1).limit(1)')(qb))
})
