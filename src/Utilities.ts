import { Argument, AllArguments } from "./Arguments";

export function stringifyArguments(args: any[]) {
    return args && args.length > 0 ? 'arguments [' + args.join(', ') + ']' : 'no arguments';
};

export function areArgumentArraysEqual(a: any[], b: any[]) {
    if(b.length !== a.length)
        return false;

    for(var i=0;i<b.length;i++) {
        if(!areArgumentsEqual(b[i], a[i]))
            return false;
    }

    return true;
}

export function areArgumentsEqual(a: any, b: any) {
    if(a instanceof AllArguments || b instanceof AllArguments)
        return true;

    if(a instanceof Argument && b instanceof Argument)
        return a.matches(b) && b.matches(a);

    if(a instanceof Argument) 
        return a.matches(b);

    if(b instanceof Argument)
        return b.matches(a);

    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;

    return a === b;
};