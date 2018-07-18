export declare type FunctionSubstitute<TArguments extends any[], TReturnType> = ((...args: TArguments) => (TReturnType & MockObjectMixin<TReturnType>)) & {
    mimicks: (functionReference: ((...args: TArguments) => TReturnType)) => void;
};
export declare type PropertySubstitute<TInstanceType, TReturnType> = TReturnType & Partial<MockObjectMixin<TReturnType>> & {
    mimicks?: (instance: TInstanceType) => void;
};
declare type MockObjectMixin<T> = {
    returns: (...args: T[]) => void;
    returnsUsing: (functionReference: () => T) => void;
};
export declare type ObjectSubstitute<T extends Object> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): T;
    mimick(instance: T): void;
};
declare type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]: T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> : PropertySubstitute<T, T[P]>;
};
export {};
