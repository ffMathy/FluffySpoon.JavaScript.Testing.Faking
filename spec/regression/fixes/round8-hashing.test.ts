import test from 'ava'
import * as fs from 'fs'
import * as path from 'path'

import { Substitute, configure } from '../../../src'

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
  // the same options otherwise (the compiled specs, fail-fast)
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
    if (/process\.hrtime|Date\.now\(\)|performance\.now\(\)/.test(fs.readFileSync(path.join(root, file), 'utf8'))) {
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

