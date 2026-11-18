import test, { ExecutionContext } from 'ava'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { inspect } from 'util'

import { Substitute, Arg } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import { MESSAGE_BOUNDS, PATH_BOUNDS, formatBounded, formatValue, printSettings } from '../../../src/internals/utilities/Stringify'
import { RATIO_ATTEMPTS, assertRatiosWithin, assertWithin, millisecondsOf, timeLimit } from '../../helpers/timing'

// Round 10, engine A: failure messages show where an expected call differs again (fix spec E54), and the test
// infrastructure (E58). This file runs in the serial run of the timing-sensitive files (see ava.config.js).

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of a failing check, without colours and without its "called at" lines. */
const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message).split('\n').filter(line => !/^\s+called at /.test(line)).join('\n')
  }
  throw new Error('expected the assertion to fail')
}

/** The expected-call line and the listed received calls of a message, each on one line. */
const linesOf = (message: string) => {
  const flat = message.replace(/\n\s*/g, ' ')
  const expected = /matching (.*?), but received/.exec(flat)?.[1]
  const received = message.split('\n› ').slice(1).map(line => line.replace(/\n\s*/g, ' ').replace(/^[✔✘] /, '').trim())
  return { expected, received }
}

// ---- E54 (R9-ADV-1): where the expected call differs ----------------------------------------------------------------

test('R9-ADV-1 (E54) a Prisma-style 3-level filter shows where the expected and the received call differ', t => {
  const prisma = Substitute.for<any>()
  prisma.user.findMany({ where: { email: { contains: 'alice' } }, take: 10 })
  const message = messageOf(() => prisma.user.received(1).findMany({ where: { email: { contains: 'bob' } }, take: 10 }))
  // 4b1fa69: both lines were findMany({ where: { email: [Object] }, take: 10 })
  t.true(message.includes("matching findMany({ where: { email: { contains: 'bob' } }, take: 10 }), but received none."), message)
  t.true(message.includes("› ✘ @Substitute.user.findMany({ where: { email: { contains: 'alice' } }, take: 10 })"), message)

  // a nested DTO: the city differs at the third level
  const repository = Substitute.for<any>()
  repository.save({ id: 1, profile: { address: { city: 'Oslo' } } })
  const saved = messageOf(() => repository.received(1).save({ id: 1, profile: { address: { city: 'Bergen' } } }))
  t.true(saved.includes("matching save({ id: 1, profile: { address: { city: 'Bergen' } } })"), saved)
  t.true(saved.includes("› ✘ @Substitute.save({ id: 1, profile: { address: { city: 'Oslo' } } })"), saved)

  // printouts of substitutes show two levels, too
  t.true(String(repository).includes("save({ id: 1, profile: { address: { city: 'Oslo' } } })"), String(repository))
  t.is(formatValue({ a: { b: { c: 1 } } }, false), inspect({ a: { b: { c: 1 } } }))
})

