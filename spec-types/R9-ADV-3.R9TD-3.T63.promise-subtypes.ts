// R9-ADV-3 / R9TD-3 / T63 `.resolves()` / `.rejects()` are offered only where a native promise of the value is a
// valid value of the member: not for subtypes of `Promise` with members of their own (ky's `ResponsePromise`, knex's
// `QueryBuilder`, execa's result, a `CancellablePromise`), as the code under test would then call a member that the
// configured promise does not have. Configure those with `.returns()` and a substitute. A subtype without members of
// its own (Prisma's `PrismaPromise<T>`) and one whose own members are optional still offer them.
import { Substitute, configure, rejects, resolves } from '../src'

interface KyResponse { status: number }
interface ResponsePromise extends Promise<KyResponse> { json<T>(): Promise<T>; text(): Promise<string> }
interface Ky { get(url: string): ResponsePromise }
interface Row { id: number }
interface QueryBuilder extends Promise<Row[]> { where(column: string, value: unknown): QueryBuilder }
type ExecaResult = Promise<{ stdout: string }> & { kill(): void }
class CancellablePromise<T> extends Promise<T> { cancel(): void {} }
interface PrismaPromise<T> extends Promise<T> { [Symbol.toStringTag]: 'PrismaPromise' }
interface Lazy<T> extends Promise<T> { cancel?(): void }
interface Api {
  ky: Ky
  users(): QueryBuilder
  run(command: string): ExecaResult
  later(): CancellablePromise<number>
  findMany(): PrismaPromise<Row[]>
  lazy(): Lazy<number>
  load(): Promise<Row>
  current: QueryBuilder
}
const api = Substitute.for<Api>()
const ky = Substitute.for<Ky>()

ky.get('users').returns(Substitute.for<ResponsePromise>())
api.users().returns(Substitute.for<QueryBuilder>())
api.run('ls').returns(Substitute.for<ExecaResult>())
api.later().returns(Substitute.for<CancellablePromise<number>>())
api.findMany().resolves([{ id: 1 }])
api.findMany()[rejects](new Error('failed'))
api.lazy().resolves(1)
api.load().resolves({ id: 1 })
api[configure]().findMany().resolves([])

// @ts-expect-error a native promise has no json(): not a ResponsePromise
ky.get('users').resolves({ status: 200 })
// @ts-expect-error nor with the symbol form
ky.get('users')[resolves]({ status: 200 })
// @ts-expect-error nor rejects()
ky.get('users').rejects(new Error('failed'))
// @ts-expect-error nor in the configure view
ky[configure]().get('users').resolves({ status: 200 })
// @ts-expect-error a native promise has no where(): not a QueryBuilder
api.users().resolves([])
// @ts-expect-error nor for a property
api.current.resolves([])
// @ts-expect-error a native promise has no kill()
api.run('ls').resolves({ stdout: '' })
// @ts-expect-error a native promise has no cancel()
api.later().resolves(1)
// @ts-expect-error nor in the configure view
api[configure]().later()[rejects](new Error('failed'))
// @ts-expect-error a PrismaPromise of rows
api.findMany().resolves('none')
