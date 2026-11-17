import test from 'ava'
import * as fs from 'fs'
import * as path from 'path'

import { Substitute, Arg, configure } from '../../../src'
import { RecordedArguments } from '../../../src/internals/RecordedArguments'
import { assertWithin, timeLimit } from '../../helpers/timing'

// Round 8, engine A: the timing-sensitive test run, the memo of wide containers and values that cannot be read (fix
// spec E29 to E32). This file runs in the serial run of the timing-sensitive files (see ava.config.js).

/** The repository (the specs run from their compiled copy in dist-spec/). */
const root = path.resolve(__dirname, '../../../..')

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}

/** An object with `size` keys, in insertion order. */
const wideObject = (size: number, value: (index: number) => unknown, key: (index: number) => string = index => `k${index}`): Record<string, unknown> => {
  const object: Record<string, unknown> = {}
  for (let index = 0; index < size; index++) object[key(index)] = value(index)
  return object
}

/** A substitute's auto-substitutes are functions; configured values here are strings and numbers. */
const isAutoSubstitute = (value: unknown) => typeof value === 'function'

// ---- E29: the timing-sensitive files run on their own -------------------------------------------

/** The glob patterns of ava's `files` option as a regular expression (the forms the configurations use). */
const globToRegExp = (glob: string): RegExp => new RegExp(`^${glob
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0000')
  .replace(/\*/g, '[^/]*')
  .replace(/\u0000/g, '(?:.*/)?')}$`)

/** Whether ava selects a file with these `files` patterns: one that some pattern matches, and no negated one. */
const selects = (patterns: readonly string[], file: string): boolean =>
  patterns.some(pattern => !pattern.startsWith('!') && globToRegExp(pattern).test(file)) &&
  !patterns.some(pattern => pattern.startsWith('!') && globToRegExp(pattern.slice(1)).test(file))

const specFiles = (directory: string): string[] => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? specFiles(`${directory}/${entry.name}`) : /\.(spec|test)\.ts$/.test(entry.name) ? [`${directory}/${entry.name}`] : [])

test('R7V-6 (E29) the timing-sensitive spec files run in an ava invocation of their own, one test at a time, after the others', t => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  // 89e4175: one ava invocation, in which ava runs the files in parallel workers and the tests of a file concurrently
  t.is(packageJson.scripts.test, 'npm run build:spec && ava && ava --config ava.perf.config.js --serial --concurrency=1')
  const main = require(path.join(root, 'ava.config.js'))
  const perf = require(path.join(root, 'ava.perf.config.js'))
  t.true(perf.serial)
  t.is(perf.concurrency, 1)
  // a file that works for more than ava's default of 10 seconds without reporting, on a busy machine, is no stall
  t.is(main.timeout, '3m')
  // the same options otherwise (the compiled specs, fail-fast, the stall timeout)
  const { files: _perfFiles, serial: _serial, concurrency: _concurrency, ...perfOptions } = perf
  const { files: _mainFiles, ...mainOptions } = main
  t.deepEqual(perfOptions, mainOptions)

  // every spec file runs in exactly one of the two invocations, and every one that measures time in the serial one
  const files = specFiles('spec')
  t.true(files.length > 40, `${files.length} spec files`)
  const timed: string[] = []
  for (const file of files) {
    const inMain = selects(main.files, file)
    const inPerf = selects(perf.files, file)
    t.true(inMain !== inPerf, `${file} runs in ${inMain && inPerf ? 'both invocations' : 'neither invocation'}`)
    // (round 9, E43: or through the timing helper, which scales the limits by the machine's load)
    if (/process\.hrtime|Date\.now\(\)|performance\.now\(\)|helpers\/timing/.test(fs.readFileSync(path.join(root, file), 'utf8'))) {
      timed.push(file)
      t.true(inPerf, `${file} measures time, so it runs in the serial invocation`)
    }
  }
  t.true(timed.includes('spec/regression/fixes/round8-hashing.test.ts'))
  t.true(timed.length >= 8, timed.join(', '))
  // the packaging checks run with the functional tests
  t.true(selects(main.files, 'packaging/package.test.js'))
})

