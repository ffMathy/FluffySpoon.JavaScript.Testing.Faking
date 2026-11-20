import test from 'ava'

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
