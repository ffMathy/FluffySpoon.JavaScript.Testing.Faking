import test from 'ava'

import { Substitute } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 11: failure messages whose lines print alike (fix spec E60, R10V-1).

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

/** 20 keys, each `{ deep: { deeper: value } }`. */
const leaf = (value: number) => {
  const object: Record<string, unknown> = {}
  for (let key = 0; key < 20; key++) object[`key${key}`] = { deep: { deeper: value } }
  return object
}
/** An argument that differs from another one only six levels down: it prints alike up to four levels deep. */
const argument = (value: number) => ({ a: { b: { c: leaf(value) } } })

test('R10V-1 (E60) a message whose 50 listed calls print alike with 20 deep arguments each prints them two levels deep', t => {
  // R10V-1's shape: 60 calls with copies of the same 20 arguments, which differ from the expected ones six levels down
  const shared = Substitute.for<any>()
  const sharedArguments = Array.from({ length: 20 }, () => argument(0))
  for (let index = 0; index < 60; index++) shared.f(...sharedArguments.map(value => ({ ...value })))
  // and 60 calls with fresh arguments each
  const fresh = Substitute.for<any>()
  for (let index = 0; index < 60; index++) fresh.f(...Array.from({ length: 20 }, () => argument(0)))
  const expected = Array.from({ length: 20 }, () => argument(1))

  // they print alike up to four levels deep, so they are printed two levels deep, as before round 10
  const message = messageOf(() => shared.received(1).f(...expected))
  t.true(message.includes('matching f({ a: { b: { c: [Object] } } }, { a: { b: { c: [Object] } } },'), message.slice(0, 300))
  t.true(message.includes('› ✘ @Substitute.f({ a: { b: { c: [Object] } } }, { a: { b: { c: [Object] } } },'), message.slice(0, 600))
  t.is(messageOf(() => fresh.received(1).f(...expected)).replace(/@Substitute/g, ''), message.replace(/@Substitute/g, ''))
})

test('R10V-1 (E60) messages whose listed calls print alike with one deep argument, or long strings cut alike, print them two levels deep', t => {
  const s = Substitute.for<any>()
  const shared = argument(0)
  for (let index = 0; index < 60; index++) s.f({ ...shared })
  const expected = argument(1)
  t.true(messageOf(() => s.received(1).f(expected)).includes('› ✘ @Substitute.f({ a: { b: { c: [Object] } } })'))

  // strings that differ beyond what is shown of them
  const base = 'x'.repeat(300)
  const log = Substitute.for<any>()
  for (let index = 0; index < 60; index++) log.write({ message: { text: base + index, meta: { a: { b: 1 } } } })
  const check = () => log.received(1).write({ message: { text: `${base}zz`, meta: { a: { b: 1 } } } })
  t.true(messageOf(check).includes("meta: { a: [Object] }"))
})
