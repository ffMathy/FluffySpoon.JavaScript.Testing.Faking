export declare class Arg {
    private description;
    private matchingFunction;
    private constructor();
    matches(arg: any): boolean;
    toString(): string;
    inspect(): string;
    static any(): any;
    static any<T extends 'string' | 'number' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' | 'array'>(type: T): any;
    static is<T>(value: T): any;
    static is<T>(predicate: (input: T) => boolean): any;
    private static toStringify;
}
