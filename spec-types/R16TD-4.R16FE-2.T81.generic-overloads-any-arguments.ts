// R16TD-4 / R16FE-2 / T81 (documented limitation) A call with an argument of type `any` (`Arg.any()`,
// `Arg.any('object')`) of a member with more than one overload, one of which is generic with a constrained type
// parameter that takes the argument (TypeORM's `Repository.save` / `remove`), resolves to the member's own overload:
// TypeScript first tries the signatures with the subtype relation, under which `any` fits a type parameter but none of
// the substitute's signatures (they take the type parameters' constraints). Its result has the type parameter as
// `any` and no setup API (`Promise<any>`; for a return type that is the type parameter itself, `any`, which takes
// every value unchecked). A signature that takes such calls first would cost every overloaded member of every
// substitute type-check time (see spec-types/R6V-5.R6TD-2.T44.check-cost.js), so the forms below are the way:
// `Arg.all()`, which takes what any overload returns (T76), a typed predicate or a matcher cast to the parameter type,
// which take the overload that parameter type fits. The configure view takes the first overload that accepts the
// arguments. Checks are not affected. A member with a single generic signature, or with generic overloads whose type
// parameters have no constraint, is not affected either.
import { Arg, Substitute, configure, didNotReceive, received } from '../src'

interface User { id: number; name: string }
const user: User = { id: 1, name: 'a' }
type DeepPartial<T> = { [P in keyof T]?: T[P] }
interface Repository {
  save<T extends DeepPartial<User>>(entities: T[]): Promise<(T & User)[]>
  save<T extends DeepPartial<User>>(entity: T): Promise<T & User>
}
const repo = Substitute.for<Repository>()

// @ts-expect-error the limitation: the call resolves to the member's own overload, `Promise<any>`
repo.save(Arg.any()).resolves(user)
// @ts-expect-error the limitation
repo.save(Arg.any()).resolves([user])
// @ts-expect-error the limitation
repo.save(Arg.any('object')).returns(Promise.resolve(user))

// the forms that have the setup API
repo.save(Arg.all()).resolves(user)
repo.save(Arg.all()).resolves([user])
repo.save(Arg.is((saved: User) => saved.id === 1)).resolves(user)
repo.save(Arg.is((saved: User[]) => saved.length > 0)).resolves([user])
repo.save(Arg.any() as User).resolves(user)
repo.save(Arg.any() as User[]).resolves([user])
repo[configure]().save(Arg.any()).resolves([user])
repo[configure]().save(Arg.any() as User).resolves(user)
// @ts-expect-error the configure view takes the first overload that accepts the arguments
repo[configure]().save(Arg.any()).resolves(user)
// checks
repo.received(1).save(Arg.any())
repo[received](1).save(Arg.any())
repo.didNotReceive().save(Arg.any('object'))
repo[didNotReceive]().save(Arg.any())
// @ts-expect-error a value that no overload returns
repo.save(Arg.all()).resolves('x')
// @ts-expect-error a value that the overload for one entity does not return
repo.save(Arg.any() as User).resolves([user])

// not affected: a single generic signature, and generic overloads without constraints
interface One { save<T extends DeepPartial<User>>(entity: T): Promise<T & User> }
Substitute.for<One>().save(Arg.any()).resolves(user)
interface Unconstrained { find<T>(id: T): Promise<T>; find(id: number, all: boolean): Promise<number[]> }
Substitute.for<Unconstrained>().find(Arg.any()).resolves(1)
