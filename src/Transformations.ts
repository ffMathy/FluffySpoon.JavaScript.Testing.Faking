export type FunctionSubstitute<F extends any[], T> = (...args: F) => (T & MockObjectMixin<T>)

export type PropertySubstitute<T> = T & Partial<MockObjectMixin<T>>

type MockObjectMixin<T> = {
    returns: (...args: T[]) => void;
}

export type ObjectSubstitute<T extends Object> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): T;
}

type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]:
    T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> :
    PropertySubstitute<T[P]>;
}