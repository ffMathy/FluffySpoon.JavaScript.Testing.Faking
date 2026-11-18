import test from 'ava'
import { EventEmitter } from 'events'
import * as path from 'path'

import * as library from '../../../src'
import { Substitute, Arg, didNotReceive, received } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import {
  MAX_MESSAGE_DEPTH, MESSAGE_BOUNDS, deepestMatcher, firstVisibleDifference, formatArguments, formatValue, messageBounds, noteMatcherHolder
} from '../../../src/internals/utilities/Stringify'
import { VIEW_SITES_PER_RUN } from '../../../src/internals/Assertions'
import { interceptDeferredReports } from '../../helpers/deferredReports'

// Round 11: the open findings of round 10 (R10-ADV-*, R10V-*), decided in the fix spec as E59-E63.

// ---- E62 (R10V-3): Object.setPrototypeOf on a frozen, sealed or non-extensible substitute -----------------------

test('R10V-3 (E62) Object.setPrototypeOf on a frozen, sealed or non-extensible substitute throws a TypeError that names it', t => {
  const restrict: Record<string, (value: unknown) => unknown> = { freeze: Object.freeze, seal: Object.seal, preventExtensions: Object.preventExtensions }
  for (const how of Object.keys(restrict)) {
    const root = Substitute.for<any>()
    restrict[how](root)
    const app = Substitute.for<any>()
    const auto = app.events
    restrict[how](auto)
    for (const [substitute, path] of [[root, '@Substitute'], [auto, '@Substitute.events']] as const) {
      const viaObject = t.throws(() => Object.setPrototypeOf(substitute, EventEmitter.prototype), { instanceOf: TypeError }, how)
      t.is(viaObject!.message, `${path} is not extensible: its prototype cannot be changed after Object.freeze(), Object.seal() or Object.preventExtensions()`)
      t.false(/trap|falsish|proxy/i.test(viaObject!.message), viaObject!.message)
      // (a trap cannot tell Reflect.setPrototypeOf apart: it throws the same error, where an ordinary object gives false)
      t.throws(() => Reflect.setPrototypeOf(substitute, EventEmitter.prototype), { instanceOf: TypeError, message: viaObject!.message })

      // the prototype it already has: no change, so it succeeds, as for an ordinary non-extensible object
      t.is(Object.setPrototypeOf(substitute, Object.getPrototypeOf(substitute)), substitute)
      t.true(Reflect.setPrototypeOf(substitute, Object.getPrototypeOf(substitute)))
      // and the substitute still works
      substitute.emit('x')
      t.notThrows(() => substitute.received(1).emit('x'))
    }
  }
  // a substitute that is not frozen still takes a new prototype (E55)
  const open = Substitute.for<any>()
  t.is(Object.setPrototypeOf(open, EventEmitter.prototype), open)
  t.true(open instanceof EventEmitter)
})

// ---- E63 (R10-ADV-2): two copies of the library share the printing and comparing guard ---------------------------

/** Loads a second, independent copy of the package (as duplicate installs do), as duplicate-copies.test.ts does. */
const loadSecondCopy = (): typeof library => {
  const entry = require.resolve('../../../src')
  const root = path.dirname(entry) + path.sep
  const saved = new Map<string, NodeModule>()
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) {
      saved.set(key, require.cache[key]!)
      delete require.cache[key]
    }
  }
  try {
    return require(entry)
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key]
    for (const [key, module] of saved) require.cache[key] = module
  }
}

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/**
 * R10-ADV-2's scenario: a host substitute of `hostLibrary` receives instances of a class that extends a substitute of
 * this copy, and is checked (its copy compares them, and prints them for the failure). What the substitute of this copy
 * recorded.
 */
const recordedThroughInheritance = (hostLibrary: typeof library): string => {
  const sdk = Substitute.for<any>()
  class Plugin extends sdk.Base { constructor(readonly id: number) { super() } }
  const host = hostLibrary.Substitute.for<any>()
  host.register(new Plugin(1))
  try { host.received(1).register(new Plugin(2)) } catch { /* fails, and is printed */ }
  host.didNotReceive().register(new Plugin(2))
  return plain(String(sdk))
}

