import test from 'ava'

import { Substitute } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 12: failure messages whose lines hold Maps and Sets (fix spec E69, R11V-5).

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

test('R11V-5 (E69) a message whose 50 listed calls print alike with 20 arguments holding a Set or a Map prints them two levels deep, as with an array', t => {
  // R11V-5's shapes: the data of R10V-1's arguments inside a Set, a Map, or an array; they print alike up to four levels
  // deep
  const shapes = {
    Array: (value: number) => ({ s: [{ a: { b: leaf(value) } }] }),
    Set: (value: number) => ({ s: new Set([{ a: { b: leaf(value) } }]) }),
    Map: (value: number) => ({ s: new Map([['k', { a: { b: leaf(value) } }]]) })
  }
  for (const [kind, argument] of Object.entries(shapes) as Array<[keyof typeof shapes, (value: number) => unknown]>) {
    const s = Substitute.for<any>()
    for (let index = 0; index < 60; index++) s.f(...Array.from({ length: 20 }, () => argument(0)))
    const expected = Array.from({ length: 20 }, () => argument(1))
    const check = () => s.received(1).f(...expected)
    // printed two levels deep, as before round 10
    const shown = kind === 'Array' ? '{ s: [ { a: [Object] } ] }' : `{ s: ${kind}(1) { ${kind === 'Map' ? "'k' => " : ''}{ a: [Object] } } }`
    t.true(messageOf(check).includes(`› ✘ @Substitute.f(${shown}, ${shown},`), messageOf(check).slice(0, 400))
  }
})
