// R3TD-4 / T36 A union whose variants declare members as only null/undefined (`{ data: T; error: null } |
// { data: null; error: E }`, and the `?: undefined` "XOR" form) does not reduce Substitute.for<...>() to `never`.
// Such a member reads as the setup API intersected with the other variants' types, and `.returns(...)` takes the type
// the variants have in common (`string[] | null`). Unions without such members (Cat | Dog) are unchanged.
import { Substitute, SubstituteOf, configure, received } from '../src'
import { assert, Equals, expectType } from './helpers'

// PostgREST / Supabase style
type QueryResult = { data: string[]; error: null } | { data: null; error: Error }
const result = Substitute.for<QueryResult>()
result.data.returns(['a'])
result.data.returns(null)
result.error.returns(null)
result.error.returns(new Error('x'))
result[configure]().data.returns(['b'])
result.received().data
result.received().error = null
result[received](1).data = ['a']
const asResult: QueryResult = result
const data: string[] = result.data
// @ts-expect-error the configured value has the members' common type
result.data.returns('a')
// @ts-expect-error the assertion view keeps the members' common type
result.received().error = 'x'

// The XOR form, which compiled with 2.0.0-beta.4
type Outcome = { ok: true; value: string; error?: undefined } | { ok: false; value?: undefined; error: Error }
const outcome = Substitute.for<Outcome>()
outcome.ok.returns(true)
outcome.value.returns('x')
outcome.value.returns(undefined)
outcome.error.returns(new Error())
outcome.received().value = undefined
const asOutcome: Outcome = outcome
// @ts-expect-error `ok` is a boolean
outcome.ok.returns('yes')

// Only some variants declare the member as null
type Load = { status: 'idle'; data: null } | { status: 'done'; data: string }
const load = Substitute.for<Load>()
load.status.returns('idle')
load.status.returns('done')
load.data.returns('x')
load.data.returns(null)
const asLoad: Load = load
// @ts-expect-error `status` is 'idle' | 'done'
load.status.returns('loading')

// A member that is only null/undefined in every variant keeps its plain type (T25)
type Both = { kind: 'a'; a: number; gone: null } | { kind: 'b'; b: number; gone: null }
const both = Substitute.for<Both>()
both.kind.returns('a')
assert<Equals<typeof both.gone, null>>()
const asBoth: Both = both

// Unions without such members
interface Cat { kind: 'cat'; name: string; meow(): string }
interface Dog { kind: 'dog'; name: string; bark(times: number): string }
const pet = Substitute.for<Cat | Dog>()
pet.kind.returns('cat')
pet.name.returns('Rex')
pet.received().name
const asPet: Cat | Dog = pet
expectType<SubstituteOf<Cat | Dog>>(pet)
// @ts-expect-error not a member of every variant
pet.meow()
// @ts-expect-error `kind` is 'cat' | 'dog'
pet.kind.returns('cow')

// In generic code nothing changes
export function generic<T extends QueryResult>(sub: SubstituteOf<T>) {
  sub.received().data
  return sub
}

export { asResult, asOutcome, asLoad, asBoth, asPet, data }
