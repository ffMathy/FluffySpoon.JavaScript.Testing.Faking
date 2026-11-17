import test from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute, Arg, configure } from '../../../src'
import { RecordedArguments } from '../../../src/internals/RecordedArguments'
import { hashArguments, structuralHash } from '../../../src/internals/utilities/ArgumentHash'
import { assertWithin, timeLimit } from '../../helpers/timing'

// Round 5: the structural hash and the search for nested matchers (R4-ADV-2, R4-ADV-4; E9, E10). Only agreement with
// the RUNNING Node.js's isDeepStrictEqual is asserted, never its own results, which differ between versions.

const deepStrictEqual = (a: unknown, b: unknown): boolean => {
  try {
    return isDeepStrictEqual(a, b)
  } catch {
    return false
  }
}

/** An object that inherits from Error.prototype without being a native error, optionally tagged as an error. */
const errorLike = (message: string, tag?: string): Error => Object.create(Error.prototype, {
  message: { value: message, writable: true, configurable: true },
  ...(tag === undefined ? {} : { [Symbol.toStringTag]: { value: tag, configurable: true } })
})
const taggedError = (message: string, tag: string): Error =>
  Object.defineProperty(new Error(message), Symbol.toStringTag, { value: tag, configurable: true })

test('R4-ADV-4 (E10) an error-like object that the running Node.js finds deep strictly equal to a native error hashes like it', t => {
  const native = new Error('timeout')
  const like = errorLike('timeout', 'Error')
  let equalPairs = 0
  const values = [
    native, like, new Error('other'), errorLike('timeout'), errorLike('other'), errorLike('other', 'Error'),
    taggedError('timeout', 'Object'), taggedError('other', 'Object'), new TypeError('timeout'),
    Object.assign(errorLike('timeout', 'Error'), { code: 1 }), Object.assign(new Error('timeout'), { code: 1 })
  ]
  // in both orders: Node.js 24 and later compare a native error tagged [object Object] asymmetrically
  for (const a of values) {
    for (const b of values) {
      if (!deepStrictEqual(a, b)) continue
      equalPairs++
      t.is(structuralHash(a), structuralHash(b), `${Object.prototype.toString.call(a)} ${a.message} / ${Object.prototype.toString.call(b)} ${b.message}`)
      t.is(hashArguments([a]), hashArguments([b]))
    }
  }
  t.true(equalPairs > values.length, `${equalPairs} equal pairs`)

  // setups and the auto-substitute cache agree with deep strict equality
  const handler = Substitute.for<any>()
  handler.handle(native).returns('retry')
  if (deepStrictEqual(native, like)) {
    t.is(handler.handle(like), 'retry')
    t.is(handler.notify(like), handler.notify(native))
  } else t.not(handler.handle(like), 'retry')
  handler.notify(like)
  t.notThrows(() => handler.received().notify(native))
})

const millisecondsOf = (run: () => void) => {
  const start = process.hrtime.bigint()
  run()
  return Number(process.hrtime.bigint() - start) / 1e6
}
const bestOfThree = (run: () => void) => {
  run() // warm up
  return Math.min(millisecondsOf(run), millisecondsOf(run), millisecondsOf(run))
}

/** An object with `size` keys, as a table of translations. */
const wideObject = (size: number): Record<string, unknown> => {
  const object: Record<string, unknown> = {}
  for (let index = 0; index < size; index++) object[`message.key.${index}`] = `text ${index}`
  return object
}

