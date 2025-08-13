import { NoArgumentMockObjectMixin } from './SubstitutionLevel'
import { FunctionSubstituteWithOverloads, NoArgumentFunctionSubstitute } from './FunctionSubstitute'

export type PropertySubstitute<TObject, TReturnType> = 
    TReturnType & 
    NoArgumentMockObjectMixin<TObject, TReturnType>;

export type TryToExpandNonArgumentedTerminatingFunction<TObject, TProperty extends keyof TObject> =
    TObject[TProperty] extends (...args: []) => unknown ? 
        () => void : 
        {}

export type TryToExpandArgumentedTerminatingFunction<TObject, TProperty extends keyof TObject> =
    TObject[TProperty] extends (...args: any) => any ? 
        FunctionSubstituteWithOverloads<TObject[TProperty], true> : 
        {}

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

export type ObjectSubstituteTransformation<K, T = Omit<K, ''>> = {
    [P in keyof T]: 
        TryToExpandNonArgumentedFunctionSubstitute<T, P> & 
        TryToExpandArgumentedFunctionSubstitute<T, P> & 
        TryToExpandPropertySubstitute<T, P>;
}
