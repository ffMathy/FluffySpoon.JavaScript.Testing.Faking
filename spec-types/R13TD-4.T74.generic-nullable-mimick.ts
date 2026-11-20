// R13TD-4 / T74 In generic code, `sub[mimick](instance)` takes the type itself (as before T72) also when the substitute's
// type includes `null` or `undefined`: `SubstituteOf<T | undefined>` and `SubstituteOf<T | null>` take a `T` (or a
// `T | undefined` / `T | null`). Round 13 picked the concrete branch there, since `keyof (T | undefined)` is `never`,
// and rejected a `T` with TS2345 ("not assignable to parameter of type 'EachMimickInstance<T> | undefined'").
// A concrete `Thing | undefined` / `Thing | null` still takes a partial instance (T72), with its checks.
import { Substitute, SubstituteOf, mimick } from '../src'

interface Thing { name: string; size(): number }

// Generic code: the instance is a `T`.
export function delegateOptional<T>(sub: SubstituteOf<T | undefined>, instance: T) {
  sub[mimick](instance)
}
export function delegateOptionalValue<T>(sub: SubstituteOf<T | undefined>, instance: T | undefined) {
  sub[mimick](instance)
}
export function delegateNullable<T>(sub: SubstituteOf<T | null>, instance: T | null) {
  sub[mimick](instance)
}
export function delegateNullableValue<T>(sub: SubstituteOf<T | null>, instance: T) {
  sub[mimick](instance)
}
export function delegateMaybe<T>(sub: SubstituteOf<T | null | undefined>, instance: T) {
  sub[mimick](instance)
}
export function delegateConstrained<T extends Thing>(sub: SubstituteOf<T | undefined>, instance: T) {
  sub[mimick](instance)
}
export class OptionalFixture<T> {
  sub = Substitute.for<T | undefined>()
  use(instance: T) {
    this.sub[mimick](instance)
  }
}

// ... and only a `T`.
export function wrongInstance<T>(sub: SubstituteOf<T | undefined>, instance: number) {
  // @ts-expect-error a number is not a T
  sub[mimick](instance)
}
export function emptyInstance<T>(sub: SubstituteOf<T | null>) {
  // @ts-expect-error an empty object is not a T
  sub[mimick]({})
}
export function partialInstance<T>(sub: SubstituteOf<T | undefined>, instance: Partial<T>) {
  // @ts-expect-error a partial instance needs a concrete type
  sub[mimick](instance)
}

// Concrete types with `null` or `undefined` take a partial instance, as in T72.
const optionalThing = Substitute.for<Thing | undefined>()
optionalThing[mimick]({ name: 'x' })
optionalThing[mimick]({ size: () => 1 })
declare const thing: Thing
optionalThing[mimick](thing)
// @ts-expect-error the member types are checked
optionalThing[mimick]({ name: 1 })
// @ts-expect-error an object literal has no other members
optionalThing[mimick]({ name: 'x', extra: 1 })
// @ts-expect-error not an instance
optionalThing[mimick](42)
const nullableThing = Substitute.for<Thing | null>()
nullableThing[mimick]({ name: 'x' })
nullableThing[mimick](thing)
// @ts-expect-error the member types are checked
nullableThing[mimick]({ size: () => 'one' })
// @ts-expect-error an object literal has no other members
nullableThing[mimick]({ title: 'x' })
