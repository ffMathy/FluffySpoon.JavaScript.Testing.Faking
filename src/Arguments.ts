export class Arg {
    static any()
    static any<T extends 'string'|'number'|'boolean'|'symbol'|'undefined'|'object'|'function'|'array'>(type: T)
    static any(type?: string): Argument<any> {
        const description = !type ? '{any arg}' : '{arg matching ' + type + '}';
        return new Argument<any>(description, x => {
            if(typeof type === 'string')
                return true;

            if(typeof type === 'undefined')
                return true;

            if(type === 'array')
                return x && Array.isArray(x);

            return typeof x === type;
        });
    }

    static is<T>(predicate: (input: T) => boolean): Argument<T> {
        return new Argument<T>('{arg matching predicate ' + this.toStringify(predicate) + '}', predicate) as any;
    }

    private static toStringify(obj: any) {
        if(typeof obj.inspect === 'function')
            return obj.inspect();

        if(typeof obj.toString === 'function')
            return obj.toString();

        return obj;
    }
}

export class Argument<T> {
    constructor(
        private description: string,
        private matchingFunction: (arg: T) => boolean
    ) {
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