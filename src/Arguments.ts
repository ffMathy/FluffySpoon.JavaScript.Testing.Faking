type PredicateFunction<T> = (arg: T) => boolean
type ArgumentOptions = {
    inverseMatch?: boolean
}
class BaseArgument<T> {
    constructor(
        private _description: string,
        private _matchingFunction: PredicateFunction<T>,
        private _options?: ArgumentOptions
    ) { }

    matches(arg: T) {
        const inverseMatch = this._options?.inverseMatch ?? false
        return inverseMatch ? !this._matchingFunction(arg) : this._matchingFunction(arg);
    }

    toString() {
        return this._description;
    }

    [Symbol.for('nodejs.util.inspect.custom')]() {
        return this._description;
    }
}

export class Argument<T> extends BaseArgument<T> {
    private readonly _type = 'SingleArgument';
    constructor(description: string, matchingFunction: PredicateFunction<T>, options?: ArgumentOptions) {
        super(description, matchingFunction, options);
    }
    get type(): 'SingleArgument' {
        return this._type;
    }
}

export class AllArguments<T extends any[]> extends BaseArgument<T> {
    private readonly _type = 'AllArguments';
    constructor() {
        super('{all}', () => true, {});
    }
    get type(): 'AllArguments' {
        return this._type;
    }
}

export namespace Arg {
    type ExtractFirstArg<T> = T extends AllArguments<infer TArgs> ? TArgs[0] : T
    type ReturnArg<T> = Argument<T> & T;
    type Inversable<T> = T & { not: T }
    const factory = (factoryF: Function) => <T>(...args: any[]): T => factoryF(...args)
    const toStringify = (obj: any) => {
        if (typeof obj.inspect === 'function')
            return obj.inspect();

        if (typeof obj.toString === 'function')
            return obj.toString();

        return obj;
    }

    export const all = <T extends any[]>(): AllArguments<T> => new AllArguments<T>();

    type Is = <T>(predicate: PredicateFunction<ExtractFirstArg<T>>) => ReturnArg<ExtractFirstArg<T>>
    const isFunction = <T extends PredicateFunction<T>>(predicate: T, options?: ArgumentOptions) => new Argument(
        `{predicate ${toStringify(predicate)}}`, predicate, options
    );

    const isArgFunction: Inversable<Is> = (predicate) => factory(isFunction)(predicate);
    isArgFunction.not = (predicate) => factory(isFunction)(predicate, { inverseMatch: true });
    export const is = isArgFunction

    type MapAnyReturn<T> = T extends 'any' ?
        ReturnArg<any> : T extends 'string' ?
        ReturnArg<string> : T extends 'number' ?
        ReturnArg<number> : T extends 'boolean' ?
        ReturnArg<boolean> : T extends 'symbol' ?
        ReturnArg<symbol> : T extends 'undefined' ?
        ReturnArg<undefined> : T extends 'object' ?
        ReturnArg<object> : T extends 'function' ?
        ReturnArg<Function> : T extends 'array' ?
        ReturnArg<any[]> : any;

    type AnyType = 'string' | 'number' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function' | 'array' | 'any';
    type Any = <T extends AnyType = 'any'>(type?: T) => MapAnyReturn<T>;

    const anyFunction = (type: AnyType = 'any', options?: ArgumentOptions) => {
        const description = !type ? '{any arg}' : `{type ${type}}`;
        const predicate = (x: any) => {
            switch (type) {
                case 'any':
                    return true;
                case 'array':
                    return Array.isArray(x);
                default:
                    return typeof x === type;
            }
        }

        return new Argument(description, predicate, options);
    }

    const anyArgFunction: Inversable<Any> = (type) => factory(anyFunction)(type);
    anyArgFunction.not = (type) => factory(anyFunction)(type, { inverseMatch: true });
    export const any = anyArgFunction;
}