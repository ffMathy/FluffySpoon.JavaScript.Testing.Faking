import test, { ExecutionContext } from 'ava'
import * as fs from 'fs'
import * as path from 'path'
import { inspect, isDeepStrictEqual } from 'util'

import { Substitute, Arg } from '../../../src'
import { MAX_LISTED_CHARACTERS, SubstituteException } from '../../../src/internals/SubstituteException'
import { structuralHash } from '../../../src/internals/utilities/ArgumentHash'
import { MESSAGE_BOUNDS, formatValue } from '../../../src/internals/utilities/Stringify'
import { MAX_FACTOR, TimeLimit, assertFast, assertWithin, loadFactor, timeLimit } from '../../helpers/timing'

// Round 9, engine A: the hash of URLs and other values that Node.js compares by internal state or by identity (fix spec
// E42), timing tests that hold up on a busy machine (E43), and bounded printing (E44, E45). This file runs in the
// serial run of the timing-sensitive files (see ava.config.js).

// ---- E42: URLs, promises, WeakMaps and WeakSets ---------------------------------------------------------------------

const urls = (count: number, offset = 0) => Array.from({ length: count }, (_, index) => new URL(`https://api.example.com/items?page=${offset + index}`))

test('R8FE-7 (E42) 10,000 calls with distinct URLs, also inside an object, stay well under 1 s', t => {
  // d5b96ab: all URLs had one hash, so each call was compared with every earlier one: 16.5 s for the first shape
  const plain = urls(10_000)
  const wrapped = urls(10_000, 20_000).map(url => ({ url }))
  assertFast(t, 1000, '10,000 calls http.fetch(url) with distinct URLs', () => {
    const http = Substitute.for<any>()
    for (const url of plain) http.fetch(url)
  })
  assertFast(t, 1000, '10,000 calls http.request({ url }) with distinct URLs', () => {
    const http = Substitute.for<any>()
    for (const options of wrapped) http.request(options)
  })
})

test('R8FE-7 (E42) 1,000 calls with distinct fetch Requests stay well under 1 s', t => {
  const RequestClass = (globalThis as any).Request
  if (typeof RequestClass !== 'function') {
    t.pass('no fetch Request in this Node.js')
    return
  }
  // d5b96ab on Node.js 22: 2.8 s, as a Request holds its URL as a URL
  const requests = Array.from({ length: 1000 }, (_, index) => new RequestClass(`https://api.example.com/items?page=${index}`))
  assertFast(t, 1000, '1,000 calls http.send(request) with distinct Requests', () => {
    const http = Substitute.for<any>()
    for (const request of requests) http.send(request)
  })
})

test('R8FE-7 (E42) URLs that the running Node.js finds deep strictly equal share a hash, and other URLs do not', t => {
  const spellings = [
    'https://api.example.com/items?page=1', 'HTTPS://API.EXAMPLE.COM/items?page=1', 'https://api.example.com:443/items?page=1',
    'https://api.example.com/items?page=2', 'https://api.example.com/items?page=1#top', 'https://api.example.com/items?page=1#end',
    'https://api.example.com/./items?page=1', 'https://user@api.example.com/items?page=1', 'http://api.example.com/items?page=1',
    'https://api.example.com/items', 'https://api.example.com/Items?page=1', 'file:///tmp/a', 'file:///tmp/b'
  ]
  const values = spellings.map(spelling => new URL(spelling))
  let unequalPairs = 0
  for (const a of values) {
    for (const b of values) {
      const equal = isDeepStrictEqual(a, b)
      if (equal) t.is(structuralHash(a), structuralHash(b), `${a.href} and ${b.href} are equal`)
      else {
        unequalPairs++
        // Node.js 20 and later compare URLs by href (as do 22, 24 and 26, which npm test runs on)
        t.not(structuralHash(a), structuralHash(b), `${a.href} and ${b.href}`)
      }
      // inside other values, too
      if (equal) t.is(structuralHash({ url: a, list: [a] }), structuralHash({ url: b, list: [b] }))
    }
  }
  t.true(unequalPairs > 100, `${unequalPairs} unequal pairs`)

  // a URL with own properties of its own: those count as well
  const tagged = Object.assign(new URL('https://a.example/'), { tag: 1 })
  const otherTag = Object.assign(new URL('https://a.example/'), { tag: 2 })
  t.is(isDeepStrictEqual(tagged, otherTag), false)
  t.not(structuralHash(tagged), structuralHash(otherTag))
  t.is(structuralHash(tagged), structuralHash(Object.assign(new URL('HTTPS://A.EXAMPLE'), { tag: 1 })))

  // an object that only inherits from URL.prototype has no href to read: it is hashed by its keys, and never throws
  const fake = Object.create(URL.prototype)
  t.is(structuralHash(fake), structuralHash(Object.create(URL.prototype)))
})

