// R8TD-2 / T55 `.resolves()` / `.rejects()` configure a native promise (`resolves(x)` is `returns(Promise.resolve(x))`),
// so they are offered only where such a promise is a valid value: for a `Promise` and for thenables such as
// `PromiseLike<T>` that a native promise satisfies, not for a thenable with members of its own (a query builder), nor,
// since T63 (R9-ADV-3, R9TD-3), for a subtype of `Promise` with members of its own (`CancellablePromise`, see
// R9-ADV-3.R9TD-3.T63.promise-subtypes.ts).
import { Substitute, configure, resolves, rejects } from '../src'

interface User { name: string }
interface Query extends PromiseLike<User[]> { where(x: string): Query }
class CancellablePromise<T> extends Promise<T> { cancel(): void {} }
interface Repo {
  query(): Query
  cancellable(): CancellablePromise<number>
  like(): PromiseLike<number>
  either(): Promise<string> | Query
  maybe(): string | Promise<string>
}
const repo = Substitute.for<Repo>()
repo.query().returns(Substitute.for<Query>())
repo.cancellable().returns(Substitute.for<CancellablePromise<number>>())
repo.like().resolves(1)
repo.like()[resolves](1)
repo.either().resolves('x')
repo.maybe().resolves('x')
repo[configure]().like().resolves(1)

// @ts-expect-error a native promise has no cancel(): not a CancellablePromise (T63)
repo.cancellable().resolves(1)
// @ts-expect-error nor with the symbol form
repo.cancellable()[rejects](new Error('failed'))
// @ts-expect-error a native promise has no where(): not a Query
repo.query().resolves([])
// @ts-expect-error nor with the symbol form
repo.query()[resolves]([])
// @ts-expect-error nor in the configure view
repo[configure]().query().resolves([])
// @ts-expect-error nor rejects()
repo.query().rejects(new Error('failed'))
// @ts-expect-error nor with the symbol form
repo.query()[rejects](new Error('failed'))
// @ts-expect-error the same value through returns() is rejected too
repo.query().returns(Promise.resolve([]))
// @ts-expect-error either() only offers a native promise of a string (its Promise variant)
repo.either().resolves([])
// @ts-expect-error like's promise resolves to a number
repo.like().resolves('1')
