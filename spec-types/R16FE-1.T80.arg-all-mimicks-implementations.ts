// R16FE-1 / T80 After a single `Arg.all()` on an overloaded member whose overloads return different types (T76),
// `.mimicks()` takes every implementation that TypeScript accepts for the member itself, apart from the return type
// (which may be what any overload returns, as in T76): it may leave out trailing parameters (`(entity: any) =>
// ...`, `entity => ...`, `async path => ...`), as a function assigned to the member may, but not have a parameter
// that some overload does not pass, nor one that does not take what an overload passes. Untyped parameters take the
// types of all overloads at their position (`Row[] | Row`), also on TypeScript 3.6 (see spec-types/min-ts). In 2.0.1
// before T80 the implementation had to take every parameter of every overload: `(e: any) => ...` did not compile for
// `remove(entities: Row[], options?)` and `remove(entity: Row, options?)`. The same holds in the configure view, for
// the symbol form `[mimicks]` and for further implementations of a sequence.
import { Arg, Substitute, configure, mimicks } from '../src'

interface Row { id: number }
interface RemoveOptions { chunk?: number }
interface Repo {
  remove(entities: Row[], options?: RemoveOptions): Promise<Row[]>
  remove(entity: Row, options?: RemoveOptions): Promise<Row>
}
const repo = Substitute.for<Repo>()
const row: Row = { id: 1 }

repo.remove(Arg.all()).mimicks((entity: any) => Promise.resolve(entity))
repo.remove(Arg.all()).mimicks(entity => Promise.resolve(entity as any))
repo.remove(Arg.all()).mimicks(async entity => Array.isArray(entity) ? entity[0] : entity)
repo.remove(Arg.all()).mimicks(entity => {
  const rows: Row[] | Row = entity
  return Promise.resolve(rows as any)
})
repo.remove(Arg.all()).mimicks((entity, options) => {
  const chunk: number | undefined = options && options.chunk
  return Promise.resolve(row)
})
repo.remove(Arg.all()).mimicks((entity: any, options?: RemoveOptions) => Promise.resolve(entity))
repo.remove(Arg.all()).mimicks((entity: any, options: any) => Promise.resolve(entity))
repo.remove(Arg.all()).mimicks(() => Promise.resolve([row]))
repo.remove(Arg.all()).mimicks(async (...args: any[]) => row)
repo.remove(Arg.all())[mimicks]((entity: any) => Promise.resolve(entity))
repo[configure]().remove(Arg.all()).mimicks(entity => Promise.resolve(entity as any))
repo.remove(Arg.all()).mimicks(async () => [row], async () => row, async entity => entity as any)
// an implementation of the overloads themselves
declare const realRepo: Repo
repo.remove(Arg.all()).mimicks(realRepo.remove)
// plain TypeScript accepts the same parameter lists for the member:
const plainRemove: Repo['remove'] = (entity: any) => Promise.resolve(entity)

// @ts-expect-error the first overload passes a Row[]
repo.remove(Arg.all()).mimicks((entity: Row) => Promise.resolve(entity))
// @ts-expect-error no overload passes a third argument
repo.remove(Arg.all()).mimicks((entity: any, options: any, extra: any) => Promise.resolve(entity))
// @ts-expect-error no overload returns a number
repo.remove(Arg.all()).mimicks((entity: any) => 42)
// @ts-expect-error in the configure view too
repo[configure]().remove(Arg.all()).mimicks((entity: Row) => Promise.resolve(entity))
// @ts-expect-error and in further implementations
repo.remove(Arg.all()).mimicks(async () => row, (entity: Row) => Promise.resolve(entity))
// @ts-expect-error the symbol form too
repo.remove(Arg.all())[mimicks]((entity: Row) => Promise.resolve(entity))
// @ts-expect-error not a function
repo.remove(Arg.all()).mimicks(row)

// T76's case: an implementation must take the calls without a key, as a function assigned to the member must
interface Store { get(): string[]; get(key: string): string }
const store = Substitute.for<Store>()
store.get(Arg.all()).mimicks(() => ['a'])
store.get(Arg.all()).mimicks((key?: string) => key === undefined ? ['a'] : key)
// @ts-expect-error get() passes no key
store.get(Arg.all()).mimicks((key: string) => key)
// @ts-expect-error get() passes no key: a required parameter of any type does not fit either
store.get(Arg.all()).mimicks((key: any) => key)
// @ts-expect-error neither does an untyped one (it is required)
store.get(Arg.all()).mimicks(key => 'a')
// @ts-expect-error in the configure view too
store[configure]().get(Arg.all()).mimicks((key: string) => key)
// @ts-expect-error neither overload returns a number
store.get(Arg.all()).mimicks(() => 1)

// node-postgres-style query(text, values?) and query(text, callback)
interface QueryResult { rows: unknown[] }
interface Client {
  query(text: string, values?: unknown[]): Promise<QueryResult>
  query(text: string, callback: (err: Error | undefined, result: QueryResult) => void): void
}
const client = Substitute.for<Client>()
const result: QueryResult = { rows: [] }
client.query(Arg.all()).mimicks((text: string) => Promise.resolve(result))
client.query(Arg.all()).mimicks(text => Promise.resolve({ rows: [text.length] }))
client.query(Arg.all()).mimicks(async () => result)
// @ts-expect-error the text is a string
client.query(Arg.all()).mimicks((text: number) => Promise.resolve(result))
// @ts-expect-error the callback overload passes a function, not values
client.query(Arg.all()).mimicks((text: string, values?: unknown[]) => Promise.resolve(result))

// fs/promises-style readFile: three overloads with different promises
interface Abortable { signal?: unknown }
interface Files {
  readFile(path: string, options?: ({ encoding?: null } & Abortable) | null): Promise<Uint8Array>
  readFile(path: string, options: ({ encoding: 'utf8' | 'ascii' } & Abortable) | 'utf8' | 'ascii'): Promise<string>
  readFile(path: string, options?: ({ encoding?: string | null } & Abortable) | string | null): Promise<string | Uint8Array>
}
const files = Substitute.for<Files>()
files.readFile(Arg.all()).mimicks(async path => 'contents of ' + path)
files.readFile(Arg.all()).mimicks(async (path: string) => new Uint8Array(0))
// @ts-expect-error no overload resolves to a number
files.readFile(Arg.all()).mimicks(async path => 42)

// TypeORM-style generic overloads, whose type parameters are replaced by their constraints
type DeepPartial<T> = { [P in keyof T]?: T[P] }
interface SaveOptions { reload?: boolean }
interface User { id: number; email: string }
interface Users {
  save<T extends DeepPartial<User>>(entities: T[], options: SaveOptions & { reload: false }): Promise<T[]>
  save<T extends DeepPartial<User>>(entities: T[], options?: SaveOptions): Promise<(T & User)[]>
  save<T extends DeepPartial<User>>(entity: T, options: SaveOptions & { reload: false }): Promise<T>
  save<T extends DeepPartial<User>>(entity: T, options?: SaveOptions): Promise<T & User>
}
const users = Substitute.for<Users>()
users.save(Arg.all()).mimicks((entity: any) => Promise.resolve(entity))
users.save(Arg.all()).mimicks(entity => Promise.resolve(entity as any))
users.save(Arg.all()).mimicks((entity: any, options?: SaveOptions) => Promise.resolve(entity))
// @ts-expect-error no overload passes a third argument
users.save(Arg.all()).mimicks((entity: any, options: any, extra: any) => Promise.resolve(entity))
// @ts-expect-error no overload resolves to a number
users.save(Arg.all()).mimicks(() => Promise.resolve(42))