test('R8FE-7 (E42) calls with URLs match setups and checks as before: by href', t => {
  const http = Substitute.for<any>()
  http.fetch(new URL('https://api.example.com/users/1')).returns('ann')
  t.is(http.fetch(new URL('HTTPS://api.example.com/users/1')), 'ann')
  t.is(typeof http.fetch(new URL('https://api.example.com/users/2')), 'function')
  // the same auto-substitute for equal URLs
  t.is(http.get(new URL('https://a.example/x')), http.get(new URL('https://a.example/x')))
  t.not(http.get(new URL('https://a.example/x')), http.get(new URL('https://a.example/y')))
  // the setup is not a call
  t.notThrows(() => http.received(1).fetch(new URL('https://api.example.com/users/2')))
  t.notThrows(() => http.received(1).fetch(new URL('https://api.example.com/users/1')))
  t.throws(() => http.received(1).fetch(new URL('https://api.example.com/users/3')))
})

test('R8FE-7 (E42) promises, WeakMaps and WeakSets: equal ones share a hash, and 10,000 calls with distinct ones stay well under 1 s', t => {
  const kinds: Array<[string, () => object]> = [
    ['promises', () => Promise.resolve(1)],
    ['pending promises', () => new Promise(() => { })],
    ['WeakMaps', () => new WeakMap()],
    ['WeakSets', () => new WeakSet()]
  ]
  for (const [name, create] of kinds) {
    const a = create()
    const b = create()
    // Node.js 24 and later compare promises by identity, Node.js 22 and later WeakMaps and WeakSets; earlier versions
    // find any two of them equal
    if (isDeepStrictEqual(a, b)) t.is(structuralHash(a), structuralHash(b), name)
    else t.not(structuralHash(a), structuralHash(b), name)
    t.is(structuralHash(a), structuralHash(a))
    const values = Array.from({ length: 10_000 }, create)
    assertFast(t, 1000, `10,000 calls with distinct ${name}`, () => {
      const tracker = Substitute.for<any>()
      for (const value of values) tracker.track(value)
    })
    // the same one finds its setup
    const tracker = Substitute.for<any>()
    tracker.track(a).returns('tracked')
    t.is(tracker.track(a), 'tracked')
  }
})

// ---- E44: bounded printing; E45: errors compactly at every depth ----------------------------------------------------

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

/** Lines of a text that look like stack frames (the "called at" lines of listed calls do not). */
const stackLines = (text: string) => text.split('\n').filter(line => /^\s*at /.test(line))

/*
 * A DOM-like object graph, as happy-dom and jsdom build it: a window with many globals, a document and elements that
 * refer back to them (cycles through window, document and parents), listener maps, and an event that holds its target,
 * its current target and its window. util.inspect at its default depth prints one such event as about 100 KB (one
 * happy-dom event: 185 KB).
 */
class FakeEventTarget { listeners = new Map<string, unknown[]>([['click', []], ['input', []]]) }
class FakeWindow extends FakeEventTarget {
  [key: string]: unknown
  document: FakeDocument
  constructor() {
    super()
    for (let index = 0; index < 1500; index++) this[`global${index}`] = index % 3 === 0 ? { name: `api${index}`, enabled: true } : index
    this.self = this
    this.window = this
    this.document = new FakeDocument(this)
  }
}
class FakeDocument extends FakeEventTarget {
  [key: string]: unknown
  body: FakeElement
  constructor(readonly defaultView: FakeWindow) {
    super()
    this.documentElement = new FakeElement('html', this, undefined)
    this.body = new FakeElement('body', this, this.documentElement as FakeElement)
    for (let index = 0; index < 200; index++) this[`cache${index}`] = { selector: `#id${index}`, nodes: [this.body] }
  }
}
class FakeElement extends FakeEventTarget {
  [key: string]: unknown
  childNodes: FakeElement[] = []
  style: Record<string, string> = {}
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument, readonly parentNode: FakeElement | undefined) {
    super()
    if (parentNode !== undefined) parentNode.childNodes.push(this)
    for (let index = 0; index < 300; index++) this.style[`property${index}`] = `value ${index}`
    for (let index = 0; index < 80; index++) this[`attribute${index}`] = { name: `data-${index}`, value: 'x'.repeat(50), ownerElement: this }
  }
}
class FakePointerEvent {
  [key: string]: unknown
  constructor(readonly timeStamp: number, readonly type: string, readonly target: FakeElement, readonly view: FakeWindow) {
    this.currentTarget = target
    this.srcElement = target
    this.path = [target, target.parentNode, target.ownerDocument, view]
    for (let index = 0; index < 50; index++) this[`field${index}`] = index
  }
}

