import { AllArguments } from "./Arguments";
export declare type NoArgumentFunctionSubstitute<TReturnType> = (() => (TReturnType & NoArgumentMockObjectMixin<TReturnType>));
export declare type FunctionSubstitute<TArguments extends any[], TReturnType> = ((...args: TArguments) => (TReturnType & MockObjectMixin<TArguments, TReturnType>)) & ((allArguments: AllArguments) => (TReturnType & MockObjectMixin<TArguments, TReturnType>));
export declare type PropertySubstitute<TReturnType> = TReturnType & Partial<NoArgumentMockObjectMixin<TReturnType>>;
declare type BaseMockObjectMixin<TReturnType> = {
    returns: (...args: TReturnType[]) => void;
};
declare type NoArgumentMockObjectMixin<TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: () => TReturnType) => void;
};
declare type MockObjectMixin<TArguments extends any[], TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: (...args: TArguments) => TReturnType) => void;
};
export declare type ObjectSubstitute<T extends Object> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): T;
    mimick(instance: T): void;
};
declare type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]: T[P] extends () => infer R ? NoArgumentFunctionSubstitute<R> : T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> : PropertySubstitute<T[P]>;
};
export {};
