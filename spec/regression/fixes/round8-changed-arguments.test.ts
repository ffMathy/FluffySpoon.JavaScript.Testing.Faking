import test from 'ava'

import { Substitute, Arg, configure } from '../../../src'
import { RecordedArguments } from '../../../src/internals/RecordedArguments'

// Round 8, engine A: containers that changed after they were used, values that cannot be read and the search for nested
// matchers (fix spec E29 to E32).

/** An object with `size` keys, in insertion order. */
const wideObject = (size: number, value: (index: number) => unknown, key: (index: number) => string = index => `k${index}`): Record<string, unknown> => {
  const object: Record<string, unknown> = {}
  for (let index = 0; index < size; index++) object[key(index)] = value(index)
  return object
}

// ---- E32: a value that cannot be read is read only to compare it ---------------------------------

test('R7TD-9 (E32) a setup made with .returns() on a call reads a throwing getter only to compare it, as a call or a setup alone does', t => {
  let reads = 0
  const unreadable = () => Object.defineProperty({}, 'name', { enumerable: true, get() { reads++; throw new Error('not loaded') } })
  const readsOf = (run: () => void) => {
    reads = 0
    run()
    return reads
  }
  // with nothing of the member to compare it with, it is not read (89e4175: 2, 74b8588 and f9ce534: 1)
  t.is(readsOf(() => Substitute.for<any>().k(unreadable()).returns(1)), 0)
  t.is(readsOf(() => Substitute.for<any>().k([unreadable()]).returns(1)), 0)
  t.is(readsOf(() => Substitute.for<any>().k(unreadable()).resolves(1)), 0)
  // a member that has literal setups already, with other values
  const withSetups = Substitute.for<any>()
  withSetups.k(1).returns(0)
  const value = unreadable()
  t.is(readsOf(() => withSetups.k(value).returns(2)), 0)
  t.is(withSetups.k(value), 2)
  // the second time, in a new array: the same value finds its auto-substitute without being read
  const again = Substitute.for<any>()
  const same = unreadable()
  again.k([same])
  t.is(readsOf(() => again.k([same]).returns(3)), 0)
  t.is(again.k([same]), 3)
  // a call alone, and a setup through configure() alone
  t.is(readsOf(() => Substitute.for<any>().k(unreadable())), 0)
  t.is(readsOf(() => Substitute.for<any>()[configure]().k(unreadable()).returns(1)), 0)

  // once the value can be read, a setup made while it could not is compared by its contents, like any other
  let loaded = false
  const user = Object.defineProperty({}, 'id', { enumerable: true, get() { if (!loaded) throw new Error('not loaded'); return 1 } })
  const repository = Substitute.for<any>()
  repository.save(user).returns('while unreadable')
  loaded = true
  t.is(repository.save({ id: 1 }), 'while unreadable')
  repository[configure]().save({ id: 1 }).returns('loaded')
  t.is(repository.save(user), 'loaded')
  t.is(repository.save({ id: 1 }), 'loaded')
  // a setup that comes after another recorded call does not take the verdict of the earlier call
  let ready = false
  const order = Object.defineProperty({}, 'total', { enumerable: true, get() { if (!ready) throw new Error('not loaded'); return 5 } })
  const orders = Substitute.for<any>()
  const pending = orders.place(order)
  void orders.other
  ready = true
  pending.returns('placed')
  t.is(orders.place({ total: 5 }), 'placed')
})

// ---- E30: a container held by a setup that changed afterwards -----------------------------------

