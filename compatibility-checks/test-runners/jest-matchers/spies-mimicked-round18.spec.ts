import { describe, expect, jest, test } from '@jest/globals'
import { mock } from 'node:test'
import Substitute, { Arg, clearReceivedCalls, configure, mimick } from '@fluffy-spoon/substitute'

// Round 18 (E129, E131; R17-ADV-4, R17-ADV-10): spies on a substitute that mimicks an instance, with the real tools.
// - node:test's mock.method with an implementation, and mockImplementation() on one without: the substitute comes
//   first (setups answer, each call is recorded once), the implementation answers the other calls, and the mock still
//   counts every call.
// - jest.spyOn and an assignment wrapper: the instance's own call of the spied member through `this`, made while a call of
//   the substitute is delegated to the instance, is the instance's own (not recorded, no setup answers it), as without
//   the spy. (vi.spyOn: test-runners/jest-esm-modules/spies-mimicked-round18.test.mjs; sinon:
//   test-runners/jest-matchers/sinon-mimicked-round18.spec.ts.)
// test/index.ts runs this file with `npm run validate:jest-matchers`; it must pass.

interface Fs {
  stat(path: string): { size: number }
}

const fsInstance = () => {
  const stat = (path: string) => ({ size: path.length })
  return { stat, real: { stat } as Fs }
}

class OrderService {
  place(order: { id: number }): string {
    return this.validate(order) ? 'placed' : 'rejected'
  }

  validate(order: { id: number }): boolean {
    return order.id > 0
  }
}

describe('E129 node:test mock.method on a mimicked substitute', () => {
  test('with an implementation: setups first, the implementation answers the other calls, each call recorded once', () => {
    const { stat, real } = fsInstance()
    const fs = Substitute.for<Fs>()
    fs[mimick](real)
    fs[configure]().stat('/configured').returns({ size: 99 })

    const spied = mock.method(fs, 'stat', (path: string) => ({ size: -path.length }))
    try {
      expect(fs.stat('/configured')).toEqual({ size: 99 })
      expect(fs.stat('/xy')).toEqual({ size: -3 })
      expect(real.stat).toBe(spied)
      expect(spied.mock.callCount()).toBe(2)
      fs.received(1).stat('/configured')
      fs.received(1).stat('/xy')
      expect(() => fs.didNotReceive().stat('/xy')).toThrow('Expected to receive 0 method calls')
    } finally {
      mock.restoreAll()
    }
    expect(real.stat).toBe(stat)
    expect(fs.stat('/abc')).toEqual({ size: 4 })
    fs.received(3).stat(Arg.any())
  })

  test('without an implementation, then mockImplementation(): the setups still answer first', () => {
    const { stat, real } = fsInstance()
    const fs = Substitute.for<Fs>()
    fs[mimick](real)
    fs[configure]().stat('/configured').returns({ size: 99 })

    // (typed as the plain interface, as the code under test sees it)
    const spied = mock.method(fs as Fs, 'stat')
    try {
      expect(fs.stat('/xy')).toEqual({ size: 3 })
      spied.mock.mockImplementation(() => ({ size: -2 }))
      expect(fs.stat('/configured')).toEqual({ size: 99 })
      expect(fs.stat('/ab')).toEqual({ size: -2 })
      expect(spied.mock.callCount()).toBe(3)
      fs.received(1).stat('/configured')
      fs.received(1).stat('/ab')
      fs.received(3).stat(Arg.any())
    } finally {
      mock.restoreAll()
    }
    expect(real.stat).toBe(stat)
  })
})

describe('E131 the instance\'s own calls through `this` of a spied member', () => {
  test('jest.spyOn: place() calls this.validate(), which the spy sees and the substitute does not record', () => {
    const instance = new OrderService()
    const svc = Substitute.for<OrderService>()
    svc[mimick](instance)
    svc[configure]().validate({ id: 0 }).returns(true) // for other callers of validate()
    jest.spyOn(svc, 'validate')
    ;(svc as any)[clearReceivedCalls]() // (jest.spyOn reads the member, and reads are recorded)

    expect(svc.place({ id: 0 })).toBe('rejected')
    expect(jest.mocked(instance.validate).mock.calls).toEqual([[{ id: 0 }]])
    svc.received(1).place({ id: 0 })
    expect(() => svc.received(1).validate({ id: 0 })).toThrow('but received none')
    svc.didNotReceive().validate(Arg.all())
    // a call by the test (or the code under test) goes through the substitute, as before
    expect(svc.validate({ id: 0 })).toBe(true)
    svc.received(1).validate({ id: 0 })
    jest.restoreAllMocks()
  })

  test('an assignment wrapper, and node:test\'s mock.method on an own method: the same', () => {
    const wrapped = Substitute.for<OrderService>()
    wrapped[mimick](new OrderService())
    wrapped[configure]().validate({ id: 0 }).returns(true)
    const seen: unknown[] = []
    const original = wrapped.validate
    ;(wrapped as OrderService).validate = function (this: unknown, order: { id: number }) {
      seen.push(order)
      return original.call(this, order)
    }
    ;(wrapped as any)[clearReceivedCalls]()
    expect(wrapped.place({ id: 0 })).toBe('rejected')
    expect(seen).toEqual([{ id: 0 }])
    wrapped.didNotReceive().validate(Arg.all())

    const own = Substitute.for<OrderService>()
    own[mimick]({
      place(this: OrderService, order: { id: number }) { return this.validate(order) ? 'placed' : 'rejected' },
      validate(order: { id: number }) { return order.id > 0 }
    })
    own[configure]().validate({ id: 0 }).returns(true)
    const spied = mock.method(own, 'validate')
    try {
      expect(own.place({ id: 0 })).toBe('rejected')
      expect(spied.mock.callCount()).toBe(1)
      own.didNotReceive().validate(Arg.all())
    } finally {
      mock.restoreAll()
    }
  })
})