test('R9-ADV-1 (E54) matchers nested in the expected call show by their own label, at any depth', t => {
  // the finding's case: a matcher three levels deep (4b1fa69: data: { profile: [Object] }, the matcher was not shown)
  const db = Substitute.for<any>()
  db.update({ where: { id: 7 }, data: { profile: { name: 'x' } } })
  const update = linesOf(messageOf(() => db.received(1).update({ where: { id: Arg.any('number') }, data: { profile: { name: Arg.is((name: string) => name === 'y') } } })))
  t.is(update.expected, "update({ where: { id: Arg.any{number} }, data: { profile: { name: Arg.is{(name) => name === 'y'} } } })")
  t.deepEqual(update.received, ["@Substitute.update({ where: { id: 7 }, data: { profile: { name: 'x' } } })"])

  // deeper than two levels: the container of the matcher is shown, and the received calls are printed as deep, so that
  // they show the value the matcher was given
  const query = Substitute.for<any>()
  query.find({ a: { b: { c: { d: 1, e: { f: 2 } } } } })
  const find = linesOf(messageOf(() => query.received(1).find({ a: { b: { c: { d: Arg.is((value: number) => value > 5) } } } })))
  t.is(find.expected, 'find({ a: { b: { c: { d: Arg.is{(value) => value > 5} } } } })')
  t.deepEqual(find.received, ['@Substitute.find({ a: { b: { c: { d: 1, e: [Object] } } } })'])

  // further down than MAX_MESSAGE_DEPTH: the matcher still shows; the received calls stop at four levels
  const deep = Substitute.for<any>()
  deep.find({ l1: { l2: { l3: { l4: { l5: { l6: 'x' } } } } } })
  const deeper = linesOf(messageOf(() => deep.received(1).find({ l1: { l2: { l3: { l4: { l5: { l6: Arg.any('number') } } } } } })))
  t.is(deeper.expected, 'find({ l1: { l2: { l3: { l4: { l5: { l6: Arg.any{number} } } } } } })')
  t.deepEqual(deeper.received, ['@Substitute.find({ l1: { l2: { l3: { l4: { l5: [Object] } } } } })'])

  // in arrays, in a printout of the setups, and in a container that refers to itself
  const api = Substitute.for<any>()
  api.post([{ items: [{ sku: { code: Arg.any('string') } }] }]).returns(1)
  t.true(String(api).includes("post([ { items: [ { sku: { code: Arg.any{string} } } ] } ]) => returns(1)"), String(api))
  const holder: Record<string, unknown> = { matcher: Arg.any() }
  holder.self = holder
  api.go(1)
  const cyclic = linesOf(messageOf(() => api.received(1).go({ x: { y: { z: holder } } })))
  t.is(cyclic.expected, 'go({ x: { y: { z: <ref *1> { matcher: Arg.any{any}, self: [Circular *1] } } } })')
})

test('R9-ADV-1 (E54) an expected and a received call that print alike two levels deep are printed deeper, up to four levels', t => {
  const prisma = Substitute.for<any>()
  prisma.user.findMany({ where: { AND: [{ email: { contains: 'a' } }] } })
  prisma.user.findMany({ where: { AND: [{ email: { contains: 'b' } }] } })
  prisma.user.findMany({ where: { OR: [] } })
  const message = linesOf(messageOf(() => prisma.user.received(1).findMany({ where: { AND: [{ email: { contains: 'c' } }] } })))
  // two levels deep, all of them would be findMany({ where: { AND: [Array] } }); at three, { AND: [ [Object] ] }
  t.is(message.expected, "findMany({ where: { AND: [ { email: { contains: 'c' } } ] } })")
  t.deepEqual(message.received, [
    "@Substitute.user.findMany({ where: { AND: [ { email: { contains: 'a' } } ] } })",
    "@Substitute.user.findMany({ where: { AND: [ { email: { contains: 'b' } } ] } })",
    // a line that tells itself apart already stays as it was
    '@Substitute.user.findMany({ where: { OR: [] } })'
  ])

  // three levels are enough here
  const repository = Substitute.for<any>()
  repository.save({ a: { b: { c: { d: 1 } } } })
  const saved = linesOf(messageOf(() => repository.received(1).save({ a: { b: { c: { d: 2 } } } })))
  t.is(saved.expected, 'save({ a: { b: { c: { d: 2 } } } })')
  t.deepEqual(saved.received, ['@Substitute.save({ a: { b: { c: { d: 1 } } } })'])

  // assignments too
  const settings = Substitute.for<any>()
  settings.config = { a: { b: { c: { d: 1 } } } }
  const assigned = linesOf(messageOf(() => { settings.received(1).config = { a: { b: { c: { d: 2 } } } } }))
  t.is(assigned.expected, 'config = { a: { b: { c: { d: 2 } } } }')
  t.deepEqual(assigned.received, ['@Substitute.config = { a: { b: { c: { d: 1 } } } }'])

  // differing further down than four levels: printing deeper would not tell them apart, so they stay two levels deep
  const far = Substitute.for<any>()
  far.find({ a: { b: { c: { d: { e: { f: 1 } } } } } })
  const farLines = linesOf(messageOf(() => far.received(1).find({ a: { b: { c: { d: { e: { f: 2 } } } } } })))
  t.is(farLines.expected, 'find({ a: { b: { c: [Object] } } })')
  t.deepEqual(farLines.received, ['@Substitute.find({ a: { b: { c: [Object] } } })'])
})

