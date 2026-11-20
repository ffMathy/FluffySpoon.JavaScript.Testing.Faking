import test from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute, Arg, configure } from '../../../src'

// Round 5: wide and error-like arguments, and the search for nested matchers (R4-ADV-2, R4-ADV-4; E9, E10). Only
// agreement with the RUNNING Node.js's isDeepStrictEqual is asserted, never its own results, which differ between versions.

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
test('R4-ADV-4 (E10) an error-like object that the running Node.js finds deep strictly equal to a native error matches like it', t => {
  const native = new Error('timeout')
  const like = errorLike('timeout', 'Error')

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

/** An object with `size` keys, as a table of translations. */
const wideObject = (size: number): Record<string, unknown> => {
  const object: Record<string, unknown> = {}
  for (let index = 0; index < size; index++) object[`message.key.${index}`] = `text ${index}`
  return object
}

test('R4-ADV-2 (E9) wide objects and Maps shared by many values, or passed again and again: setups and auto-substitutes stay exact', t => {
  const catalog = new Map(Array.from({ length: 10_000 }, (_, index): [string, { priceCents: number }] => [`sku-${index}`, { priceCents: index }]))
  const orders = Array.from({ length: 300 }, (_, order) => ({ id: order, catalog }))
  const messages = wideObject(10_000)

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
  t.is(repository.saveAll(orders), repository.saveAll(orders.map(order => ({ ...order }))))

  // an object mutated after a call, then configured with a copy, still finds the setup when it is passed again
  const api = Substitute.for<any>()
  const request = { id: 1 }
  api.fetch(request)
  request.id = 2
  api.fetch({ id: 2 }).returns('two')
  t.is(api.fetch(request), 'two')
})

test('R4-ADV-2 (E9) the search for nested matchers looks at a shared container once, and into a wide one too', t => {
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

  // a matcher in an object with more than 1024 keys is found: the call is a setup
  const wide = wideObject(2000)
  wide.extra = Arg.any()
  const store = Substitute.for<any>()
  store.put(wide).returns('found')
  t.is(store.put({ ...wide, extra: 1 }), 'found')
})