test('R10-ADV-2 (E63) reads that another copy of the library makes while it compares or prints record nothing on a substitute', t => {
  const copyB = loadSecondCopy()
  t.not(copyB.Substitute, Substitute)
  const withOneCopy = recordedThroughInheritance(library)
  const withTwoCopies = recordedThroughInheritance(copyB)
  // 8ce308a: with two copies, also `Base.prototype.href` twice (Node.js 22; href, protocol and auth on Node.js 20)
  t.is(withTwoCopies, withOneCopy)
  t.false(/href|protocol|auth/.test(withTwoCopies), withTwoCopies)
  t.true(withOneCopy.includes('new Base()'), withOneCopy)

  // the same for an object that inherits from a substitute through Object.create, compared by the other copy
  const sdk = Substitute.for<any>()
  const derived = Object.create(sdk)
  derived.name = 'derived'
  const host = copyB.Substitute.for<any>()
  host.use(derived)
  t.notThrows(() => host.received(1).use(derived))
  t.throws(() => host.received(1).use({ name: 'other' }))
  t.notThrows(() => sdk.didNotReceive().href)
  t.notThrows(() => sdk.didNotReceive().protocol)
  t.false(/href|protocol|auth|name/.test(plain(String(sdk))), plain(String(sdk)))
})

test('R10-ADV-2 (E63) a substitute of another copy among the arguments prints as its path, as one of the same copy does', t => {
  const copyB = loadSecondCopy()
  for (const hostLibrary of [library, copyB]) {
    const dependency = Substitute.for<any>()
    dependency.load(1)
    dependency.save(2).returns(true)
    const host = hostLibrary.Substitute.for<any>()
    host.use(dependency)
    const error = t.throws(() => host.received(1).use(1))
    t.true(plain(error!.message).includes('› ✘ @Substitute.use(@Substitute)\n'), error!.message)
    t.is(plain(String(host)), '@Substitute {\n  received:\n    use(@Substitute)\n}')
  }
})

// ---- E61 (R10V-2): symbol-form checks of a member that was never called -------------------------------------------

/** How many stack traces `run` captures. */
const capturesOf = (run: () => void): number => {
  const original = Error.captureStackTrace
  let count = 0
  Error.captureStackTrace = function captureStackTrace(target: object, start?: Function) {
    count++
    return original.call(Error, target, start)
  } as typeof Error.captureStackTrace
  try {
    run()
  } finally {
    Error.captureStackTrace = original
  }
  return count
}

const nextRun = () => new Promise(resolve => setImmediate(resolve))

test('R10V-2 (E61) symbol-form check views record where they were made for the first views of a synchronous run only', async t => {
  const s = Substitute.for<any>()
  s.f(1)
  const checks = (count: number) => () => {
    for (let index = 0; index < count; index++) {
      s[didNotReceive]().g(1)
      s[received](0).h()
    }
  }
  await nextRun()
  // c503043: a stack capture per view, 6,000 here (the most of what such a check cost)
  const captures = capturesOf(checks(3000))
  t.is(captures, VIEW_SITES_PER_RUN)
  // every synchronous run starts again
  await nextRun()
  t.is(capturesOf(checks(10)), 20)
})