test('R9-ADV-1 (E54) messages that print deeper still number the roots when only the substitutes among the arguments differ (E52)', t => {
  const router = Substitute.for<any>()
  const admin = Substitute.for<any>()
  const users = Substitute.for<any>()
  router.use({ path: { prefix: { value: '/admin' } }, handler: admin })
  const message = messageOf(() => router.received(1).use({ path: { prefix: { value: '/admin' } }, handler: users }))
  t.true(message.includes("matching use({ path: { prefix: { value: '/admin' } }, handler: @Substitute#2 })"), message)
  t.true(message.includes("› ✘ @Substitute#1.use({ path: { prefix: { value: '/admin' } }, handler: @Substitute#3 })"), message)
})

// ---- E54: within the E44 bounds -----------------------------------------------------------------------------------

/** An object with `width` keys at each of `levels` levels. */
const fanOut = (levels: number, width = 20): Record<string, unknown> => {
  const object: Record<string, unknown> = {}
  for (let index = 0; index < width; index++) object[`k${index}`] = levels === 1 ? index : fanOut(levels - 1, width)
  return object
}

test('R9-ADV-1 (E54) printing deeper keeps the E44 bounds: a value with many nested objects prints the start of its text', t => {
  const value = fanOut(4)
  const text = formatValue(value, false)
  t.true(text.length < MESSAGE_BOUNDS.characters + 30, `${text.length} characters`)
  t.true(text.endsWith('… (more characters)'), text.slice(-100))
  // the start is the start of the full text
  const full = inspect(value, { depth: MESSAGE_BOUNDS.depth, maxArrayLength: MESSAGE_BOUNDS.maxArrayLength })
  t.is(text.slice(0, MESSAGE_BOUNDS.characters), full.slice(0, MESSAGE_BOUNDS.characters))

  // a failure message with such values in its listed calls (and printed four levels deep, as they print alike)
  const store = Substitute.for<any>()
  for (let index = 0; index < 30; index++) store.put(value)
  const message = messageOf(() => store.received(1).put(fanOut(4, 19)))
  t.true(message.length < 25_000, `${message.length} characters`)
  t.regex(message, /› … and \d+ more\n/)
})

