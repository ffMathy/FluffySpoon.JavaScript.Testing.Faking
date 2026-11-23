// R9FE-2 / T61 Documented limitation, pinned: overloaded generic methods whose parameter types depend on a type parameter
// through a conditional type, such as @types/pg's `Pool.query` / `ClientBase.query` (the shape below is theirs).
// For the setup API TypeScript sees each overload with its type parameters replaced by their constraints, so `values?:
// QueryConfigValues<I>` becomes `values?: never` (`QueryConfigValues<unknown>`), and a setup that passes values resolves
// to the method's own declaration, which has no setup API. Accepting the values anyway would accept any values: a
// conditional type relates an overloaded method to a call signature with `any` for its type parameters, so a check of
// the values against the method's own overloads cannot reject wrong ones. Checks compile (they keep the method's own
// declarations). Workarounds: pass the values `as never` (the call is the same at run time, so the setup matches the
// call made by the code under test), or match them with `Arg.all()`.
import { Arg, Substitute, configure, received } from '../src'

type QueryConfigValues<T> = T extends Array<infer U> ? T : never
interface QueryConfig<I = any[]> { text: string; values?: QueryConfigValues<I> }
interface QueryArrayConfig<I = any[]> extends QueryConfig<I> { rowMode: 'array' }
interface QueryResultRow { [column: string]: any }
interface QueryResult<R> { rows: R[]; rowCount: number | null }
interface QueryArrayResult<R> { rows: R[]; rowCount: number | null; fields: string[] }
interface Submittable { submit(): void }
interface Pool {
  query<T extends Submittable>(queryStream: T): T
  query<R extends any[] = any[], I = any[]>(queryConfig: QueryArrayConfig<I>, values?: QueryConfigValues<I>): Promise<QueryArrayResult<R>>
  query<R extends QueryResultRow = any, I = any[]>(queryConfig: QueryConfig<I>): Promise<QueryResult<R>>
  query<R extends QueryResultRow = any, I = any[]>(queryTextOrConfig: string | QueryConfig<I>, values?: QueryConfigValues<I>): Promise<QueryResult<R>>
  query<R extends any[] = any[], I = any[]>(queryConfig: QueryArrayConfig<I>, callback: (err: Error, result: QueryArrayResult<R>) => void): void
  query<R extends QueryResultRow = any, I = any[]>(queryTextOrConfig: string | QueryConfig<I>, callback: (err: Error, result: QueryResult<R>) => void): void
  query<R extends QueryResultRow = any, I = any[]>(queryText: string, values: QueryConfigValues<I>, callback: (err: Error, result: QueryResult<R>) => void): void
}
const ok = { rows: [{ id: 1 }], rowCount: 1 }
const pool = Substitute.for<Pool>()

// The workarounds.
pool.query('SELECT * FROM users WHERE id = $1', [1] as never).resolves(ok)
pool[configure]().query('SELECT * FROM users WHERE id = $1', [1] as never).resolves(ok)
pool.query({ text: 'SELECT 1', values: [1] as never }).resolves(ok)
pool.query('SELECT * FROM users WHERE id = $1', Arg.all()).resolves(ok)
pool[configure]().query('SELECT * FROM users WHERE id = $1', Arg.all()).resolves(ok)
// Calls without values have the setup API.
pool.query('SELECT 1').resolves(ok)
pool.query({ text: 'SELECT 1' }).resolves(ok)
pool[configure]().query('SELECT 1').resolves(ok)
// Checks compile.
pool.received(1).query('SELECT * FROM users WHERE id = $1', [1])
pool[received](1).query({ text: 'SELECT 1', values: [1] })
pool.didNotReceive().query('SELECT * FROM users WHERE id = $1', [2])
// @ts-expect-error the limitation: a setup that passes values has no setup API
pool.query('SELECT * FROM users WHERE id = $1', [1]).resolves(ok)
// @ts-expect-error nor in the configure view
pool[configure]().query('SELECT * FROM users WHERE id = $1', [1]).resolves(ok)
// @ts-expect-error nor with values in a config object
pool.query({ text: 'SELECT 1', values: [1] }).resolves(ok)
// @ts-expect-error nor with Arg.any() for the values
pool.query('SELECT 1', Arg.any()).resolves(ok)
// @ts-expect-error checks still reject values that are not an array
pool.received(1).query('SELECT 1', 'x')
// @ts-expect-error the setup API still takes a query result
pool.query('SELECT 1', [1] as never).resolves('nope')
