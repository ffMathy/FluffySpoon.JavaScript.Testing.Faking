// TD-5 / T28 `Arg.any('function')` is assignable to typed function (and constructor) parameters, `Arg.any('object')` to
// typed object parameters.
import { Substitute, Arg, configure } from '../src'

class Widget { name = 'w' }
interface Bus {
  subscribe(handler: (value: number) => void): () => void
  once(event: string, handler?: (value: string) => boolean): void
  save(item: { id: string }): void
  saveAll(items: { id: string }[], options: Partial<{ force: boolean }>): number
  register(type: new () => Widget): void
  send(payload: object, callback: Function): void
}

const bus = Substitute.for<Bus>()
bus.subscribe(Arg.any('function')).returns(() => { })
bus.received().subscribe(Arg.any('function'))
bus.once('saved', Arg.any('function'))
bus.received().save(Arg.any('object'))
bus.saveAll(Arg.any('array'), Arg.any('object')).returns(1)
bus.register(Arg.any('function'))
bus.send(Arg.any('object'), Arg.any('function'))
bus[configure]().subscribe(Arg.any.not('function')).returns(() => { })

interface Calculator { add(a: number, b: number): number }
const calculator = Substitute.for<Calculator>()
// @ts-expect-error a function matcher does not fit a number parameter
calculator.add(Arg.any('function'), 1)