/** A click at `timeStamp` (events with distinct time stamps are distinct values, as real events are). */
const domLikeEvent = (timeStamp = 0) => {
  const window = new FakeWindow()
  const button = new FakeElement('button', window.document, window.document.body)
  return new FakePointerEvent(timeStamp, 'click', button, window)
}

test('R8-ADV-4 (E44) an event of a DOM-like object graph prints within a few KB in messages, printouts and paths', t => {
  // d5b96ab: 100 KB and more for each event (util.inspect at depth 2, every key)
  const event = domLikeEvent()
  t.true(inspect(event).length > 50_000, 'the graph is large when printed in full')

  const onClick = Substitute.for<(event: unknown) => void>()
  onClick(event)
  const message = messageOf(() => onClick.received(2)(Arg.any()))
  t.true(message.length < 4000, `${message.length} characters: ${message.slice(0, 3000)}`)
  t.true(message.includes('FakePointerEvent {'), message)
  t.regex(message, /\.\.\. \d+ more keys/)
  t.true(String(onClick).length < 4000, `String(): ${String(onClick).length} characters`)
  t.true(inspect(onClick).length < 4000, `util.inspect(): ${inspect(onClick).length} characters`)

  // in the path of an auto-substitute (and so in every message about it)
  const app = Substitute.for<any>()
  const handled = app.handle(event)
  handled.done
  t.true(String(handled).length < 400, String(handled))
  const pathMessage = messageOf(() => handled.received(1).finish())
  t.true(pathMessage.split('\n')[0].length < 400, pathMessage.split('\n')[0])

  // 60 events: the listing stops after MAX_LISTED_CHARACTERS characters (d5b96ab: 9 MB, 197,000 lines for happy-dom)
  const many = Substitute.for<(event: unknown) => void>()
  for (let index = 0; index < 60; index++) many(domLikeEvent(index))
  const long = messageOf(() => many.received(61)(Arg.any()))
  t.true(long.length < MAX_LISTED_CHARACTERS + 4000, `${long.length} characters`)
  t.regex(long, /› … and \d+ more\n/)
  t.true(String(many).length < 60 * 1200, `String(): ${String(many).length} characters`)
})

test('R8-ADV-4 (E44) an object with 5,000 keys shows its first 20 keys in messages and printouts and 10 in paths', t => {
  const table: Record<string, number> = {}
  for (let index = 0; index < 5000; index++) table[`key${index}`] = index
  const app = Substitute.for<any>()
  const user = app.lookup(table)
  user.name
  // d5b96ab: a 72,827-character path
  t.is(String(user).split(' {')[0], '@Substitute.lookup({ key0: 0, key1: 1, key2: 2, key3: 3, key4: 4, key5: 5, key6: 6, key7: 7, key8: 8, key9: 9, ... 4990 more keys })')
  const message = messageOf(() => app.received(1).lookup({ key0: 0 }))
  t.true(message.length < 3000, `${message.length} characters`)
  t.true(message.includes('key19: 19,'), message)
  t.false(message.includes('key20:'), message)
  t.true(message.includes('... 4980 more keys'), message)
})

test('R8-ADV-4 (E44) long strings, long arrays, wide Maps and Sets and calls with many arguments are bounded', t => {
  const sub = Substitute.for<any>()
  sub.write('x'.repeat(1_000_000))
  sub.items(Array.from({ length: 100_000 }, (_, index) => index))
  sub.cache(new Map(Array.from({ length: 5000 }, (_, index) => [`k${index}`, new Error(`failed ${index}`)])))
  sub.members(new Set(Array.from({ length: 5000 }, (_, index) => ({ id: index, error: new RangeError(`r${index}`) }))))
  sub.spread(...Array.from({ length: 1000 }, (_, index) => index))
  sub.nested({ text: 'y'.repeat(10_000), list: Array.from({ length: 1000 }, (_, index) => ({ index })) })
  const printed = String(sub)
  t.true(printed.length < 7000, `${printed.length} characters`)
  for (const line of printed.split('\n')) t.true(line.length < MESSAGE_BOUNDS.characters + 100, line.slice(0, 200))
  t.regex(printed, /write\('x{900,}'\.\.\. \d+ more characters\)/)
  t.regex(printed, /\.\.\. 99980 more items/)
  t.true(printed.includes('Map(5000) {'), printed)
  t.true(printed.includes("'k0' => [Error: failed 0]"), printed)
  t.true(printed.includes('... 4980 more items'), printed)
  t.true(printed.includes('Set(5000) {'), printed)
  t.true(printed.includes('error: [RangeError: r0]'), printed)
  t.true(printed.includes('... 980 more arguments)'), printed)
  t.regex(printed, /text: 'y{200}'\.\.\. 9800 more characters/)
  t.deepEqual(stackLines(printed), [])
  const message = messageOf(() => sub.received(1).write('z'))
  t.true(message.length < 2000, `${message.length} characters`)
})

