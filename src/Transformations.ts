import { Argument } from "./Arguments";

export type FunctionSubstitute<F extends any[], T> = (...args: F) => (T & MockMethodMixin<T>);
export type PropertySubstitute<T> = T & MockMethodMixin<T>;

export type ObjectSubstitute<T extends Object> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): T;
}

type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]:
    T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> :
    PropertySubstitute<T[P]>;
}

type MockArgumentInput<T> = T | Argument<T>;

type MockMethodMixin<TReturnType> = {
    returns: (...args: TReturnType[]) => void;
}