test('R4-ADV-2 (E9) wide objects and Maps shared by many values, or passed again and again, cost a bounded amount per call', t => {
  // the values are created beforehand: only the calls are timed
  const labels = wideObject(5000)
  const rows = Array.from({ length: 10 }, (_, call) => Array.from({ length: 256 }, (_, row) => ({ id: call * 1000 + row, labels })))
  const catalog = new Map(Array.from({ length: 10_000 }, (_, index): [string, { priceCents: number }] => [`sku-${index}`, { priceCents: index }]))
  const orders = Array.from({ length: 10 }, (_, call) => Array.from({ length: 300 }, (_, order) => ({ id: call * 1000 + order, catalog })))
  const messages = wideObject(10_000)

  const cases: Array<[string, () => void]> = [
    ['10 calls with 256 rows sharing one 5,000-key object', () => {
      const view = Substitute.for<any>()
      for (const call of rows) view.render(call)
    }],
    ['10 calls with 300 rows sharing one 10,000-entry Map', () => {
      const repository = Substitute.for<any>()
      for (const call of orders) repository.saveAll(call)
    }],
    ['2,000 calls with the same 10,000-key object', () => {
      const i18n = Substitute.for<any>()
      for (let index = 0; index < 2000; index++) i18n.t(`key${index % 20}`, messages)
    }],
    ['a literal setup with a 10,000-key object and 1,000 calls with the same object', () => {
      const i18n = Substitute.for<any>()
      i18n.t('greeting', messages).returns('Hello')
      for (let index = 0; index < 1000; index++) i18n.t(`key${index % 20}`, messages)
      for (let index = 0; index < 1000; index++) if (i18n.t('greeting', messages) !== 'Hello') throw new Error('greeting')
    }]
  ]
  for (const [name, run] of cases) {
    const elapsedLimit = timeLimit(1000)
    const elapsed = bestOfThree(run)
    assertWithin(t, elapsed, elapsedLimit, `${name}`)
  }

  // still exact: deep strictly equal copies find the setup, other values do not, and the most recent setup wins
  const i18n = Substitute.for<any>()
  i18n.t('greeting', messages).returns('Hello')
  t.is(i18n.t('greeting', { ...messages }), 'Hello')
  t.not(i18n.t('greeting', { ...messages, extra: 'x' }), 'Hello')
  t.not(i18n.t('farewell', messages), 'Hello')
  i18n.t('farewell', { ...messages }).returns('Bye')
  t.is(i18n.t('farewell', messages), 'Bye')
  i18n[configure]().t('greeting', { ...messages }).returns('Hi')
  t.is(i18n.t('greeting', messages), 'Hi')
  t.is(i18n.t('key3', messages), i18n.t('key3', { ...messages }))
  const repository = Substitute.for<any>()
  t.is(repository.saveAll(orders[0]), repository.saveAll(orders[0].map(order => ({ ...order }))))

  // an object mutated after a call, then configured with a copy, still finds the setup when it is passed again
  const api = Substitute.for<any>()
  const request = { id: 1 }
  api.fetch(request)
  request.id = 2
  api.fetch({ id: 2 }).returns('two')
  t.is(api.fetch(request), 'two')
})

test('R4-ADV-2 (E9) the search for nested matchers looks at a shared container once, and at a too wide one never again', t => {
  const shared = { role: Arg.any('string') }
  const repository = Substitute.for<any>()
  repository.save([{ user: shared }, { user: shared }]).returns('saved')
  t.is(repository.save([{ user: { role: 'admin' } }, { user: { role: 'guest' } }]), 'saved')
  t.not(repository.save([{ user: { role: 1 } }, { user: { role: 'guest' } }]), 'saved')

  // in an array of 1,000 objects, each object is searched (README "Matchers inside objects and arrays")
  const rows = Array.from({ length: 1000 }, (_, index): Record<string, unknown> => ({ id: index, a: 1, b: 2, c: 3, d: 4 }))
  rows[999] = { ...rows[999], id: Arg.any() }
  repository.import(rows).returns('imported')
  t.is(repository.import(rows.map((row, index) => ({ ...row, id: index }))), 'imported')

  // a matcher in an object with more than 1024 keys is not looked for (the documented bound): it is a literal value
  const wide = wideObject(2000)
  wide.extra = Arg.any()
  const store = Substitute.for<any>()
  store.put(wide)
  t.notThrows(() => store.received(1).put(wide))

  const elapsedLimit = timeLimit(250)
  const elapsed = bestOfThree(() => {
    for (let index = 0; index < 2000; index++) RecordedArguments.containsMatchers([`key${index}`, wide])
  })
  assertWithin(t, elapsed, elapsedLimit, `2,000 searches of a 2,001-key object`)
})
