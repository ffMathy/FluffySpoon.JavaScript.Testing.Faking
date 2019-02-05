export class Argument<T> {
    encounteredValues: any[];

    constructor(
        private description: string,
        private matchingFunction: (arg: T) => boolean
    ) {
        this.encounteredValues = [];
    }

    matches(arg: T) {
        return this.matchingFunction(arg);
    }

    toString() {
        return this.description;
    }

    inspect() {
        return this.description;
    }
}

export class AllArguments extends Argument<any> {
    constructor() {
        super('{all}', () => true);
    }
}

export class Arg {
    static all() {
        return new AllArguments();
    }

    static any()
    static any<T extends 'string'>(type: T): Argument<string> & string
    static any<T extends 'number'>(type: T): Argument<number> & number
    static any<T extends 'boolean'>(type: T): Argument<boolean> & boolean
    static any<T extends 'array'>(type: T): Argument<any[]> & any[]
    static any<T extends 'function'>(type: T): Argument<Function> & Function
    static any<T extends 'string'|'number'|'boolean'|'symbol'|'undefined'|'object'|'function'|'array'>(type: T)
    static any(type?: string): Argument<any> & any {
        const description = !type ? '{any arg}' : '{type ' + type + '}';
        return new Argument<any>(description, x => {
            if(!type)
                return true;

            if(typeof x === 'undefined')
                return true;

            if(type === 'array')
                return x && Array.isArray(x);

            return typeof x === type;
        });
    }

    static is<T>(predicate: (input: T) => boolean): Argument<T> & T {
        return new Argument<T>('{predicate ' + this.toStringify(predicate) + '}', predicate) as any;
    }

    private static toStringify(obj: any) {
        if(typeof obj.inspect === 'function')
            return obj.inspect();

        if(typeof obj.toString === 'function')
            return obj.toString();

        return obj;
    }
}