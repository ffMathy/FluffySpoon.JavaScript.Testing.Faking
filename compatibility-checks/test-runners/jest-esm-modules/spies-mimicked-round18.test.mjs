import { describe, expect, test } from '@jest/globals'
import { spyOn, restoreAllMocks } from '@vitest/spy'
import { Substitute, Arg, clearReceivedCalls, configure, mimick } from '@fluffy-spoon/substitute'

// Round 18 (E131, R17-ADV-10): vitest's vi.spyOn (the spyOn of @vitest/spy) on a member of a substitute that mimicks an
// instance. When the instance calls the spied member itself, through `this`, while a call of the substitute is delegated
// to it, that call is the instance's own: the spy sees it, the substitute does not record it and no setup answers it, as
// without the spy. Calls of the member through the substitute are recorded and answered by setups, as before.
// test/index.ts runs this file with jest.modules.esm.config.js (ES modules); it must pass.

class OrderService {
  place(order) {
    return this.validate(order) ? 'placed' : 'rejected'
  }

  validate(order) {
    return order.id > 0
  }
}

describe('E131 vi.spyOn on a mimicked substitute', () => {
  test('the instance\'s own this-call of the spied member', () => {
    const svc = Substitute.for()
    svc[mimick](new OrderService())
    svc[configure]().validate({ id: 0 }).returns(true) // for other callers of validate()
    const spy = spyOn(svc, 'validate')
    // (for a method on the prototype, vi.spyOn reads the member, and reads are recorded)
    svc[clearReceivedCalls]()

    expect(svc.place({ id: 0 })).toBe('rejected')
    expect(spy.mock.calls).toEqual([[{ id: 0 }]])
    svc.received(1).place({ id: 0 })
    expect(() => svc.received(1).validate({ id: 0 })).toThrow('but received none')
    svc.didNotReceive().validate(Arg.all())

    // through the substitute: recorded, and the setup answers before the spy
    expect(svc.validate({ id: 0 })).toBe(true)
    expect(svc.validate({ id: 2 })).toBe(true)
    expect(spy.mock.calls).toEqual([[{ id: 0 }], [{ id: 2 }]])
    svc.received(2).validate(Arg.any())

    restoreAllMocks()
    expect(svc.place({ id: 0 })).toBe('rejected')
    svc.received(2).validate(Arg.any())
  })

  test('an object with own methods, and a fluent method calling this', () => {
    const real = {
      items: [],
      add(item) {
        this.items.push(item)
        return this
      },
      addAll(items) {
        for (const item of items) this.add(item)
        return this
      }
    }
    const cart = Substitute.for()
    cart[mimick](real)
    const spy = spyOn(cart, 'add')
    expect(cart.addAll([1, 2])).toBe(cart)
    expect(spy.mock.calls).toEqual([[1], [2]])
    expect(real.items).toEqual([1, 2])
    cart.received(1).addAll([1, 2])
    cart.didNotReceive().add(Arg.all())
    expect(cart.add(3).add(4)).toBe(cart)
    cart.received(2).add(Arg.any())
    restoreAllMocks()
  })
})
