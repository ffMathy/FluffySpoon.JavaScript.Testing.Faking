// Helpers for the type-level tests. Nothing in spec-types/ is executed: `npm run test:types` only type-checks it.
// Lines that must NOT compile are marked with `// @ts-expect-error` (tsc fails if such a line compiles).

export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/** Compile-time assertion: `assert<Equals<X, Y>>()` compiles only when X and Y are the same type. */
export function assert<T extends true>(): void { }

/** Compile-time assertion: compiles only when `value` is assignable to `T`. */
export function expectType<T>(_value: T): void { }

/** A value of any type, for arguments whose value does not matter. */
export declare function value<T>(): T
