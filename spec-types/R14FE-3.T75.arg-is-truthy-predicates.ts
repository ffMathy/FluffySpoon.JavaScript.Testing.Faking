// R14FE-3 / T75 An `Arg.is()` predicate may return any value whose truthiness decides the match, as at run time and as
// the README says (`Arg.is(user => user.name)` matches `{ name: 'ann' }`): a string, a number, an object, `undefined`
// (optional chaining) or `null`, not only a boolean. Its parameter is still typed from the parameter the matcher is
// passed to, also on generic methods (T60), and type-guard predicates still fit. An async predicate (one that returns a
// promise or another thenable), which the runtime refuses (E49), does not compile, nor does one typed to return
// `unknown` (which may be a promise).
import { Arg, Substitute, configure, didNotReceive, received } from '../src'

interface User { name?: string; roles: string[]; address?: { city: string } | null; id: number }
interface Repository {
  save(user: User): string
  find(id: number): User
  fail(error: unknown): void
  get<T>(key: string): T
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>
}
interface HttpError { isHttpError: true; status: number }
declare function isHttpError(error: unknown): error is HttpError

const repository = Substitute.for<Repository>()

// a truthy string, number or object, `undefined` from optional chaining, `null`
repository.save(Arg.is(user => user.name)).returns('named')
repository.save(Arg.is(user => user.roles.length)).returns('with roles')
repository.save(Arg.is(user => user.address)).returns('with address')
repository.save(Arg.is(user => user.address?.city)).returns('with city')
repository.save(Arg.is(user => user.roles.find(role => role === 'admin'))).returns('admin')
repository.save(Arg.is(user => user.name?.startsWith('a'))).returns('a')
repository.save(Arg.is(user => user.name && user.name.length)).returns('long')
repository.save(Arg.is(user => typeof user.name === 'string' && user.name.startsWith('a'))).returns('narrowed')
repository.save(Arg.is.not(user => user.name)).returns('anonymous')
repository.find(Arg.is(id => id % 2)).returns({ id: 1, roles: [] })
// checks and the configure view
repository.received(1).save(Arg.is(user => user.name?.startsWith('a')))
repository.didNotReceive().save(Arg.is(user => user.address))
repository[received](1).save(Arg.is(user => user.roles.length))
repository[didNotReceive]().save(Arg.is.not(user => user.name))
repository[configure]().save(Arg.is(user => user.name)).returns('configured')
// generic methods (T60): the parameter is still typed
repository.get(Arg.is(key => key.length)).returns(1)
repository.query(Arg.is(sql => sql.match(/^SELECT/))).resolves([])
repository.received(1).query(Arg.is(sql => sql.length), Arg.is(params => params?.length))
// standalone matchers with an annotated parameter
const named = Arg.is((user: User) => user.name)
const anonymous = Arg.is.not((user: User) => user.name)
repository.save(named).returns('named')
repository.save(anonymous).returns('anonymous')
// type guards
repository.received(1).fail(Arg.is((error): error is HttpError => isHttpError(error)))
repository.received(1).fail(Arg.is(isHttpError))
repository.received(1).save(Arg.is(user => user.name !== undefined))

// @ts-expect-error an async predicate
repository.save(Arg.is(async user => user.name === 'ann')).returns('x')
// @ts-expect-error a predicate that returns a promise
repository.save(Arg.is(user => Promise.resolve(user.name === 'ann'))).returns('x')
// @ts-expect-error in checks too
repository.received(1).save(Arg.is(async user => true))
// @ts-expect-error a thenable
repository.received(1).save(Arg.is(user => ({ then(resolve: (matches: boolean) => void) { resolve(true) } })))
// @ts-expect-error a PromiseLike
repository.received(1).save(Arg.is((user): PromiseLike<boolean> => Promise.resolve(true)))
// @ts-expect-error a promise in some cases
repository.received(1).save(Arg.is((user): boolean | Promise<boolean> => true))
// @ts-expect-error `unknown` may be a promise
repository.received(1).save(Arg.is((user: unknown): unknown => user))
// @ts-expect-error an async `.not` predicate
repository.save(Arg.is.not(async user => user.name === 'ann')).returns('x')
// @ts-expect-error in the configure view
repository[configure]().save(Arg.is(async user => true)).returns('x')
// @ts-expect-error on a generic method
repository.query(Arg.is(async sql => sql.length > 0)).resolves([])
// @ts-expect-error a standalone async predicate
const asyncMatcher = Arg.is(async (user: User) => true)
// @ts-expect-error a standalone async `.not` predicate
const asyncNotMatcher = Arg.is.not(async (user: User) => true)
// @ts-expect-error the parameter is still typed: a string predicate for a User parameter
repository.received(1).save(Arg.is((user: string) => user.length))
// @ts-expect-error the parameter is still typed: no such member
repository.save(Arg.is(user => user.nickname)).returns('x')
// @ts-expect-error the setup value is still checked
repository.save(Arg.is(user => user.name)).returns(1)
