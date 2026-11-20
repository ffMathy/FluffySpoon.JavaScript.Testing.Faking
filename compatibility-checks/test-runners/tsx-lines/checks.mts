// The ES module twin of checks.ts (R17FE-5, E125), with the same checks: in an ES module, V8 names the file with a
// file: URL, which the library looks up in Node.js' source maps as well. Run with `node --import tsx`.
import { Substitute, Arg, mimick } from '@fluffy-spoon/substitute'

const results: Record<string, string> = {}
const report = (label: string, check: () => void) => {
  try {
    check()
    results[label] = 'passes'
  } catch (error) {
    results[label] = 'throws: ' + (error as Error).message.split(':')[0]
  }
}
const reported: string[] = []
process.on('uncaughtException', error => { reported.push(error.message.split(':')[0]) })

report('map didNotReceive on the next line', () => {
  const map = Substitute.for<any>()
  map.set(Arg.all()).returns(map)
  map.set('b', 2)
  map.didNotReceive().set('b', 2)
})

report('map received(1) on the next line', () => {
  const map = Substitute.for<any>()
  map.set(Arg.all()).returns(map)
  if (map.set('b', 2) !== map) throw new Error('not fluent')
  map.received(1).set('b', 2)
})

report('mimicked on() then didNotReceive on the next line', () => {
  const emitter = Substitute.for<any>()
  emitter[mimick]({ on() { return this } })
  emitter.on('data', () => { })
  emitter.didNotReceive().on('data', Arg.any())
})

report('stored handle, didNotReceive on a later line', () => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).returns(io)
  io.to('room-a').emit('m')
  const roomB = io.to('room-b')
  roomB.didNotReceive().emit('m')
})

report('check through io.to(room-b) on one line', () => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).returns(io)
  io.to('room-a').emit('m')
  io.to('room-b').received(1).emit('m')
})

report('check through io.to(room-b) over two lines', () => {
  const io = Substitute.for<any>()
  io.to(Arg.any()).returns(io)
  io.to('room-a').emit('m')
  io.to('room-b')
    .received(1).emit('m')
})

const deferredRead = () => {
  const sub = Substitute.for<any>()
  sub.m(1)
  void sub.didNotReceive().m
  try { Arg.any('Strin' as any) } catch { }
}
deferredRead()

const sameStatement = () => {
  const sub = Substitute.for<any>()
  sub.log('x')
  try { sub.received(2).log(Arg.any('String' as any)) } catch { }
}
sameStatement()

const chainOverLines = () => {
  const logger = Substitute.for<any>()
  logger.log('a')
  try {
    logger
      .received(2)
      .log(Arg.any('String' as any))
  } catch { }
}
chainOverLines()

setTimeout(() => console.log(JSON.stringify({ results, reported })), 20)