test('R9-ADV-1 (E54) the text of a value that is printed only as far as it shows is the start of its full text', t => {
  // printSettings.budget = false prepares every entry that util.inspect shows; the start must be the same
  class Node { constructor(readonly id: number, readonly children: unknown[], readonly meta: Record<string, unknown>) { } }
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const below = (count: number) => Math.floor(random() * count)
  // values of every kind that is prepared, of every size around the cut
  const mixed = (level: number): unknown => {
    const pick = random()
    if (level > 3 || pick < 0.25) return pick < 0.05 ? 'x'.repeat(below(300)) : pick < 0.1 ? null : below(1e6)
    if (pick < 0.45) return Array.from({ length: below(21) }, () => mixed(level + 1))
    if (pick < 0.6) return new Map(Array.from({ length: below(18) }, (_, index) => [`m${index}`, mixed(level + 1)]))
    if (pick < 0.65) return new Set(Array.from({ length: below(18) }, () => mixed(level + 1)))
    if (pick < 0.75) return new Node(level, [mixed(level + 1), mixed(level + 1)], { a: mixed(level + 1) })
    if (pick < 0.8) return Object.assign(new Error(`e${level}`), { code: mixed(level + 1) })
    const object: Record<string, unknown> = {}
    const width = below(28)
    for (let index = 0; index < width; index++) object[index % 7 === 0 ? `key-${index}` : `k${index}`] = mixed(level + 1)
    return object
  }
  // short items, which util.inspect lays out on one line or in a grid depending on all of them
  const short = (level: number): unknown => {
    const pick = random()
    if (level > 5 || pick < 0.2) return pick < 0.1 ? 'ab'.repeat(below(8)) : below(1000)
    if (pick < 0.6) return Array.from({ length: 5 + below(20) }, () => random() < 0.8 ? below(random() < 0.5 ? 10 : 100000) : short(level + 1))
    if (pick < 0.8) return Array.from({ length: 1 + below(8) }, () => short(level + 1))
    const object: Record<string, unknown> = {}
    const width = 1 + below(6)
    for (let index = 0; index < width; index++) object[`a${index}`] = short(level + 1)
    return object
  }
  let cut = 0
  for (const make of [mixed, short]) {
    for (let sample = 0; sample < 150; sample++) {
      const value = make(0)
      for (const bounds of [MESSAGE_BOUNDS, { ...MESSAGE_BOUNDS, depth: 4 }, PATH_BOUNDS]) {
        const budgeted = formatBounded(value, bounds, false)
        printSettings.budget = false
        let complete: string
        try {
          complete = formatBounded(value, bounds, false)
        } finally {
          printSettings.budget = true
        }
        if (budgeted === complete) continue
        cut++
        t.true(budgeted.endsWith('… (more characters)'), budgeted.slice(-80))
        t.regex(complete, /… \(\d+ more characters\)$/)
        t.is(budgeted.slice(0, bounds.characters), complete.slice(0, bounds.characters), `${make.name} sample ${sample}`)
      }
    }
  }
  t.true(cut > 100, `${cut} values were printed only as far as they show`)
})

test('R9-ADV-1 (E54) failure messages with deep and wide values stay fast', t => {
  // 50 listed calls whose arguments have 6 x 6 x 6 x 6 x 6 entries, and that print alike two and three levels deep, so
  // that the message prints them three times, the last time four levels deep: it takes well under 50 ms
  const store = Substitute.for<any>()
  for (let index = 0; index < 50; index++) store.put(fanOut(5, 6))
  const expected = fanOut(5, 6) as any
  expected.k0.k0.k0.k0.k0 = -1
  messageOf(() => store.received(1).put(expected))
  const limit = timeLimit(50)
  const elapsed = Math.min(...Array.from({ length: 3 }, () => millisecondsOf(() => messageOf(() => store.received(1).put(expected)))))
  assertWithin(t, elapsed, limit, 'a failure message listing 50 calls with values of 9,330 entries, printed four levels deep')
  t.true(linesOf(messageOf(() => store.received(1).put(expected))).expected!.startsWith('put({ k0: { k0: { k0: { k0: { k0: -1, k1: 1,'))

  // 200 failing checks over 60 calls with small object arguments (R9FE-4's shape)
  const emitter = Substitute.for<any>()
  for (let index = 0; index < 60; index++) emitter.emit('order.placed', { orderId: `o${index}`, cents: index, lines: [{ sku: 'a', quantity: 1 }] })
  const checks = () => {
    for (let index = 0; index < 200; index++) messageOf(() => emitter.received(1).emit('order.placed', { orderId: 'x' }))
  }
  checks()
  const checksLimit = timeLimit(500)
  assertWithin(t, Math.min(millisecondsOf(checks), millisecondsOf(checks), millisecondsOf(checks)), checksLimit, '200 failing checks over 60 calls with small objects')
})

// ---- E58 (R9V-3): ratio tests that hold up on a busy machine ------------------------------------------------------

/** The repository (the specs run from their compiled copy in dist-spec/). */
const root = path.resolve(__dirname, '../../../..')

