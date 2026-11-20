import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

import { Substitute, Arg, configure } from '../../../src'
import { assertWithin, timeLimit } from '../../helpers/timing'

// Round 3, D35: the auto-substitute cache and the literal substitutions, with arguments of any shape.

/** Runs a script with the library in a child process with --expose-gc, and returns what it prints as JSON. */
const measure = (script: string): any => {
  const library = path.resolve(__dirname, '../../../src/index.js')
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', `
    const { Substitute, Arg } = require(${JSON.stringify(library)})
    const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed }
    ${script}
  `], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

test('ENG2-9 (D30) an unconfigured call with distinct arguments costs little memory beyond its record', t => {
  const { unconfigured, configured } = measure(`
    const bytesPerCall = configure => {
      const calls = 50000
      const before = heap()
      const logger = Substitute.for()
      if (configure) logger.log(Arg.any()).returns(undefined)
      for (let index = 0; index < calls; index++) logger.log(index)
      const bytes = (heap() - before) / calls
      if (logger.log(1) === null) console.log('keeps the substitute alive until here')
      return Math.round(bytes)
    }
    console.log(JSON.stringify({ configured: bytesPerCall(true), unconfigured: bytesPerCall(false) }))
  `)
  t.log(`bytes per call: ${unconfigured} unconfigured (an auto-substitute each), ${configured} configured (the record only)`)
  // before D30 the auto-substitute cost about 1 KB more than the record (Node 22: 1309 against 279 bytes)
  t.true(unconfigured - configured < 450, `${unconfigured} - ${configured} bytes per call`)
})

test('ENG2-10 (D30) hashing does not keep symbols alive after the substitute that saw them is gone', t => {
  const { retained } = measure(`
    const before = heap()
    const run = () => {
      const emitter = Substitute.for()
      emitter.emit(0).returns(1)
      for (let index = 0; index < 100000; index++) emitter.emit(Symbol('event-' + index))
    }
    run()
    console.log(JSON.stringify({ retained: (heap() - before) / 1048576 }))
  `)
  t.log(`${retained.toFixed(2)} MB retained`)
  t.true(retained < 2, `${retained} MB retained`)
})

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}
const bestOfThree = (run: () => void) => Math.min(millisecondsOf(run), millisecondsOf(run), millisecondsOf(run))

const shapes: Array<[string, (index: number) => unknown]> = [
  ['nested objects', index => ({ order: { customer: { id: index } } })],
  ['Buffers', index => Buffer.from(`payload-${String(index).padStart(8, '0')}`)],
  ['long strings with a common prefix', index => `${'x'.repeat(70)}${index}`],
  ['arrays of 20 items', index => Array.from({ length: 20 }, (_, item) => (item === 19 ? index : item))],
  ['Maps', index => new Map([['id', index]])],
  ['Sets', index => new Set([index])],
  ['Dates', index => new Date(index)]
]

test('ENG2-2 (D35) 10k unconfigured calls with arguments of any shape finish well under 1s', t => {
  for (const [name, argument] of shapes) {
    const run = () => {
      const repository = Substitute.for<any>()
      for (let index = 0; index < 10_000; index++) repository.save(argument(index))
    }
    run() // warm up
    const elapsedLimit = timeLimit(1000)
    const elapsed = bestOfThree(run)
    assertWithin(t, elapsed, elapsedLimit, `${name}`)
  }

  // the cache still gives the same auto-substitute for equal arguments
  const repository = Substitute.for<any>()
  for (const [name, argument] of shapes) t.is(repository.save(argument(7)), repository.save(argument(7)), name)
})

test('V2-5 (D35) 4000 object-argument setups and 4000 matching calls finish well under 1s', t => {
  const run = () => {
    const finder = Substitute.for<any>()
    for (let index = 0; index < 4_000; index++) finder.find({ id: index, tags: [index] }).returns(index)
    for (let index = 0; index < 4_000; index++) if (finder.find({ id: index, tags: [index] }) !== index) throw new Error(`find(${index})`)
    for (let index = 0; index < 4_000; index++) finder.find({ id: -index - 1, tags: [] })
  }
  run() // warm up
  const elapsedLimit = timeLimit(1000)
  const elapsed = bestOfThree(run)
  assertWithin(t, elapsed, elapsedLimit, '4,000 object-argument setups and 4,000 matching calls')

  // through configure(), and with matcher setups next to the literal ones
  const finder = Substitute.for<any>()
  finder.find(Arg.any()).returns('any')
  const configuredLimit = timeLimit(1000)
  const configured = millisecondsOf(() => {
    for (let index = 0; index < 4_000; index++) finder[configure]().find([index, { nested: index }]).returns(index)
    for (let index = 0; index < 4_000; index++) if (finder.find([index, { nested: index }]) !== index) throw new Error(`find(${index})`)
  })
  assertWithin(t, configured, configuredLimit, '4,000 setups and calls through configure()')
  t.is(finder.find([1, { nested: 2 }]), 'any')
})