test('R8-ADV-4 (E44, E54) small values print as util.inspect shows them, two levels of nesting included', t => {
  class User { constructor(readonly id: number, readonly name: string) { } }
  const values: unknown[] = [
    1, 'ann', undefined, null, BigInt(10), Symbol('id'), { id: 1, name: 'ann', tags: ['a', 'b'] }, [1, [2, 3]], new User(1, 'ann'),
    Object.assign(Object.create(null), { a: 1 }), new Date(0), /x/g, new Map([['a', { b: 1 }]]), new Set([1, 2]),
    { a: { b: 1 } }, [{ a: 1 }], Buffer.from('abc'), new Uint8Array(3), { [Symbol('s')]: 1, 'content-type': 'json' }
  ]
  // E54 (round 10): two levels deep, util.inspect's default (round 9 printed one level: `{ a: { b: [Object] } }`)
  for (const value of values) t.is(formatValue(value, false), inspect(value, { depth: 2 }), inspect(value))
  t.is(formatValue({ a: { b: { c: 1 } } }, false), '{ a: { b: { c: 1 } } }')
  t.is(formatValue({ a: { b: { c: { d: 1 } } } }, false), '{ a: { b: { c: [Object] } } }')
  // matchers and substitutes as before
  const app = Substitute.for<any>()
  t.is(formatValue({ id: Arg.any() }, false), '{ id: Arg.any{any} }')
  t.is(formatValue(app.getUser(1), false), '@Substitute.getUser(1)')
  t.is(formatValue([app.logger], false), '[ @Substitute.logger ]')
})

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

test('R8V-3 (E45) errors inside objects, arrays, Maps and Sets print compactly, without their stack', t => {
  const logger = Substitute.for<any>()
  let parseError: unknown
  try {
    JSON.parse('{')
  } catch (error) {
    parseError = error
    // the most common logger call shapes (pino, bunyan): an error inside an object, an error in an array
    logger.error({ msg: 'parse failed', err: error })
    logger.warn([error])
    logger.debug({ context: { request: 1, err: error } })
    logger.info(new Map([['parse', error]]), new Set([error]))
  }
  const compact = `[SyntaxError: ${(parseError as Error).message}]`
  const checks: Array<[() => unknown, string]> = [
    [() => logger.received(1).error(Arg.is(() => false)), `@Substitute.error({\n  msg: 'parse failed',\n  err: ${compact}\n})`],
    [() => logger.received(1).warn(Arg.is(() => false)), `@Substitute.warn([\n  ${compact}\n])`],
    [() => logger.received(1).debug(Arg.is(() => false)), `@Substitute.debug({\n  context: {\n    request: 1,\n    err: ${compact}\n  }\n})`],
    [() => logger.received(1).info(Arg.is(() => false)), `@Substitute.info(Map(1) {\n  'parse' => ${compact}\n}, Set(1) {\n  ${compact}\n})`]
  ]
  for (const [check, expected] of checks) {
    const message = messageOf(check)
    t.true(message.includes(`› ✘ ${expected}\n    called at `), message)
    t.deepEqual(stackLines(message), [], message)
  }
  t.deepEqual(stackLines(String(logger)), [], String(logger))

  // a cause and a cause of the cause, with their own properties; an error that refers to itself shows its head there
  const root = Object.assign(new TypeError('root'), { code: 'E_ROOT' })
  const middle = new (Error as any)('middle', { cause: root })
  const top = Object.assign(new (Error as any)('top', { cause: middle }), { requestId: 7 }) as Error & { self?: unknown }
  top.self = top
  t.is(formatValue({ top }, false), "{\n  top: [Error: top] { requestId: 7, self: [Error: top], [cause]: [Error: middle] { [cause]: [TypeError: root] { code: 'E_ROOT' } } }\n}")
})

