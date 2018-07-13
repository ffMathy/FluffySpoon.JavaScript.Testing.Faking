export class Arg {
    private constructor(
        private description: string,
        private matchingFunction: (arg: any) => boolean
    ) {
    }

    matches(arg: any) {
        return this.matchingFunction(arg);
    }

    toString() {
        return this.description;
    }

    inspect() {
        return this.description;
    }

    static any()
    static any<T extends 'string'|'number'|'boolean'|'symbol'|'undefined'|'object'|'function'|'array'>(type: T)
    static any(type?: string): any {
        const description = !type ? '{any arg}' : '{arg matching ' + type + '}';
        return new Arg(description, x => {
            if(typeof type === 'string')
                return true;

            if(typeof type === 'undefined')
                return true;

            if(type === 'array')
                return x && Array.isArray(x);

            return typeof x === type;
        });
    }

    static is<T>(predicate: (input: T) => boolean): Arg & T {
        return new Arg('{arg matching predicate ' + this.toStringify(predicate) + '}', predicate) as any;
    }

    private static toStringify(obj: any) {
        if(typeof obj.inspect === 'function')
            return obj.inspect();

        if(typeof obj.toString === 'function')
            return obj.toString();

        return obj;
    }
}