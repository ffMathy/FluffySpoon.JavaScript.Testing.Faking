// R17FE-5 (E125): tsx 4 transforms a file with esbuild's minifyWhitespace, which puts all of its code on one line. The
// library's line rules (README 'Which calls lead to a setup or a check', 'Through a call with matchers', 'Assertions
// that fail later') must still give the results of the source's lines: tsx turns on source maps, and the library
// decides by them. Run with `node --import tsx` and `node --require tsx/cjs` (this file, CommonJS) and as checks.mts
// (an ES module); test/index.ts runs them all. Prints the outcomes as JSON.
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
