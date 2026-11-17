// R8TD-5 / T59 Limitation: in generic code constrained by a type with a promise-typed PROPERTY, that property has no
// `.resolves()` / `.rejects()` (string or symbol form, also not in the configure view), while promise-returning
// METHODS do: TypeScript resolves the setup API of a call through the constraint, but cannot decide whether the
// property type of a type parameter is a promise. `.returns(Promise.resolve(value))` works on every version.
import { SubstituteOf, configure, resolves, returns } from '../src'

interface Repo { name: Promise<string>; load(): Promise<number>; total: number }

export function stub<T extends Repo>(repo: SubstituteOf<T>) {
  repo.load().resolves(1)
  repo.load().rejects(new Error('failed'))
  repo.total.returns(1)
  // the way around it
  repo.name.returns(Promise.resolve('x'))
  repo.name[returns](Promise.reject(new Error('failed')))
  repo[configure]().name.returns(Promise.resolve('x'))
  // @ts-expect-error limitation: no resolves() on a promise-typed property of the constraint
  repo.name.resolves('x')
  // @ts-expect-error limitation, also in the symbol form
  repo.name[resolves]('x')
  // @ts-expect-error limitation, also in the configure view
  repo[configure]().name.resolves('x')
  // @ts-expect-error the promise still resolves to a string
  repo.name.returns(Promise.resolve(1))
}

// Concrete types are not affected
declare const concrete: SubstituteOf<Repo>
concrete.name.resolves('x')
concrete[configure]().name.resolves('x')
