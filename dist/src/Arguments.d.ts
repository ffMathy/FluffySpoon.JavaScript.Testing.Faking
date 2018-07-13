export declare class Arg {
    static any(): any;
    static any<T extends 'string'>(type: T): Arg & string;
    static any<T extends 'number'>(type: T): Arg & number;
    static any<T extends 'boolean'>(type: T): Arg & boolean;
    static any<T extends 'array'>(type: T): Arg & any[];
    static any<T extends 'function'>(type: T): Arg & Function;
    static any<T extends 'string' | 'number' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' | 'array'>(type: T): any;
    static is<T>(predicate: (input: T) => boolean): Argument<T>;
    private static toStringify;
}
export declare class Argument<T> {
    private description;
    private matchingFunction;
    constructor(description: string, matchingFunction: (arg: T) => boolean);
    matches(arg: T): boolean;
    toString(): string;
    inspect(): string;
}