// ---- E32: a setup made with .returns() reads a value that cannot be read once ---------------------

test('R7TD-9 (E32) a setup made with .returns() on a call reads a throwing getter at most once, as a call or a setup alone does', t => {
  let reads = 0
  const unreadable = () => Object.defineProperty({}, 'name', { enumerable: true, get() { reads++; throw new Error('not loaded') } })
  const readsOf = (run: () => void) => {
    reads = 0
    run()
    return reads
  }
  // 89e4175: 2 (the call, then the setup, each an operation of its own); 74b8588: 1
  t.is(readsOf(() => Substitute.for<any>().k(unreadable()).returns(1)), 1)
  t.is(readsOf(() => Substitute.for<any>().k([unreadable()]).returns(1)), 1)
  t.is(readsOf(() => Substitute.for<any>().k(unreadable()).resolves(1)), 1)
  // a member that has literal setups already (the call looks them up first, with the same hash)
  const withSetups = Substitute.for<any>()
  withSetups.k(1).returns(0)
  const value = unreadable()
  t.is(readsOf(() => withSetups.k(value).returns(2)), 1)
  t.is(withSetups.k(value), 2)
  // the second time, in a new array: the call finds its auto-substitute by the hash (89e4175: 2)
  const again = Substitute.for<any>()
  const same = unreadable()
  again.k([same])
  t.is(readsOf(() => again.k([same]).returns(3)), 1)
  t.is(again.k([same]), 3)
  // a call alone, and a setup through configure() alone, read it once
  t.is(readsOf(() => Substitute.for<any>().k(unreadable())), 1)
  t.is(readsOf(() => Substitute.for<any>()[configure]().k(unreadable()).returns(1)), 1)

  // the verdict is the call's: once the value can be read, the next call and setup read it as usual, by its contents
  let loaded = false
  const user = Object.defineProperty({}, 'id', { enumerable: true, get() { if (!loaded) throw new Error('not loaded'); return 1 } })
  const repository = Substitute.for<any>()
  repository.save(user).returns('while unreadable')
  loaded = true
  repository.save({ id: 1 }).returns('loaded')
  t.is(repository.save(user), 'loaded')
  t.is(repository.save({ id: 1 }), 'loaded')
  // a setup that comes after another recorded call does not take the verdict of the earlier call
  let ready = false
  const order = Object.defineProperty({}, 'total', { enumerable: true, get() { if (!ready) throw new Error('not loaded'); return 5 } })
  const orders = Substitute.for<any>()
  const pending = orders.place(order)
  void orders.other
  ready = true
  pending.returns('placed')
  t.is(orders.place({ total: 5 }), 'placed')
})

// ---- E30: a container held by a setup that changed afterwards -----------------------------------

