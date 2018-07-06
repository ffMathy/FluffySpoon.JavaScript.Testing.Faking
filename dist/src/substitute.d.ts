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
declare type ProxyPropertyContext = {
    name: string;
    type: 'function' | 'object';
    access: 'write' | 'read';
};
declare type ProxyCallRecord = {
    arguments?: Array<any>;
    callCount: number;
};
export declare function stringifyArguments(args: any[]): string;
export declare function stringifyCalls(property: ProxyPropertyContext, calls: ProxyCallRecord[]): string;
export declare function findCallMatchingArguments(calls: ProxyCallRecord[], args: any[]): ProxyCallRecord;
export declare function equals(a: any, b: any): boolean;
export declare class Substitute {
    static for<T>(): ObjectSubstitute<T>;
}
export {};
