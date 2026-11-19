// R14TD-1 Declaration emit of generic helpers, with the documented workaround. When the INFERRED type of an exported
// generic helper is a substitute of `T | undefined` or `T | null`, or a member or check view of a substitute of a
// constrained type parameter (`<T extends Calculator>(s: SubstituteOf<T>) => s.received().add`), declaration emit
// does not finish on TypeScript 3.6, runs out of memory on 4.5, and reports TS7056 ("The inferred type of this node
// exceeds the maximum length the compiler will serialize") on 4.9 and newer. Annotating the type, as below, emits on
// every version. (The unannotated forms are not compiled here: they would fail.) Compiled with `declaration: true` and
// `emitDeclarationOnly` by this directory's tsconfig (`npm run test:types`).
import { Substitute, SubstituteOf, received } from '../../src'

export interface Calculator { add(a: number, b: number): number; total: number; load(): Promise<number> }

// A substitute of `T | undefined` / `T | null`: annotate it as such.
export function optional<T>(sub: SubstituteOf<T | undefined>): SubstituteOf<T | undefined> { return sub }
export function nullable<T>(sub: SubstituteOf<T | null>): SubstituteOf<T | null> { return sub }
export class OptionalFixture<T> { sub: SubstituteOf<T | undefined> = Substitute.for<T | undefined>() }

// A member or check view of a constrained type parameter: annotate it with the constraint's types, or take the check
// view from the substitute typed as the constraint's substitute. (Annotating a whole check view as
// `ReturnType<SubstituteOf<Calculator>['received']>` works from TypeScript 3.9 on; 3.6 reports TS2589 for it.)
export function member<T extends Calculator>(sub: SubstituteOf<T>): SubstituteOf<Calculator>['add'] { return sub.add }
export function view<T extends Calculator>(sub: SubstituteOf<T>) {
  const calculator: SubstituteOf<Calculator> = sub
  return calculator.received()
}
export function viewMember<T extends Calculator>(sub: SubstituteOf<T>): ReturnType<SubstituteOf<Calculator>['received']>['add'] {
  return sub.received().add
}
export function symbolViewMember<T extends Calculator>(sub: SubstituteOf<T>): ReturnType<SubstituteOf<Calculator>[typeof received]>['total'] {
  return sub[received](1).total
}
export function whole<T extends Calculator>(sub: SubstituteOf<T>): SubstituteOf<Calculator> { return sub }

// The annotated results keep their API.
const calculator = Substitute.for<Calculator>()
member(calculator)(1, 2).returns(3)
view(calculator).add(1, 2)
viewMember(calculator)(1, 2)
optional(Substitute.for<Calculator | undefined>())