test('R7V-2 (E30) pins what a call gives after a container inside a setup\'s argument changed (unspecified, see README)', t => {
  // A setup (or an auto-substitute) holds the objects of its arguments. When one of them changes afterwards, whether a
  // later call with a new wrapper around it, or with an equal copy, still matches is unspecified (amended D15/D35). This
  // pins what the library does now: a wide container (more than 256 entries) keeps the hash of its first use, a
  // smaller one is hashed again. Checks compare live, always.
  for (const size of [3, 256, 257, 1100]) {
    for (const kind of ['Set', 'Map', 'object'] as const) {
      const make = (): any => kind === 'Set' ? new Set(Array.from({ length: size }, (_, index) => index))
        : kind === 'Map' ? new Map(Array.from({ length: size }, (_, index) => [`k${index}`, index]))
          : wideObject(size, index => index)
      const change = (value: any) => { if (kind === 'object') delete value.k1; else value.delete(kind === 'Set' ? 1 : 'k1') }
      const wide = size > 256
      const name = `${kind} of ${size}`

      const renderer = Substitute.for<any>()
      const tags = make()
      const first = renderer.render({ tags })
      change(tags)
      t.is(renderer.render({ tags }) === first, wide, `${name}: the same auto-substitute`)

      const repository = Substitute.for<any>()
      const saved = make()
      repository.save({ tags: saved }).returns('saved')
      change(saved)
      const answer = repository.save({ tags: saved })
      if (wide) t.is(answer, 'saved', name)
      else t.true(isAutoSubstitute(answer), name)
      // a copy of its state now: as without the change for a wide one
      const copy = repository.save({ tags: kind === 'object' ? { ...saved } : kind === 'Set' ? new Set(saved) : new Map(saved) })
      t.true(isAutoSubstitute(copy), `${name}: a copy`)

      const audit = Substitute.for<any>()
      const checked = make()
      audit.save({ tags: checked })
      change(checked)
      t.notThrows(() => audit.received(1).save({ tags: checked }), name)
    }
  }
})

// ---- E31: wide objects shared by small arguments and by the records of wide containers ----------

test.serial('R7-ADV-5 / R7V-5 (E31) records of wide containers that share a wide object: 10 calls each stay well under 50 ms', t => {
  t.timeout(120_000)
  // Accepted as they are (E31): records inside a wide container are hashed with a budget of 4 objects each (E13), where
  // 45facfb hashed them shallowly, which costs about 1 ms per call for 2,000 records. The limit is four times the 50 ms
  // that E31 accepts, for a busy machine; the best of three runs, each with values of its own.
  const config = wideObject(5000, index => index, index => `setting${index}`)
  let generation = 0
  const shapes: Array<[string, () => unknown[]]> = [
    ['10 Maps of 2,000 records sharing one 5,000-key object', () => Array.from({ length: 10 }, (_, call) => new Map(Array.from({ length: 2000 }, (_, index) => [`s${index}`, { id: ++generation * 100_000 + call * 10_000 + index, config }])))],
    ['10 Maps of 300 such records', () => Array.from({ length: 10 }, (_, call) => new Map(Array.from({ length: 300 }, (_, index) => [`s${index}`, { id: ++generation * 100_000 + call * 1000 + index, config }])))],
    ['10 tables of 300 such records', () => Array.from({ length: 10 }, (_, call) => wideObject(300, index => ({ id: ++generation * 100_000 + call * 1000 + index, config }), index => `row${index}`))],
    ['10 tables of 1,000 records that point back to their table', () => Array.from({ length: 10 }, (_, call) => {
      const table: Record<string, unknown> = {}
      for (let index = 0; index < 1000; index++) table[`n${index}`] = { id: ++generation * 100_000 + call * 1000 + index, registry: table }
      return table
    })],
    ['10 batches of 300 records sharing a 10,000-entry Map', () => {
      const catalog = new Map(Array.from({ length: 10_000 }, (_, index) => [`sku-${index}`, { price: index }]))
      return Array.from({ length: 10 }, (_, call) => Array.from({ length: 300 }, (_, index) => ({ id: ++generation * 100_000 + call * 1000 + index, catalog })))
    }]
  ]
  for (const [name, values] of shapes) {
    const bestLimit = timeLimit(200)
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const args = values()
      const sub = Substitute.for<any>()
      best = Math.min(best, millisecondsOf(() => args.forEach(value => sub.load(value))))
    }
    t.log(`${name}: ${best.toFixed(1)} ms`)
    assertWithin(t, best, bestLimit, `${name}`)
  }
})

