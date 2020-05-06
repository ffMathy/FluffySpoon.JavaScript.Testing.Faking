import { AllArguments } from "./Arguments";

type FunctionSubstituteWithOverloads<TFunc, Terminating = false> =
    TFunc extends {
        (...args: infer A1): infer R1;
        (...args: infer A2): infer R2;
        (...args: infer A3): infer R3;
        (...args: infer A4): infer R4;
        (...args: infer A5): infer R5;
    } ?
    FunctionHandler<A1, R1, Terminating> & FunctionHandler<A2, R2, Terminating> &
    FunctionHandler<A3, R3, Terminating> & FunctionHandler<A4, R4, Terminating>
    & FunctionHandler<A5, R5, Terminating> : TFunc extends {
        (...args: infer A1): infer R1;
        (...args: infer A2): infer R2;
        (...args: infer A3): infer R3;
        (...args: infer A4): infer R4;
    } ?
    FunctionHandler<A1, R1, Terminating> & FunctionHandler<A2, R2, Terminating> &
    FunctionHandler<A3, R3, Terminating> & FunctionHandler<A4, R4, Terminating> : TFunc extends {
        (...args: infer A1): infer R1;
        (...args: infer A2): infer R2;
        (...args: infer A3): infer R3;
    } ?
    FunctionHandler<A1, R1, Terminating> & FunctionHandler<A2, R2, Terminating>
    & FunctionHandler<A3, R3, Terminating> : TFunc extends {
        (...args: infer A1): infer R1;
        (...args: infer A2): infer R2;
    } ?
    FunctionHandler<A1, R1, Terminating> & FunctionHandler<A2, R2, Terminating> : TFunc extends {
        (...args: infer A1): infer R1;
    } ?
    FunctionHandler<A1, R1, Terminating> : never;

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type FunctionHandler<TArguments extends any[], TReturnType, Terminating> =
    Equals<TArguments, unknown[]> extends true ?
    {} : Terminating extends true ?
    TerminatingFunction<TArguments> :
    FunctionSubstitute<TArguments, TReturnType>

export type FunctionSubstitute<TArguments extends any[], TReturnType> =
    ((...args: TArguments) => (TReturnType & MockObjectMixin<TArguments, TReturnType>)) &
    ((allArguments: AllArguments<TArguments>) => (TReturnType & MockObjectMixin<TArguments, TReturnType>))

export type NoArgumentFunctionSubstitute<TReturnType> = (() => (TReturnType & NoArgumentMockObjectMixin<TReturnType>))
export type PropertySubstitute<TReturnType> = (TReturnType & Partial<NoArgumentMockObjectMixin<TReturnType>>);

type MockObjectPromise<TReturnType> = TReturnType extends Promise<infer U> ? {
    resolves: (...args: U[]) => void;
    rejects: (exception: any) => void;
} : {}

type BaseMockObjectMixin<TReturnType> = MockObjectPromise<TReturnType> & {
    returns: (...args: TReturnType[]) => void;
    throws: (exception: any) => never;
}

type NoArgumentMockObjectMixin<TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: () => TReturnType) => void;
}

type MockObjectMixin<TArguments extends any[], TReturnType> = BaseMockObjectMixin<TReturnType> & {
    mimicks: (func: (...args: TArguments) => TReturnType) => void;
}

export type ObjectSubstitute<T extends Object, K extends Object = T> = ObjectSubstituteTransformation<T> & {
    received(amount?: number): TerminatingObject<K>;
    didNotReceive(): TerminatingObject<K>;
    mimick(instance: T): void;
}

type TerminatingFunction<TArguments extends any[]> = ((...args: TArguments) => void) & ((arg: AllArguments<TArguments>) => void)

type TerminatingObject<T> = {
    [P in keyof T]:
    T[P] extends (...args: infer F) => any ?
    F extends [] ? () => void :
    FunctionSubstituteWithOverloads<T[P], true> :
    T[P];
}

type ObjectSubstituteTransformation<T extends Object> = {
    [P in keyof T]:
    T[P] extends (...args: infer F) => infer R ?
    F extends [] ? NoArgumentFunctionSubstitute<R> :
    FunctionSubstituteWithOverloads<T[P]> :
    PropertySubstitute<T[P]>;
}

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export type OmitProxyMethods<T extends any> = Omit<T, 'mimick' | 'received' | 'didNotReceive'>;

export type DisabledSubstituteObject<T> = T extends ObjectSubstitute<OmitProxyMethods<infer K>, infer K> ? K : never;