test('R10V-2 (E61) a dangling check view after them is still reported, without the line of the check; the next run has the line again', t => {
  const clock = interceptDeferredReports()
  try {
    clock.run()
    const s = Substitute.for<any>()
    for (let index = 0; index < VIEW_SITES_PER_RUN; index++) s[didNotReceive]().g(1)
    s[received](2)
    let errors = clock.run()
    t.is(errors.length, 1)
    t.true(errors[0] instanceof SubstituteException)
    t.true((errors[0] as Error).message.startsWith('@Substitute[received](2) checked nothing'), (errors[0] as Error).message)
    t.false(/^\s+at /m.test((errors[0] as Error).stack!), (errors[0] as Error).stack)
    // a matcher usage error in the arguments of such a view leaves its report (as with Error.stackTraceLimit = 0)
    for (let index = 0; index < VIEW_SITES_PER_RUN; index++) s[didNotReceive]().g(1)
    t.throws(() => s[received](1)(Arg.any('String' as any)), { instanceOf: TypeError })
    errors = clock.run()
    t.is(errors.length, 1)
    t.true((errors[0] as Error).message.startsWith('@Substitute[received](1) checked nothing'), (errors[0] as Error).message)

    // in the next run, the report points at the line of the dangling view again
    s[received](2); const danglingLine = new Error().stack!.split('\n')[1]
    errors = clock.run()
    t.is(errors.length, 1)
    const at = (frame: string) => frame.replace(/^.*\((.*):\d+\)$/, '$1').replace(/^\s*at /, '')
    t.is(at((errors[0] as Error).stack!.split('\n').find(line => line.includes('round11.test'))!), at(danglingLine))
    // and a matcher usage error in its arguments cancels its report, as before
    t.throws(() => s[received](1)(Arg.any('String' as any)), { instanceOf: TypeError })
    t.deepEqual(clock.run(), [])
  } finally {
    clock.uninstall()
  }
})

// ---- E59 (R10-ADV-1): the deeper re-print also applies when the expected call holds matchers -----------------------

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

test('R10-ADV-1 (E59) a matcher for a generated id next to a DTO that differs three levels down: both lines are printed deeper', t => {
  const repo = Substitute.for<any>()
  repo.save({ id: 'u-81f3', profile: { address: { geo: { lat: 59.9, lng: 10.7 } } } })
  const saved = linesOf(messageOf(() => repo.received(1).save({ id: Arg.any('string'), profile: { address: { geo: { lat: 60.4, lng: 5.3 } } } })))
  // 8ce308a: save({ id: Arg.any{string}, profile: { address: { geo: [Object] } } }) and save({ id: 'u-81f3', profile: { address: { geo: [Object] } } })
  t.is(saved.expected, 'save({ id: Arg.any{string}, profile: { address: { geo: { lat: 60.4, lng: 5.3 } } } })')
  t.deepEqual(saved.received, ["@Substitute.save({ id: 'u-81f3', profile: { address: { geo: { lat: 59.9, lng: 10.7 } } } })"])

  // a matcher in another argument (a callback)
  const http = Substitute.for<any>()
  http.post('/orders', { order: { lines: [{ sku: 'A', qty: 1 }] } }, (): void => undefined)
  const posted = linesOf(messageOf(() => http.received(1).post('/orders', { order: { lines: [{ sku: 'A', qty: 2 }] } }, Arg.any('function'))))
  t.is(posted.expected, "post('/orders', { order: { lines: [ { sku: 'A', qty: 2 } ] } }, Arg.any{function})")
  t.deepEqual(posted.received, ["@Substitute.post('/orders', { order: { lines: [ { sku: 'A', qty: 1 } ] } }, [Function (anonymous)])"])

  // Arg.any() for a timestamp in an ORM update, and Arg.all() for the rest of the arguments
  const prisma = Substitute.for<any>()
  prisma.user.update({ where: { id: 7 }, data: { updatedAt: new Date(0), settings: { notifications: { email: true } } } })
  const updated = linesOf(messageOf(() => prisma.user.received(1).update({ where: { id: 7 }, data: { updatedAt: Arg.any(), settings: { notifications: { email: false } } } })))
  t.is(updated.expected, 'update({ where: { id: 7 }, data: { updatedAt: Arg.any{any}, settings: { notifications: { email: false } } } })')
  t.deepEqual(updated.received, ['@Substitute.user.update({ where: { id: 7 }, data: { updatedAt: 1970-01-01T00:00:00.000Z, settings: { notifications: { email: true } } } })'])
  const log = Substitute.for<any>()
  log.write({ a: { b: { c: { d: 1 } } } }, 'x', 'y')
  const written = linesOf(messageOf(() => log.received(1).write({ a: { b: { c: { d: 2 } } } }, Arg.all())))
  t.is(written.expected, 'write({ a: { b: { c: { d: 2 } } } }, Arg.all{})')
  t.deepEqual(written.received, ["@Substitute.write({ a: { b: { c: { d: 1 } } } }, 'x', 'y')"])
})

