// R14TD-2 / T77 Declaration emit of check views of types with symbol-keyed members (`[Symbol.iterator]`,
// `[Symbol.asyncIterator]`, `[Symbol.toStringTag]`, `[Symbol.asyncDispose]`, Node's
// `[EventEmitter.captureRejectionSymbol]`): iterables, `Map`, Node's `EventEmitter` and streams, and everything built on
// them. TypeScript 4.8 and newer failed with TS4118 ("The type of this node cannot be serialized because its property
// '[iterator]' cannot be serialized"), because the check view mapped the symbol keys without a link to their
// declarations. Compiled with `declaration: true` and `emitDeclarationOnly` by this directory's tsconfig
// (`npm run test:types`).
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { Substitute, SubstituteOf, didNotReceive, received } from '../../src'

export interface Bag { add(x: number): void; size: number; [Symbol.iterator](): Iterator<number> }
const bag = Substitute.for<Bag>()
export const bagView = bag.received()
export const bagNegativeView = bag.didNotReceive()
export const bagSymbolView = bag[received](1)
export const bagNegativeSymbolView = bag[didNotReceive]()
export const bagAddView = bag.received().add
export function bagHelper(b: SubstituteOf<Bag>) { return b.received() }
export class BagFixture {
  bag = Substitute.for<Bag>()
  view = this.bag.received()
}

export interface Feed { next(): Promise<string>; [Symbol.asyncIterator](): AsyncIterator<string> }
export const feedView = Substitute.for<Feed>().received(2)

export interface Tagged { readonly [Symbol.toStringTag]: string; name: string; close?(): void }
export const taggedView = Substitute.for<Tagged>().didNotReceive()

export const mapView = Substitute.for<Map<string, number>>().received()
export const setView = Substitute.for<Set<string>>()[received](1)

export const emitterView = Substitute.for<EventEmitter>().received()
export const readableView = Substitute.for<Readable>().didNotReceive()
export function emitterHelper(emitter: SubstituteOf<EventEmitter>) { return emitter.received() }

// The members of these views are checked as before.
const bagCheck = Substitute.for<Bag>()
bagCheck.received(1).add(1)
bagCheck.received()[Symbol.iterator]()
bagCheck.received().size = 2
// @ts-expect-error not a number
bagCheck.received().add('x')
// @ts-expect-error not a number
bagCheck.received().size = 'x'
const tagged = Substitute.for<Tagged>()
tagged.received().close()
tagged.didNotReceive().name = 'x'
const emitter = Substitute.for<EventEmitter>()
emitter.received(1).emit('saved', 1)
emitter.received()[EventEmitter.captureRejectionSymbol](new Error('x'), 'saved')
