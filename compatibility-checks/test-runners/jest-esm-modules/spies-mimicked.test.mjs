import { describe, expect, test } from '@jest/globals'
import { spyOn, restoreAllMocks } from '@vitest/spy'
import { Substitute, Arg, configure, mimick } from '@fluffy-spoon/substitute'

// Round 17 (E115, R16FE-4): vitest's vi.spyOn (it is the spyOn of @vitest/spy, which vitest re-exports) on a substitute
// that mimicks an instance. The descriptor of a mimicked method has the member handle as its value, so the spy wraps the
// handle and is defined on the instance, behind the substitute: setups still answer, each call is recorded once, and
// vi.restoreAllMocks() gives the instance its own function back. On a substitute that mimicks nothing, vi.spyOn works as
// before. test/index.ts runs this file with jest.modules.esm.config.js (ES modules); it must pass.

describe('E115 vi.spyOn on substitutes', () => {
  test('a mimicked substitute', () => {
    const stat = path => ({ size: path.length })
    const real = { stat, other: 1 }
    const fs = Substitute.for()
    fs[mimick](real)
    fs[configure]().stat('/configured').returns({ size: 99 })

    const spy = spyOn(fs, 'stat')
    expect(fs.stat('/configured')).toEqual({ size: 99 })
    expect(fs.stat('/xy')).toEqual({ size: 3 })
    expect(spy.mock.calls).toEqual([['/xy']])
    fs.received(1).stat('/configured')
    fs.received(1).stat('/xy')
    expect(Object.keys(fs)).toEqual(['stat', 'other'])

    restoreAllMocks()
    expect(real.stat).toBe(stat)
    expect(fs.stat('/abc')).toEqual({ size: 4 })
    fs.received(3).stat(Arg.any())
    expect(Object.keys(fs)).toEqual(['stat', 'other'])
  })

  test('a class instance, whose method is on the prototype', () => {
    class Client {
      query(sql) {
        return 'rows for ' + sql
      }
    }
    const real = new Client()
    const client = Substitute.for()
    client[mimick](real)
    const spy = spyOn(client, 'query')
    expect(client.query('x')).toBe('rows for x')
    expect(spy.mock.calls).toEqual([['x']])
    restoreAllMocks()
    expect(Object.prototype.hasOwnProperty.call(real, 'query')).toBe(false)
    expect(client.query('y')).toBe('rows for y')
    client.received(2).query(Arg.any())
  })

  test('a substitute that mimicks nothing, as before', () => {
    const api = Substitute.for()
    api.fetch(Arg.any()).returns('data')
    const spy = spyOn(api, 'fetch')
    expect(api.fetch('/users')).toBe('data')
    expect(spy.mock.calls).toEqual([['/users']])
    api.received(1).fetch('/users')
    restoreAllMocks()
  })
})
