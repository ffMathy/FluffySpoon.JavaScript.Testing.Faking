export declare type FunctionSubstitute<F extends any[], T> = (...args: F) => (T & {
    returns: (...args: T[]) => void;
});
export declare type PropertySubstitute<T> = T & {
    returns: (...args: T[]) => void;
};
export declare type ObjectSubstitute<T extends Object> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): T;
};
declare type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]: T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> : PropertySubstitute<T[P]>;
};
export {};
