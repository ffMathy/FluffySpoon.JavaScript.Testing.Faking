import { describe, expect, test } from '@jest/globals'
import Substitute, { Arg, configure, mimick } from '@fluffy-spoon/substitute'

// Round 18 (R17-ADV-9, E131): sinon's spies on a substitute that mimicks an instance, as the README describes them.
// - sinon.replace(sub, 'm', fake) works for an own method of the instance: the fake goes to the instance, behind the
//   substitute; sinon.spy(sub, 'm') and sinon.stub(sub, 'm') throw ("already wrapped": sinon reads `restore` of the member
//   handle, a truthy auto-substitute).
// - For a method on the prototype of a class instance, all three throw (sinon finds no property descriptor on the
//   substitute or its prototype chain). Spying on the instance itself works: sinon.spy(instance, 'm'),
//   sinon.stub(instance, 'm') and sinon.replace(instance, 'm', fake), behind the substitute, whose setups answer first.
// - The instance's own call of a spied member through `this` is the instance's own (E131): not recorded.
// test/index.ts runs this file with `npm run validate:jest-matchers`; it must pass.

// (sinon has no types installed here)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sinon: any = require('sinon')

class Fs {
  stat(path: string): string {
    return 'stat:' + path
  }
}

const mimicked = (real: Fs) => {
  const fs = Substitute.for<Fs>()
  fs[mimick](real)
  fs[configure]().stat('cfg').returns('CFG')
  return fs
}

describe('sinon on a mimicked substitute', () => {
  test('an own method: replace() works behind the substitute; spy() and stub() on the substitute throw', () => {
    const real: Fs = { stat: (path: string) => 'stat:' + path }
    const fs = mimicked(real)
    const fake = sinon.fake((path: string) => 'fake:' + path)
    sinon.replace(fs, 'stat', fake)
    try {
      expect(fs.stat('a')).toBe('fake:a')
      expect(fs.stat('cfg')).toBe('CFG')
      expect(fake.callCount).toBe(1)
      fs.received(1).stat('a')
      fs.received(1).stat('cfg')
    } finally {
      sinon.restore()
    }
    expect(fs.stat('b')).toBe('stat:b')
    fs.received(3).stat(Arg.any())

    expect(() => sinon.spy(fs, 'stat')).toThrow('Attempted to wrap stat which is already wrapped')
    expect(() => sinon.stub(fs, 'stat')).toThrow('Attempted to wrap stat which is already wrapped')
    sinon.restore()
  })

  test('a method on the prototype of a class instance: replace(), spy() and stub() on the substitute throw; on the instance they work', () => {
    const real = new Fs()
    const fs = mimicked(real)
    expect(() => sinon.replace(fs, 'stat', sinon.fake())).toThrow('Cannot replace non-existent property stat')
    expect(() => sinon.spy(fs, 'stat')).toThrow('Attempted to wrap undefined property stat as function')
    expect(() => sinon.stub(fs, 'stat')).toThrow(TypeError)
    sinon.restore()

    const spy = sinon.spy(real, 'stat')
    try {
      expect(fs.stat('a')).toBe('stat:a')
      expect(fs.stat('cfg')).toBe('CFG')
      expect(spy.callCount).toBe(1)
      fs.received(1).stat('a')
    } finally {
      sinon.restore()
    }
    const stub = sinon.stub(real, 'stat').returns('stubbed')
    try {
      expect(fs.stat('b')).toBe('stubbed')
      expect(fs.stat('cfg')).toBe('CFG')
      expect(stub.callCount).toBe(1)
    } finally {
      sinon.restore()
    }
    expect(Object.prototype.hasOwnProperty.call(real, 'stat')).toBe(false)
    expect(fs.stat('c')).toBe('stat:c')
    fs.received(5).stat(Arg.any())
  })

  test('E131: the instance\'s own call of a member that sinon spies on, through `this`, is not recorded', () => {
    class OrderService {
      place(order: { id: number }): string {
        return this.validate(order) ? 'placed' : 'rejected'
      }

      validate(order: { id: number }): boolean {
        return order.id > 0
      }
    }
    const real = new OrderService()
    const svc = Substitute.for<OrderService>()
    svc[mimick](real)
    svc[configure]().validate({ id: 0 }).returns(true)
    const spy = sinon.spy(real, 'validate')
    try {
      expect(svc.place({ id: 0 })).toBe('rejected')
      expect(spy.callCount).toBe(1)
      svc.didNotReceive().validate(Arg.all())
      expect(svc.validate({ id: 0 })).toBe(true)
      svc.received(1).validate({ id: 0 })
    } finally {
      sinon.restore()
    }
  })
})