test('R7V-2 (E30) after a container inside a setup\'s argument changed, a call compares with it as it is now, whatever its size', t => {
  // A setup (or an auto-substitute) holds the objects of its arguments. When one of them changes afterwards (not
  // supported, amended D15), a later call compares with it as it is now, as checks do: a new wrapper around it, or an
  // equal copy of its current state, matches.
  for (const size of [3, 256, 257, 1100]) {
    for (const kind of ['Set', 'Map', 'object'] as const) {
      const make = (): any => kind === 'Set' ? new Set(Array.from({ length: size }, (_, index) => index))
        : kind === 'Map' ? new Map(Array.from({ length: size }, (_, index) => [`k${index}`, index]))
          : wideObject(size, index => index)
      const change = (value: any) => { if (kind === 'object') delete value.k1; else value.delete(kind === 'Set' ? 1 : 'k1') }
      const name = `${kind} of ${size}`

      const renderer = Substitute.for<any>()
      const tags = make()
      const first = renderer.render({ tags })
      change(tags)
      t.is(renderer.render({ tags }), first, `${name}: the same auto-substitute`)

      const repository = Substitute.for<any>()
      const saved = make()
      repository.save({ tags: saved }).returns('saved')
      change(saved)
      t.is(repository.save({ tags: saved }), 'saved', name)
      // a copy of its state now
      t.is(repository.save({ tags: kind === 'object' ? { ...saved } : kind === 'Set' ? new Set(saved) : new Map(saved) }), 'saved', `${name}: a copy`)

      const audit = Substitute.for<any>()
      const checked = make()
      audit.save({ tags: checked })
      change(checked)
      t.notThrows(() => audit.received(1).save({ tags: checked }), name)
    }
  }
})

// ---- E31: wide objects shared by small arguments and by the records of wide containers ----------

test.serial('R7-ADV-4 (E31) calls whose small argument holds a shared wide table stay exact', t => {
  const table = wideObject(10_000, index => index, index => `key${index}`)
  // an equal wrapper, also with a copy of the table, finds the same auto-substitute, another id another one
  const sub = Substitute.for<any>()
  const first = sub.f({ id: 1, table })
  t.is(sub.f({ id: 1, table }), first)
  t.is(sub.f({ id: 1, table: { ...table } }), first)
  t.not(sub.f({ id: 2, table }), first)
  // a table that another call saw, and that shrank since, is compared by its contents
  const shrinking = wideObject(300, index => index)
  Substitute.for<any>().log({ shrinking })
  for (let index = 0; index < 100; index++) delete shrinking[`k${index}`]
  const copy = sub.g({ id: 1, shrinking: { ...shrinking } })
  t.is(sub.g({ id: 1, shrinking }), copy)
})

test('E29 the search for nested matchers reads data properties only: no getters, no get traps of proxies', t => {
  // it no longer asks for a property descriptor of every key (which made arrays of records allocate most of their cost)
  let getterRuns = 0
  let trapRuns = 0
  const withGetter = Object.defineProperty({ id: 1 }, 'lazy', { enumerable: true, get() { getterRuns++; return Arg.any() } })
  // (the check whether a value is a matcher reads its brand, a symbol, through the trap: only the keys of the object count)
  const proxy = new Proxy({ id: 2, nested: { value: 1 } }, { get(target, key, receiver) { if (typeof key === 'string') trapRuns++; return Reflect.get(target, key, receiver) } })
  t.false(RecordedArguments.containsMatchers([withGetter]))
  t.false(RecordedArguments.containsMatchers([[withGetter, { list: [withGetter] }]]))
  t.false(RecordedArguments.containsMatchers([{ proxy }]))
  t.is(getterRuns, 0)
  t.is(trapRuns, 0)
  // a matcher in a data property is found, also in a proxy of a plain object, also with a null prototype
  t.true(RecordedArguments.containsMatchers([{ id: 1, name: Arg.any() }]))
  t.true(RecordedArguments.containsMatchers([new Proxy({ id: Arg.any() }, {})]))
  t.true(RecordedArguments.containsMatchers([Object.assign(Object.create(null), { id: Arg.any() })]))
  // a key named like an accessor of Object.prototype is an own data property like any other
  t.true(RecordedArguments.containsMatchers([JSON.parse('{"__proto__": 1, "id": 2}'), { __defineGetter__: Arg.any() }]))
  // an own accessor without a getter reads as undefined, without running anything
  const setterOnly = Object.defineProperty({}, 'sink', { enumerable: true, set() { getterRuns++ } })
  t.false(RecordedArguments.containsMatchers([setterOnly]))
  t.is(getterRuns, 0)
})
