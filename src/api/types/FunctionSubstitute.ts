import { AllArguments } from '../../shared'
import { MockObjectMixin, NoArgumentMockObjectMixin } from './SubstitutionLevel'

type TerminatingFunction<TArguments extends any[]> = ((...args: TArguments) => void) & ((arg: AllArguments<TArguments>) => void)
export type FunctionSubstitute<TArguments extends any[], TReturnType> =
    ((...args: TArguments) => (TReturnType & MockObjectMixin<TReturnType, TArguments, TReturnType>)) &
    ((allArguments: AllArguments<TArguments>) => (TReturnType & MockObjectMixin<TReturnType, TArguments, TReturnType>))

export type FunctionSubstituteWithOverloads<TFunc, Terminating = false> =
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

export type NoArgumentFunctionSubstitute<TObject, TReturnType> = () => TReturnType & NoArgumentMockObjectMixin<TObject, TReturnType>