test('R10-ADV-1 (E59) where only a matcher that does not match tells the lines apart, they are printed as before', t => {
  const s = Substitute.for<any>()
  s.f(3, { a: { b: { c: { d: 1 } } } })
  // the lines differ at the matcher only: printing deeper would show nothing new
  const same = linesOf(messageOf(() => s.received(1).f(Arg.is((n: number) => n > 5), { a: { b: { c: { d: 1 } } } })))
  t.is(same.expected, 'f(Arg.is{(n) => n > 5}, { a: { b: { c: [Object] } } })')
  t.deepEqual(same.received, ['@Substitute.f(3, { a: { b: { c: [Object] } } })'])
  // and where they also differ further down, the lines are printed as deep as that takes
  const deeper = linesOf(messageOf(() => s.received(1).f(Arg.is((n: number) => n > 5), { a: { b: { c: { d: 2 } } } })))
  t.is(deeper.expected, 'f(Arg.is{(n) => n > 5}, { a: { b: { c: { d: 2 } } } })')
  t.deepEqual(deeper.received, ['@Substitute.f(3, { a: { b: { c: { d: 1 } } } })'])
  // a line that already differs where it is printed stays as it was
  s.f(4, { a: 1 })
  const mixed = linesOf(messageOf(() => s.received(1).f(Arg.any('number'), { a: { b: { c: { d: 2 } } } })))
  t.is(mixed.expected, 'f(Arg.any{number}, { a: { b: { c: { d: 2 } } } })')
  t.deepEqual(mixed.received, ['@Substitute.f(3, { a: { b: { c: { d: 1 } } } })', '@Substitute.f(4, { a: 1 })'])
})

// ---- E59, E60: the comparison that decides how deep the lines are printed agrees with the printed texts ------------

class Point { constructor(readonly x: unknown, readonly y: unknown) { } }
class OtherPoint { constructor(readonly x: unknown, readonly y: unknown) { } }

