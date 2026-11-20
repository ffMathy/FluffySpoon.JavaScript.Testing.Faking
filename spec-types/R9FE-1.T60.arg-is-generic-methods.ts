// R9FE-1 / T60 Generic methods: an `Arg.is` predicate without a parameter type takes the type of the parameter it is
// passed to, as for other methods (`sql` is a `string` below), in setups, checks and the configure view. That includes
// methods whose type parameters appear only in the return type (`query<T>(sql: string): Promise<T[]>`, typed caches).
// Predicates that do not fit the parameter are still rejected.
import { Arg, Substitute, configure, received } from '../src'

interface SqlClient { query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]> }
const db = Substitute.for<SqlClient>()
db.query(Arg.is(sql => sql.startsWith('SELECT'))).resolves([])
db.query(Arg.is(sql => sql.length > 0), [1]).resolves([])
db.query('SELECT 1', Arg.is(params => params !== undefined && params.length === 1)).resolves([])
db.query(Arg.is.not(sql => sql.startsWith('DELETE'))).resolves([])
db.received().query(Arg.is(sql => sql.startsWith('SELECT')))
db[received](1).query(Arg.is(sql => sql.startsWith('SELECT')))
db.didNotReceive().query(Arg.is(sql => sql.startsWith('DELETE')), Arg.is(params => params !== undefined))
db[configure]().query(Arg.is(sql => sql.startsWith('SELECT'))).resolves([])
db[configure]().query('SELECT 1', Arg.is(params => params !== undefined)).resolves([])
db.query(Arg.is((sql: string) => sql.length > 0)).resolves([])
db.query('SELECT 1').resolves([1, 2])
// @ts-expect-error a number predicate for a string parameter
db.query(Arg.is((n: number) => n > 0)).resolves([])
// @ts-expect-error in checks too
db.received().query(Arg.is((n: number) => n > 0))
// @ts-expect-error and in the configure view
db[configure]().query(Arg.is((n: number) => n > 0)).resolves([])
// @ts-expect-error `sql` is a string
db.query(Arg.is(sql => sql > 0)).resolves([])
// @ts-expect-error not a string
db.query(42).resolves([])
// @ts-expect-error not an array
db.query('SELECT 1', 'x').resolves([])
// @ts-expect-error too many arguments
db.query('SELECT 1', [1], 2)
// @ts-expect-error too few arguments
db.query()

interface KeyValue { get<T>(key: string): T }
const kv = Substitute.for<KeyValue>()
kv.get(Arg.is(key => key.startsWith('user:'))).returns(1)
kv.received().get(Arg.is(key => key.startsWith('user:')))
kv[configure]().get(Arg.is(key => key.startsWith('user:'))).returns(1)
// @ts-expect-error a boolean predicate for a string parameter
kv.get(Arg.is((key: boolean) => key))
// @ts-expect-error too many arguments
kv.get('k', 1)

// A property whose type is a generic function.
interface Cache { get: <T>(key: string) => Promise<T | undefined> }
const cache = Substitute.for<Cache>()
cache.get(Arg.is(key => key.startsWith('user:'))).resolves(undefined)
cache.received(1).get(Arg.is(key => key.length > 0))
cache[configure]().get(Arg.is(key => key.length > 0)).resolves(undefined)
// @ts-expect-error a number predicate for a string parameter
cache.get(Arg.is((n: number) => n > 0)).resolves(undefined)

// Type parameters with constraints: the predicate takes the constraint.
interface Config { port: number; host: string }
interface Settings { get<K extends keyof Config>(key: K): Config[K]; same<T extends string | number>(a: T, b: T): T }
const settings = Substitute.for<Settings>()
settings.get(Arg.is(key => key === 'port')).returns(80)
settings.received().get(Arg.is(key => key.length > 0))
settings.same(Arg.is(x => x === 1), 2).returns(3)
settings.get('port').returns(80)
// @ts-expect-error `key` is `keyof Config`, which has no 'timeout'
settings.get(Arg.is(key => key === 'timeout'))
// @ts-expect-error no member of Config is a symbol (the result is not `any`)
settings.get(Arg.is(key => key === 'port')).returns(Symbol('80'))
// @ts-expect-error with an annotated predicate either
settings.get(Arg.is((key: keyof Config) => key === 'port')).returns(Symbol('80'))
// @ts-expect-error nor with a predicate for one key
settings.get(Arg.is((key: 'port') => true)).returns(Symbol('80'))
// @ts-expect-error what `same` returns for these arguments is a string or a number (T54)
settings.same(1, 'x').returns({})
