// R14FE-2 / T76 A setup whose only argument is `Arg.all()` matches every call of the member, whichever overload it
// calls. On an overloaded member whose overloads return different types, it takes the value of any overload: its
// `.returns()` takes what any overload returns, `.resolves()` what any of its promises resolve to, and `.mimicks()` an
// implementation that accepts the parameters of every overload and returns what any overload returns. Before, it took
// the overload TypeScript picked (the first that `Arg.all()` fits), such as the `Submittable` overload of @types/pg's
// `Pool.query`, so `pool.query(Arg.all()).resolves(result)` did not compile. A value that no overload returns is still
// rejected. Overloads that all return the same type keep the parameter types of the first overload for `.mimicks()`.
// The pg-like `Pool` below declares `query` as @types/pg 8 does.
import { Arg, Substitute, configure, received } from '../src'

interface Submittable { submit: (connection: unknown) => void }
interface QueryConfig<I = any[]> { text: string; values?: I }
interface QueryArrayConfig<I = any[]> extends QueryConfig<I> { rowMode: 'array' }
interface QueryResult<R = any> { rows: R[]; rowCount: number | null; command: string }
interface QueryArrayResult<R extends any[] = any[]> { rows: R[]; rowCount: number | null; command: string }
interface Pool {
  query<T extends Submittable>(queryStream: T): T
  query<R extends any[] = any[], I = any[]>(queryConfig: QueryArrayConfig<I>, values?: I): Promise<QueryArrayResult<R>>
  query<R = any, I = any[]>(queryConfig: QueryConfig<I>): Promise<QueryResult<R>>
  query<R = any, I = any[]>(queryTextOrConfig: string | QueryConfig<I>, values?: I): Promise<QueryResult<R>>
  query<R extends any[] = any[], I = any[]>(queryConfig: QueryArrayConfig<I>, callback: (err: Error, result: QueryArrayResult<R>) => void): void
  query<R = any, I = any[]>(queryTextOrConfig: string | QueryConfig<I>, callback: (err: Error, result: QueryResult<R>) => void): void
  query<R = any, I = any[]>(queryText: string, values: I, callback: (err: Error, result: QueryResult<R>) => void): void
  connect(): Promise<Pool>
  connect(callback: (err: Error | undefined, client: Pool | undefined) => void): void
  end(): Promise<void>
}
const pool = Substitute.for<Pool>()
const result: QueryResult = { rows: [], rowCount: 0, command: 'SELECT' }

// every query
pool.query(Arg.all()).resolves(result)
pool.query(Arg.all()).returns(Promise.resolve(result))
pool.query(Arg.all()).mimicks(async () => result)
pool.query(Arg.all()).mimicks((...args: any[]) => Promise.resolve(result))
pool.query(Arg.all()).mimicks(async (...args) => result)
pool[configure]().query(Arg.all()).resolves(result)
pool[configure]().query(Arg.all()).rejects(new Error('connection lost'))
pool.connect(Arg.all()).resolves(pool)
pool.end(Arg.all()).resolves()
// the forms that compiled before
pool.query(Arg.any('string'), Arg.all()).resolves(result)
pool.query(Arg.any('string')).resolves(result)
pool.query(Arg.any()).resolves(result)
pool.query('SELECT 1').resolves(result)
// checks
pool.received(1).query(Arg.all())
pool[received](1).query(Arg.all())
pool.didNotReceive().query(Arg.all())

// @ts-expect-error a value that no overload returns
pool.query(Arg.all()).resolves(42)
// @ts-expect-error a value that no overload returns
pool.query(Arg.all()).returns('x')
// @ts-expect-error an implementation that returns what no overload returns
pool.query(Arg.all()).mimicks(async () => 42)
// @ts-expect-error an implementation whose parameters do not take every overload's arguments
pool.query(Arg.all()).mimicks((text: string) => Promise.resolve(result))
// @ts-expect-error in the configure view too
pool[configure]().query(Arg.all()).resolves(42)
// @ts-expect-error a value that no overload of connect returns
pool.connect(Arg.all()).resolves(42)
// @ts-expect-error after a leading argument, the overloads that take it decide, as before
pool.query(Arg.any('string'), Arg.all()).resolves(42)

// Overloads that return the same type: unchanged.
interface Field { value(newValue: string): void; value(newValue: string, silent: boolean): void }
const field = Substitute.for<Field>()
field.value(Arg.all()).mimicks(newValue => { const length: number = newValue.length })
// @ts-expect-error the implementation takes the first overload's parameters
field.value(Arg.all()).mimicks((newValue: number) => {})

// Overloads that return different types: any of them.
interface Store { get(): string[]; get(key: string): string }
const store = Substitute.for<Store>()
store.get(Arg.all()).returns(['a'])
store.get(Arg.all()).returns('a')
store.get(Arg.all()).mimicks((key?: string) => key === undefined ? ['a'] : key)
// @ts-expect-error the implementation must also take the calls without a key
store.get(Arg.all()).mimicks((key: string) => key)
// @ts-expect-error neither overload returns a number
store.get(Arg.all()).returns(1)
// @ts-expect-error a direct call still takes its own overload's value
store.get('k').returns(['a'])