test('R8FE-3 (E45) errors that differ only in their own properties print differently', t => {
  // d5b96ab: both sides printed as [HttpError: order not found]
  const next = Substitute.for<(error?: unknown) => void>()
  next(new HttpError(404, 'order not found'))
  const message = messageOf(() => next.received(1)(new HttpError(410, 'order not found')))
  t.true(message.includes('matching @Substitute([HttpError: order not found] { status: 410 })'), message)
  t.true(message.includes('› ✘ @Substitute([HttpError: order not found] { status: 404 })'), message)

  // a system error: errno, code, syscall and path
  const fs = Substitute.for<any>()
  const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/repo/deploy.json'"), { errno: -2, code: 'ENOENT', syscall: 'open', path: '/repo/deploy.json' })
  fs.fail(enoent)
  t.is(String(fs), "@Substitute {\n  received:\n    fail([Error: ENOENT: no such file or directory, open '/repo/deploy.json'] { errno: -2, code: 'ENOENT', syscall: 'open', path: '/repo/deploy.json' })\n}")
  // an error with many properties shows the first ten; the name that a class assigns is not shown twice
  const wide = Object.assign(new HttpError(500, 'boom'), Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`p${index}`, index])))
  t.is(formatValue(wide, false), '[HttpError: boom] { status: 500, p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, ... 6 more keys }')
  // the setup side too: a configured error
  const repo = Substitute.for<any>()
  repo.load(1).throws(new HttpError(503, 'unavailable'))
  t.true(String(repo).includes('load(1) => throws([HttpError: unavailable] { status: 503 })'), String(repo))
})

// ---- E43: timing tests that hold up on a busy machine -------------------------------------------------------------

/** The repository (the specs run from their compiled copy in dist-spec/). */
const root = path.resolve(__dirname, '../../../..')

test('R8-ADV-6 (E43) absolute time limits are scaled by a load factor measured right before the measurement, clamped to [1, 4]', t => {
  t.is(MAX_FACTOR, 4)
  const factor = loadFactor()
  t.true(factor >= 1 && factor <= MAX_FACTOR, `load factor ${factor}`)
  const limit = timeLimit(1000)
  t.true(limit.milliseconds >= 1000 && limit.milliseconds <= 4000, String(limit))
  t.is(new TimeLimit(250, 2).milliseconds, 500)

  // assertWithin: within the limit passes; above four times the base limit fails, whatever the load (the factor measured
  // again after a measurement that exceeds its limit is clamped as well), so a quadratic blow-up still fails
  const verdicts: boolean[] = []
  const recorder = { true: (value: boolean) => { verdicts.push(value) } } as unknown as ExecutionContext
  assertWithin(recorder, 900, new TimeLimit(1000, 1), 'fast')
  assertWithin(recorder, 3500, new TimeLimit(1000, 4), 'slow but loaded')
  assertWithin(recorder, 4001, new TimeLimit(1000, 1), 'too slow for any load')
  assertWithin(recorder, 16_500, new TimeLimit(1000, 4), 'quadratic')
  t.deepEqual(verdicts, [true, true, false, false])
})

test('R8-ADV-6 (E43) every timing-sensitive spec file checks its absolute limits through the load-scaled helper', t => {
  // d5b96ab: `t.true(elapsed < 1000, ...)` against wall-clock time, which failed 3 of 6 runs at a load average of 12
  const directory = path.join(root, 'spec/regression/fixes')
  const timed = fs.readdirSync(directory).filter(file => /\.(spec|test)\.ts$/.test(file))
    .filter(file => /process\.hrtime|Date\.now\(\)|performance\.now\(\)|helpers\/timing/.test(fs.readFileSync(path.join(directory, file), 'utf8')))
  t.true(timed.length >= 11, timed.join(', '))
  // a time (or a product with one) against a bare number: `t.true(elapsed < 1000, ...)`, `t.true(cost * rows * 1000 < 1000, ...)`
  const absolute = /t\.true\(\s*[\w.()]*(elapsed|Elapsed|ms|best|calls|chains|cost|configured)[\w.()]*\s*(\*[^<,]*)?<\s*[\d_]+\s*,/
  for (const file of timed) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8')
    t.true(source.includes("from '../../helpers/timing'"), `${file} uses the timing helper`)
    const unscaled = source.split('\n').filter(line => !line.trim().startsWith('//') && absolute.test(line))
    t.deepEqual(unscaled, [], `${file} compares a time with a fixed limit`)
  }
})
