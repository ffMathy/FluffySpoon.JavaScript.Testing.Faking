import { AllArguments } from "./Arguments";

export type NoArgumentFunctionSubstitute<TReturnType> =
    TReturnType extends Promise<infer U> ?
        (() => (TReturnType & NoArgumentMockObjectPromise<TReturnType>)) :
        (() => (TReturnType & NoArgumentMockObjectMixin<TReturnType>))

export type FunctionSubstitute<TArguments extends any[], TReturnType> =
    TReturnType extends Promise<infer U> ?
        ((...args: TArguments) => (TReturnType & MockObjectPromise<TArguments, TReturnType>)) &
        ((allArguments: AllArguments) => (TReturnType & MockObjectPromise<TArguments, TReturnType>)) :
        ((...args: TArguments) => (TReturnType & MockObjectMixin<TArguments, TReturnType>)) &
        ((allArguments: AllArguments) => (TReturnType & MockObjectMixin<TArguments, TReturnType>))

export type PropertySubstitute<TReturnType> = (TReturnType & Partial<NoArgumentMockObjectMixin<TReturnType>>);

type Unpacked<T> =
    T extends Promise<infer U> ? U :
    T;

type BaseMockObjectMixin<TReturnType> = {
    returns: (...args: TReturnType[]) => void;
    throws: (exception: any) => void;
}

type NoArgumentMockObjectMixin<TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: () => TReturnType) => void;
}

type MockObjectMixin<TArguments extends any[], TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: (...args: TArguments) => TReturnType) => void;
}

type NoArgumentMockObjectPromise<TReturnType> = NoArgumentMockObjectMixin<TReturnType> & {
    resolves: (...args: Unpacked<TReturnType>[]) => void;
    rejects: (exception: any) => void;
}

type MockObjectPromise<TArguments extends any[], TReturnType> = MockObjectMixin<TArguments, TReturnType> & {
    resolves: (...args: Unpacked<TReturnType>[]) => void;
    rejects: (exception: any) => void;
}

export type ObjectSubstitute<T extends Object, K extends Object = T> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): TerminatingObject<K>;
    didNotReceive(): TerminatingObject<K>;
    mimick(instance: T): void;
}

type TerminatingObject<T> = {
    [P in keyof T]:
    T[P] extends (...args: infer F) => any ? ((...args: F) => void) & ((arg: AllArguments) => void) :
    T[P] extends () => any ? () => void :
    T[P];
}

type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]:
    T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> :
    T[P] extends () => infer R ? NoArgumentFunctionSubstitute<R> :
    PropertySubstitute<T[P]>;
}

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export type OmitProxyMethods<T extends any> = Omit<T, 'mimick' | 'received' | 'didNotReceive'>;

export type DisabledSubstituteObject<T> = T extends ObjectSubstitute<OmitProxyMethods<infer K>, infer K> ? K : never;
