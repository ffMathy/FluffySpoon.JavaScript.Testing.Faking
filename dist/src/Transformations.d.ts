import { AllArguments } from "./Arguments";
export declare type NoArgumentFunctionSubstitute<TReturnType> = (() => (TReturnType & NoArgumentMockObjectMixin<TReturnType>));
export declare type FunctionSubstitute<TArguments extends any[], TReturnType> = ((...args: TArguments) => (TReturnType & MockObjectMixin<TArguments, TReturnType>)) & ((allArguments: AllArguments) => (TReturnType & MockObjectMixin<TArguments, TReturnType>));
export declare type PropertySubstitute<TReturnType> = (TReturnType & Partial<NoArgumentMockObjectMixin<TReturnType>>);
declare type BaseMockObjectMixin<TReturnType> = {
    returns: (...args: TReturnType[]) => void;
};
declare type NoArgumentMockObjectMixin<TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: () => TReturnType) => void;
};
declare type MockObjectMixin<TArguments extends any[], TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: (...args: TArguments) => TReturnType) => void;
};
export declare type ObjectSubstitute<T extends Object, K extends Object = T> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): TerminatingObject<K>;
    didNotReceive(amount?: number): TerminatingObject<K>;
    mimick(instance: T): void;
};
declare type TerminatingObject<T> = {
    [P in keyof T]: T[P] extends () => infer R ? () => void : T[P] extends (...args: infer F) => infer R ? (...args: F) => void : T[P];
};
declare type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]: T[P] extends () => infer R ? NoArgumentFunctionSubstitute<R> : T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> : PropertySubstitute<T[P]>;
};
declare type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export declare type OmitProxyMethods<T extends any> = Omit<T, 'mimick' | 'received' | 'didNotReceive'>;
export declare type DisabledSubstituteObject<T> = T extends ObjectSubstitute<OmitProxyMethods<infer K>, infer K> ? K : never;
export {};
