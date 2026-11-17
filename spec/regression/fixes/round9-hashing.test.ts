import test from 'ava'
import { isDeepStrictEqual } from 'util'

import { Substitute } from '../../../src'
import { structuralHash } from '../../../src/internals/utilities/ArgumentHash'
import { assertFast } from '../../helpers/timing'

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
