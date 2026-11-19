// Pins for three documented typing limitations and their casts (docs only, no typing change):
// - R13TD-2: in an object literal given to `[mimick]()`, `this` is the partial type, so a fluent method that returns
//   `this` casts it, returns the substitute, or a real instance is passed (T72 takes `Partial<T>`; `Partial<T> &
//   ThisType<T>` would defeat the weak-type check and is not an option).
// - R13TD-5: matchers of test runners typed as object types (`@types/sinon`'s `SinonMatcher`, an interface, and
//   `@jest/globals`' `AsymmetricMatcher`, a type literal; replicated here by their shapes) only fit parameters typed
//   `unknown`, `any`, `object`, `{}` (and `Object`, `Record<string, any>`, unions with one of them); other parameters
//   need `as never`.
// - R13FE-4: an unconstrained type parameter of a generic method or of a generic class's constructor is erased to
//   `unknown`, so a substitute of `Worker<{ userId: string }>` does not fit `Worker<unknown>` when the parameter is
//   used contravariantly (a function-typed property): cast through `unknown`.
import { Arg, Substitute, configure, mimick } from '../src'

// R13TD-2
interface Reply { status(code: number): this; json(body: unknown): this }
const reply = Substitute.for<Reply>()
// @ts-expect-error `this` is a Partial<Reply>, which is not a Reply
reply[mimick]({ status() { return this } })
reply[mimick]({ status() { return this as Reply }, json() { return this as Reply } })
reply[mimick]({ status: () => reply, json: () => reply })
declare const realReply: Reply
reply[mimick](realReply)
// @ts-expect-error the member types are still checked
reply[mimick]({ status: () => 404 })
// @ts-expect-error and so are excess properties
reply[mimick]({ status() { return this as Reply }, sendStatus() { return this as Reply } })
interface QueryBuilder { where(column: string, value: unknown): this; orderBy(column: string): this; exec(): Promise<number[]> }
const query = Substitute.for<QueryBuilder>()
// @ts-expect-error `this` is a Partial<QueryBuilder>
query[mimick]({ where() { return this }, exec: async () => [1] })
query[mimick]({ where() { return this as QueryBuilder }, exec: async () => [1] })
query[mimick]({ where: () => query, orderBy: () => query, exec: async () => [1] })

// R13TD-5
interface SinonMatcherShape { and(expr: SinonMatcherShape): SinonMatcherShape; or(expr: SinonMatcherShape): SinonMatcherShape; test(value: any): boolean }
type AsymmetricMatcherShape = { asymmetricMatch(other: unknown): boolean; toString(): string; getExpectedType?(): string; toAsymmetricMatcher?(): string }
declare const sinonMatcher: SinonMatcherShape
declare const jestMatcher: AsymmetricMatcherShape
interface Options { err?: string; retries?: number }
interface Api {
  unknownValue(value: unknown): void
  anyValue(value: any): void
  objectValue(value: object): void
  emptyValue(value: {}): void
  optionalObject(value?: object): void
  options(value: Options): void
  error(value: Error): void
  text(value: string): void
}
const api = Substitute.for<Api>()
api.unknownValue(sinonMatcher)
api.anyValue(sinonMatcher)
api.objectValue(sinonMatcher)
api.emptyValue(sinonMatcher)
api.optionalObject(sinonMatcher)
api.received().objectValue(sinonMatcher)
api.unknownValue(jestMatcher)
api.objectValue(jestMatcher)
api.emptyValue(jestMatcher)
api.received().optionalObject(jestMatcher)
// @ts-expect-error an options object of a declared type does not take a SinonMatcher
api.options(sinonMatcher)
// @ts-expect-error neither in a check
api.received().options(sinonMatcher)
// @ts-expect-error nor does an Error parameter
api.error(sinonMatcher)
// @ts-expect-error nor a string parameter
api.text(sinonMatcher)
// @ts-expect-error the same for an AsymmetricMatcher
api.options(jestMatcher)
// @ts-expect-error and a string parameter
api.text(jestMatcher)
api.options(sinonMatcher as never)
api.received().options(sinonMatcher as never)
api.text(jestMatcher as never)
api.error(jestMatcher as never)

// R13FE-4
interface Job<D> { data: D }
interface Worker<D> { processFn: (job: Job<D>) => Promise<void>; close(): Promise<void> }
interface WorkerFactory { create<D>(name: string, processor: (job: Job<D>) => Promise<void>): Worker<D> }
class DigestWorker<D> {
  constructor(public name: string, public processFn: (job: Job<D>) => Promise<void>) { }
  close() { return Promise.resolve() }
}
const factory = Substitute.for<WorkerFactory>()
const worker = Substitute.for<Worker<{ userId: string }>>()
// @ts-expect-error D is unknown here, and a Worker<{ userId: string }> does not fit Worker<unknown>
factory.create('digest', Arg.any()).returns(worker)
// @ts-expect-error explicit type arguments select the interface's own signature, which has no setup API
factory.create<{ userId: string }>('digest', Arg.any()).returns(worker)
// @ts-expect-error the configure view the same
factory[configure]().create('digest', Arg.any()).returns(worker)
factory.create('digest', Arg.any()).returns(worker as unknown as Worker<unknown>)
factory[configure]().create('digest', Arg.any()).returns(worker as unknown as Worker<unknown>)
factory.received(1).create('digest', Arg.any())
const DigestWorkerClass = Substitute.for<typeof DigestWorker>()
const digestWorker = Substitute.for<DigestWorker<{ userId: string }>>()
// @ts-expect-error a generic class used as a constructor substitute the same
DigestWorkerClass('digest', Arg.any()).returns(digestWorker)
DigestWorkerClass('digest', Arg.any()).returns(digestWorker as unknown as DigestWorker<unknown>)
DigestWorkerClass.received(1)('digest', Arg.any())
// Only covariant uses of the type parameter need no cast.
interface Box<D> { value: D; get(): D }
interface BoxFactory { make<D>(value: D): Box<D> }
Substitute.for<BoxFactory>().make(Arg.any()).returns(Substitute.for<Box<{ userId: string }>>())