test('R9V-3 (E58) a ratio over its limit is measured again, and the smallest ratio of each kind decides', t => {
  t.is(RATIO_ATTEMPTS, 3)
  const run = (measurements: Array<Record<string, number>>) => {
    const verdicts: boolean[] = []
    const recorder = { true: (value: boolean) => { verdicts.push(value) }, log: (): void => undefined } as unknown as ExecutionContext
    let made = 0
    const smallest = assertRatiosWithin(recorder, () => measurements[made++], 1.3, 'ratios')
    return { verdicts, made, smallest }
  }
  // within the limit: measured once
  t.deepEqual(run([{ batches: 1.12, singles: 1.05 }]), { verdicts: [true, true], made: 1, smallest: { batches: 1.12, singles: 1.05 } })
  // a burst of load in one measurement (round 9: 1.34x at a load average of 13): measured again
  t.deepEqual(run([{ batches: 1.34, singles: 1.1 }, { batches: 1.16, singles: 1.2 }]), { verdicts: [true, true], made: 2, smallest: { batches: 1.16, singles: 1.1 } })
  // each kind keeps its smallest ratio
  t.deepEqual(run([{ batches: 1.4, singles: 1.1 }, { batches: 1.2, singles: 1.35 }]), { verdicts: [true, true], made: 2, smallest: { batches: 1.2, singles: 1.1 } })
  // a real slowdown is over the limit in every measurement, and fails (74b8588: 3.2x and 1.5x)
  t.deepEqual(run([{ batches: 3.2, singles: 1.5 }, { batches: 3.1, singles: 1.45 }, { batches: 3.3, singles: 1.52 }]),
    { verdicts: [false, false], made: 3, smallest: { batches: 3.1, singles: 1.45 } })
})

test('R9V-3 (E58) every ratio test of the timing-sensitive files checks its ratios through assertRatiosWithin', t => {
  // 4b1fa69: `t.true(batches < 1.3, ...)` in round7-hashing failed 1 of 3 runs of npm test at a load average of 13
  const directory = path.join(root, 'spec/regression/fixes')
  const ratioCheck = /t\.(true|assert)\(\s*\w*(ratio|Ratio|batches|singles)\w*\s*</
  let users = 0
  for (const file of fs.readdirSync(directory).filter(name => /\.(spec|test)\.ts$/.test(name))) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8')
    if (source.includes('assertRatiosWithin(t,')) users++
    const unchecked = source.split('\n').filter(line => !line.trim().startsWith('//') && ratioCheck.test(line))
    t.deepEqual(unchecked, [], `${file} compares a ratio of timings with its limit directly`)
  }
  t.true(users >= 2, `${users} files use assertRatiosWithin`)
})

// ---- E58 (R9V-6): nothing left in os.tmpdir() ---------------------------------------------------------------------

test('R9V-6 (E58) the two ava runs of npm test leave nothing in os.tmpdir()', t => {
  t.timeout(180_000)
  // 4b1fa69: ava.config.js set `cache: false`, so every ava run created an empty directory in os.tmpdir() (ava's
  // _createCacheDir, fs.mkdtempSync) and never removed it: two per npm test
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'r9v6-'))
  t.teardown(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const ava = path.join(root, 'node_modules/ava/entrypoints/cli.mjs')
  const runs: Array<[string, string[]]> = [
    ['ava.config.js', ['spec/regression/issues/11.test.ts']],
    ['ava.perf.config.js', ['spec/regression/fixes/round9-hashing.test.ts', '--match', '*errors that differ only in their own properties*']]
  ]
  for (const [config, args] of runs) {
    const result = spawnSync(process.execPath, [ava, '--config', config, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, NO_COLOR: '1' }
    })
    t.is(result.status, 0, `${config}: ${result.stdout}${result.stderr}`)
    t.regex(result.stdout + result.stderr, /1 test passed/, config)
    // Node.js' own module compile cache is not ava's (npm itself writes it when it starts)
    t.deepEqual(fs.readdirSync(temporary).filter(name => name !== 'node-compile-cache'), [], `${config} left this in os.tmpdir()`)
  }
})
