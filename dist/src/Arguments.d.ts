export declare class Argument<T> {
    private description;
    private matchingFunction;
    constructor(description: string, matchingFunction: (arg: T) => boolean);
    matches(arg: T): boolean;
    toString(): string;
    inspect(): string;
}
export declare class AllArguments extends Argument<any> {
    constructor();
}
export declare class Arg {
    private static _all;
    static all(): AllArguments;
    static any(): Argument<any> & any;
    static any<T extends 'string'>(type: T): Argument<string> & string;
    static any<T extends 'number'>(type: T): Argument<number> & number;
    static any<T extends 'boolean'>(type: T): Argument<boolean> & boolean;
    static any<T extends 'array'>(type: T): Argument<any[]> & any[];
    static any<T extends 'function'>(type: T): Argument<Function> & Function;
    static any<T extends 'string' | 'number' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' | 'array'>(type: T): Argument<any> & any;
    static is<T>(predicate: (input: any) => boolean): Argument<T> & T;
    private static toStringify;
}