test('R10-ADV-1, R10V-1 (E59, E60) firstVisibleDifference finds the least depth at which two calls print differently, matchers left out', t => {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const below = (count: number) => Math.floor(random() * count)
  const substitutes = [Substitute.for<any>(), Substitute.for<any>(), Substitute.for<any>().child]
  const leaf = (): unknown => {
    const pick = random()
    if (pick < 0.2) return below(5)
    if (pick < 0.3) return ['a', 'b', 'x'.repeat(250), 'x'.repeat(249) + 'y', 'y'.repeat(1200), 'y'.repeat(1199) + 'z'][below(6)]
    if (pick < 0.35) return [null, undefined, true, -0, 0, NaN][below(6)]
    if (pick < 0.38) return new Date(below(3) * 1000)
    if (pick < 0.41) return new Map([[below(2), below(2)]])
    if (pick < 0.43) return new Set(below(2) === 1 ? [1] : [])
    if (pick < 0.46) return new Error(`e${below(2)}`)
    if (pick < 0.49) return [Symbol('s'), Symbol.for('r')][below(2)]
    if (pick < 0.55) return substitutes[below(3)]
    if (pick < 0.6) return new [Point, OtherPoint][below(2)](below(2), below(2))
    if (pick < 0.63) return Object.defineProperty({}, 'g', { get: () => 1, enumerable: true })
    if (pick < 0.65) return Object.create(null)
    if (pick < 0.67) { const holes = [1, 2, 3]; delete holes[below(3)]; return holes }
    return {}
  }
  const build = (level: number): unknown => {
    const pick = random()
    if (level > 6 || pick < 0.3) return leaf()
    if (pick < 0.5) return Array.from({ length: below(4) + (random() < 0.05 ? 22 : 0) }, () => build(level + 1))
    if (pick < 0.55) return new Point(build(level + 1), build(level + 1))
    const object: Record<string, unknown> = {}
    const width = below(4) + (random() < 0.05 ? 21 : 0)
    for (let index = 0; index < width; index++) object[`k${below(30)}`] = build(level + 1)
    return object
  }
  const isPlain = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)
  const clone = (value: unknown): unknown => {
    if (Array.isArray(value) && Object.keys(value).length === value.length) return value.map(clone)
    if (isPlain(value) && !Array.isArray(value)) {
      const copy: Record<string, unknown> = {}
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if ('value' in descriptor) copy[key] = clone(value[key])
        else Object.defineProperty(copy, key, descriptor)
      }
      return copy
    }
    return value instanceof Point ? new Point(clone(value.x), clone(value.y)) : value
  }
  // the ways to the values in plain containers
  const pathsIn = (root: unknown): string[][] => {
    const found: string[][] = []
    const visit = (value: unknown, path: string[], depth: number) => {
      if (depth > 7 || !isPlain(value)) return
      for (const key of Object.keys(value)) {
        if (!('value' in Object.getOwnPropertyDescriptor(value, key)!)) continue
        found.push([...path, key])
        visit(value[key], [...path, key], depth + 1)
      }
    }
    visit(root, [], 0)
    return found
  }
  const at = (root: unknown, path: string[]) => path.reduce((value: any, key) => value?.[key], root)
  const put = (root: unknown, path: string[], value: unknown) => { at(root, path.slice(0, -1))[path[path.length - 1]] = value }
  const noteHolders = (root: unknown, path: string[]) => path.forEach((_, index) => noteMatcherHolder(at(root, path.slice(0, index))))
  const textAt = (args: unknown[], depth: number) => formatArguments(args, false, messageBounds(depth), value => formatValue(value, false, messageBounds(depth)))

  let compared = 0
  let deeper = 0
  let withMatchers = 0
  for (let sample = 0; sample < 700; sample++) {
    const expected = [build(0)]
    const actual = [clone(expected[0])]
    const paths = pathsIn(actual[0])
    if (paths.length === 0) continue
    // the received call differs somewhere
    put(actual[0], paths[below(paths.length)], random() < 0.3 ? build(3) : leaf())
    // and the expected call may hold matchers: the received call with the same matchers in the same places prints as
    // the comparison should see it
    const masked = [clone(actual[0])]
    if (random() < 0.5) {
      const places = pathsIn(expected[0]).filter(path => isPlain(at(actual[0], path.slice(0, -1))) && isPlain(at(masked[0], path.slice(0, -1))))
      for (let index = 0; index < 2 && places.length > 0; index++) {
        const path = places[below(places.length)]
        if (!isPlain(at(expected[0], path.slice(0, -1))) || !isPlain(at(masked[0], path.slice(0, -1)))) continue
        const matcher = Arg.any()
        put(expected[0], path, matcher)
        put(masked[0], path, matcher)
        noteHolders(expected[0], path)
        noteHolders(masked[0], path)
      }
    }
    const matchers = deepestMatcher(expected, 32)
    if (matchers >= 0) withMatchers++
    const search = { bounds: MESSAGE_BOUNDS, maxDepth: MAX_MESSAGE_DEPTH, textOf: (value: unknown, depth: number) => formatValue(value, false, messageBounds(depth)), keys: new Map(), entries: 100_000 }
    const depth = firstVisibleDifference(search, expected, actual, -1)
    // (with matchers, a message compares the lines from the depth that shows the matchers' containers on)
    const from = matchers < 0 ? 0 : Math.min(MAX_MESSAGE_DEPTH, Math.max(MESSAGE_BOUNDS.depth, matchers - 1))
    compared++
    for (let shallower = from; shallower < Math.min(depth, MAX_MESSAGE_DEPTH + 1); shallower++)
      t.is(textAt(masked, shallower), textAt(expected, shallower), `sample ${sample}: alike ${shallower} levels deep`)
    if (depth >= from && depth <= MAX_MESSAGE_DEPTH) {
      if (depth > 0) deeper++
      const text = textAt(expected, depth)
      // (unless the difference is in a part that is cut off)
      if (!text.includes('more characters)')) t.not(textAt(masked, depth), text, `sample ${sample}: different ${depth} levels deep`)
    }
  }
  t.true(compared > 250 && deeper > 50 && withMatchers > 100, `${compared} compared, ${deeper} different deeper down, ${withMatchers} with matchers`)
})