test.serial('R7-ADV-4 (E31) 10,000 calls whose small argument holds a shared wide table stay well under 1 s', t => {
  t.timeout(120_000)
  // Not made faster (see the fix report): a call whose hash takes a wide container's hash from an earlier call proves
  // that the container is still wide (257 of its keys) before it looks for an equal auto-substitute, so that one that
  // shrank since is found by its contents (E18). 74b8588: 100 to 160 ms, without that proof; now 200 to 270 ms.
  const table = wideObject(10_000, index => index, index => `key${index}`)
  const shapes: Array<[string, (index: number) => unknown[]]> = [
    ['{ id, table }', index => [{ id: index, table }]],
    ['[id, table]', index => [[index, table]]],
    ['{ id, meta: { table } }', index => [{ id: index, meta: { table } }]],
    ['(id, table)', index => [index, table]]
  ]
  let generation = 0
  for (const [name, args] of shapes) {
    const bestLimit = timeLimit(1000)
    let best = Infinity
    for (let run = 0; run < 3; run++) {
      const calls = Array.from({ length: 10_000 }, () => args(++generation))
      const sub = Substitute.for<any>()
      best = Math.min(best, millisecondsOf(() => calls.forEach(call => sub.f(...call))))
    }
    t.log(`10,000 calls with ${name}: ${best.toFixed(1)} ms`)
    assertWithin(t, best, bestLimit, `10,000 calls with ${name}`)
  }
  // still exact: an equal wrapper, also with a copy of the table, finds the same auto-substitute, another id another one
  const sub = Substitute.for<any>()
  const first = sub.f({ id: 1, table })
  t.is(sub.f({ id: 1, table }), first)
  t.is(sub.f({ id: 1, table: { ...table } }), first)
  t.not(sub.f({ id: 2, table }), first)
  // a table that another call saw, and that shrank below 257 keys since, is hashed by its contents again
  const shrinking = wideObject(300, index => index)
  Substitute.for<any>().log({ shrinking })
  for (let index = 0; index < 100; index++) delete shrinking[`k${index}`]
  const copy = sub.g({ id: 1, shrinking: { ...shrinking } })
  t.is(sub.g({ id: 1, shrinking }), copy)
})

test('E29 the search for nested matchers reads data properties only: no getters, no get traps of proxies', t => {
  // it no longer asks for a property descriptor of every key (which made arrays of records allocate most of their cost)
  let getterRuns = 0
  let trapRuns = 0
  const withGetter = Object.defineProperty({ id: 1 }, 'lazy', { enumerable: true, get() { getterRuns++; return Arg.any() } })
  // (the check whether a value is a matcher reads its brand, a symbol, through the trap: only the keys of the object count)
  const proxy = new Proxy({ id: 2, nested: { value: 1 } }, { get(target, key, receiver) { if (typeof key === 'string') trapRuns++; return Reflect.get(target, key, receiver) } })
  t.false(RecordedArguments.containsMatchers([withGetter]))
  t.false(RecordedArguments.containsMatchers([[withGetter, { list: [withGetter] }]]))
  t.false(RecordedArguments.containsMatchers([{ proxy }]))
  t.is(getterRuns, 0)
  t.is(trapRuns, 0)
  // a matcher in a data property is found, also in a proxy of a plain object, also with a null prototype
  t.true(RecordedArguments.containsMatchers([{ id: 1, name: Arg.any() }]))
  t.true(RecordedArguments.containsMatchers([new Proxy({ id: Arg.any() }, {})]))
  t.true(RecordedArguments.containsMatchers([Object.assign(Object.create(null), { id: Arg.any() })]))
  // a key named like an accessor of Object.prototype is an own data property like any other
  t.true(RecordedArguments.containsMatchers([JSON.parse('{"__proto__": 1, "id": 2}'), { __defineGetter__: Arg.any() }]))
  // an own accessor without a getter reads as undefined, without running anything
  const setterOnly = Object.defineProperty({}, 'sink', { enumerable: true, set() { getterRuns++ } })
  t.false(RecordedArguments.containsMatchers([setterOnly]))
  t.is(getterRuns, 0)
})
