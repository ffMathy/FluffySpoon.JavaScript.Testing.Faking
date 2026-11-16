import test from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute } from '../../../src'
import { hashArguments, structuralHash } from '../../../src/internals/utilities/ArgumentHash'

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
