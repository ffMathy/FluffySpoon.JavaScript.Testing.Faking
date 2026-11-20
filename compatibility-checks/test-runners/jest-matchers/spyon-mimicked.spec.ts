import { describe, expect, jest, test } from '@jest/globals'
import { mock } from 'node:test'
import Substitute, { Arg, configure, mimick } from '@fluffy-spoon/substitute'

// Round 17 (E114, E115; R16FE-3, R16FE-4): jest.spyOn and node:test's mock.method on a substitute that mimicks an
// instance. The spy goes to the instance, behind the substitute (an assignment, D12, or a definition by descriptor), so
// setups still answer, each call is recorded once, and restoring the spy gives the instance its own function back.
// (vitest's vi.spyOn: test-runners/jest-esm-modules/spies-mimicked.test.mjs.) test/index.ts runs this file with
// `npm run validate:jest-matchers`; it must pass.

interface Fs {
  stat(path: string): { size: number }
  save(name: string): string
}

const instance = () => {
  const stat = (path: string) => ({ size: path.length })
  return { stat, real: { stat, save: (name: string) => 'saved ' + name } as Fs }
}

describe('E114/E115 spies on a mimicked substitute', () => {
  test('jest.spyOn: the spy sees the calls that no setup answers; each call is recorded once; restoreAllMocks() restores the instance', () => {
    const { stat, real } = instance()
    const fs = Substitute.for<Fs>()
    fs[mimick](real)
    fs[configure]().stat('/configured').returns({ size: 99 })

    jest.spyOn(fs, 'stat')
    expect(jest.isMockFunction(real.stat)).toBe(true)
    expect(fs.stat('/configured')).toEqual({ size: 99 })
    expect(fs.stat('/xy')).toEqual({ size: 3 })
    expect(jest.mocked(real.stat).mock.calls).toEqual([['/xy']])
    fs.received(1).stat('/configured')
    fs.received(1).stat('/xy')
    fs.received(2).stat(Arg.any())

    jest.restoreAllMocks()
    expect(real.stat).toBe(stat)
    expect(fs.stat('/abc')).toEqual({ size: 4 })
    fs.received(3).stat(Arg.any())
    fs.didNotReceive().stat('/zz')
  })

  test('jest.spyOn on a class instance, whose method is on the prototype', () => {
    class Client {
      query(sql: string) {
        return 'rows for ' + sql
      }
    }
    const real = new Client()
    const client = Substitute.for<Client>()
    client[mimick](real)

    jest.spyOn(client, 'query')
    expect(client.query('x')).toBe('rows for x')
    expect(jest.mocked(real.query).mock.calls).toEqual([['x']])
    jest.restoreAllMocks()
    expect(Object.prototype.hasOwnProperty.call(real, 'query')).toBe(false)
    expect(client.query('y')).toBe('rows for y')
    client.received(2).query(Arg.any())
  })

  test('node:test mock.method: setups answer, each call is recorded once, and restoreAll() restores the instance', () => {
    const { stat, real } = instance()
    const fs = Substitute.for<Fs>()
    fs[mimick](real)
    fs[configure]().stat('/configured').returns({ size: 99 })

    const spied = mock.method(fs, 'stat')
    try {
      expect(fs.stat('/configured')).toEqual({ size: 99 })
      expect(fs.stat('/xy')).toEqual({ size: 3 })
      expect(spied.mock.callCount()).toBe(2)
      fs.received(1).stat('/configured')
      fs.received(1).stat('/xy')
    } finally {
      mock.restoreAll()
    }
    expect(real.stat).toBe(stat)
    expect(fs.stat('/configured')).toEqual({ size: 99 })
    fs.received(3).stat(Arg.any())
  })

  test('an instrumentation wrapper (`const original = obj.m; obj.m = wrap(original)`) runs the original once', () => {
    const real = { query: (sql: string) => 'rows for ' + sql }
    // (the code under test sees an ordinary object: typed as such)
    const client: { query(sql: string): string } = Substitute.for<{ query(sql: string): string }>()
    ;(client as any)[mimick](real)
    const original = client.query
    client.query = function (this: unknown, ...args: [string]) { return original.apply(this, args) }
    expect(client.query('SELECT 1')).toBe('rows for SELECT 1')
    ;(client as any).received(1).query('SELECT 1')
  })
})
