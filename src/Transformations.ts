import type { AllArguments } from './Arguments';
import type { FirstLevelMethod } from './Types';
import { Prettify } from './Utilities';

export const received = Symbol('received');
export const didNotReceive = Symbol('didNotReceive');
export const mimick = Symbol('mimick');
export const clearReceivedCalls = Symbol('clearReceivedCalls');
export const mimicks = Symbol('mimicks');
export const throws = Symbol('throws');
export const returns = Symbol('returns');
export const resolves = Symbol('resolves');
export const rejects = Symbol('rejects');

export type ReceivedPropertyKey = typeof received | 'received';
export type DidNotReceivePropertyKey = typeof didNotReceive | 'didNotReceive';
export type MimickPropertyKey = typeof mimick | 'mimick';
export type ClearReceivedCallsPropertyKey = typeof clearReceivedCalls | 'clearReceivedCalls';
export type MimicksPropertyKey = typeof mimicks | 'mimicks';
export type ThrowsPropertyKey = typeof throws | 'throws';
export type ReturnsPropertyKey = typeof returns | 'returns';
export type ResolvesPropertyKey = typeof resolves | 'resolves';
export type RejectsPropertyKey = typeof rejects | 'rejects';

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
    ((...args: TArguments) => (TReturnType & MockObjectMixin<TReturnType, TArguments, TReturnType>)) &
    ((allArguments: AllArguments<TArguments>) => (TReturnType & MockObjectMixin<TReturnType, TArguments, TReturnType>))

export type NoArgumentFunctionSubstitute<TObject, TReturnType> = 
    () => 
        TReturnType & 
        NoArgumentMockObjectMixin<TObject, TReturnType>;

export type PropertySubstitute<TObject, TReturnType> = 
    TReturnType & 
    NoArgumentMockObjectMixin<TObject, TReturnType>;

type OneArgumentRequiredFunction<TArgs, TReturnType> = (requiredInput: TArgs, ...restInputs: TArgs[]) => TReturnType;

type MockObjectPromise<TReturnType> = TReturnType extends Promise<infer U> ? (
    (TReturnType extends { resolves: any } ? 
        { [resolves]: OneArgumentRequiredFunction<U, void> } :
        { resolves: OneArgumentRequiredFunction<U, void> }) &
    (TReturnType extends { rejects: any } ? 
        { [rejects]: OneArgumentRequiredFunction<any, void> } :
        { rejects: OneArgumentRequiredFunction<any, void> })
) : {}

type BaseMockObjectMixin<TObject, TReturnType> = 
    MockObjectPromise<TReturnType> & 
    (
        (TObject extends { returns: any } ? 
            { [returns]: OneArgumentRequiredFunction<TReturnType, void> } :
            { returns: OneArgumentRequiredFunction<TReturnType, void> }) &
        (TObject extends { throws: any } ? 
            { [throws]: OneArgumentRequiredFunction<any, never> } :
            { throws: OneArgumentRequiredFunction<any, never> })
    )

type NoArgumentMockObjectMixin<TObject, TReturnType> = 
    BaseMockObjectMixin<TObject, TReturnType> & 
    (TObject extends { mimicks: any } ? 
        { [mimicks]: OneArgumentRequiredFunction<() => TReturnType, void> } :
        { mimicks: OneArgumentRequiredFunction<() => TReturnType, void> })

type MockObjectMixin<TObject, TArguments extends any[], TReturnType> = 
    BaseMockObjectMixin<TObject, TReturnType> & 
    (TReturnType extends { mimicks: any } ? 
        { [mimicks]: OneArgumentRequiredFunction<(...args: TArguments) => TReturnType, void> } :
        { mimicks: OneArgumentRequiredFunction<(...args: TArguments) => TReturnType, void> })

type TerminatingFunction<TArguments extends any[]> = ((...args: TArguments) => void) & ((arg: AllArguments<TArguments>) => void)

type TryToExpandNonArgumentedTerminatingFunction<TObject, TProperty extends keyof TObject> =
    TObject[TProperty] extends (...args: []) => unknown ? 
        () => void : 
        {}

type TryToExpandArgumentedTerminatingFunction<TObject, TProperty extends keyof TObject> =
    TObject[TProperty] extends (...args: any) => any ? 
        FunctionSubstituteWithOverloads<TObject[TProperty], true> : 
        {}

type TerminatingObject<T> = {
    [P in keyof T]: 
        TryToExpandNonArgumentedTerminatingFunction<T, P> & 
        TryToExpandArgumentedTerminatingFunction<T, P> & 
        T[P];
}

type TryToExpandNonArgumentedFunctionSubstitute<TObject, TProperty extends keyof TObject> =
    TObject[TProperty] extends (...args: []) => infer R ? 
        NoArgumentFunctionSubstitute<TObject, R> : 
        {}

type TryToExpandArgumentedFunctionSubstitute<TObject, TProperty extends keyof TObject> =
    TObject[TProperty] extends (...args: infer F) => any ? 
        F extends [] ? 
            {} : 
            FunctionSubstituteWithOverloads<TObject[TProperty]> : 
        {}

type TryToExpandPropertySubstitute<TObject, TProperty extends keyof TObject> = 
    PropertySubstitute<TObject, TObject[TProperty]>

type ObjectSubstituteTransformation<K, T = OmitProxyMethods<K>> = {
    [P in keyof T]: 
        TryToExpandNonArgumentedFunctionSubstitute<T, P> & 
        TryToExpandArgumentedFunctionSubstitute<T, P> & 
        TryToExpandPropertySubstitute<T, P>;
}

export type OmitProxyMethods<T> = Omit<T, FirstLevelMethod>;

export type ObjectSubstitute<T> = 
    ObjectSubstituteTransformation<T> & 
    ObjectSubstituteMethods<T>

type ObjectSubstituteMethods<T> = 
    (T extends { received: any } ? 
        { [received](amount?: number): TerminatingObject<T> } :
        { received(amount?: number): TerminatingObject<T> }) &
    (T extends { didNotReceive: any } ? 
        { [didNotReceive](): TerminatingObject<T> } :
        { didNotReceive(): TerminatingObject<T> }) &
    (T extends { mimick: any } ? 
        { [mimick](instance: OmitProxyMethods<T>): void } :
        { mimick(instance: OmitProxyMethods<T>): void }) &
    (T extends { clearReceivedCalls: any } ? 
        { [clearReceivedCalls](): void } :
        { clearReceivedCalls(): void })