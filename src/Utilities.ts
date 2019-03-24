import { Argument, AllArguments } from "./Arguments";
import util = require('util')

export type Call = any[] // list of args

export function stringifyArguments(args: any[]) {
    args = args.map(x => util.inspect(x));
    return args && args.length > 0 ? 'arguments [' + args.join(', ') + ']' : 'no arguments';
};

export function areArgumentArraysEqual(a: any[], b: any[]) {
    for(var i=0;i<Math.max(b.length, a.length);i++) { // @TODO should be Math.max I think -- domasx2
        if(!areArgumentsEqual(b[i], a[i]))
            return false;
    }

    return true;
}

export function stringifyCalls(calls: Call[]) {

    if(calls.length === 0)
        return ' (no calls)';

    let output = '';
    for (let call of calls) {
        output += '\n-> call with ' + (call.length ? stringifyArguments(call) : '(no arguments)')
    }

    return output;
};

export function areArgumentsEqual(a: any, b: any) {
    if(a instanceof AllArguments || b instanceof AllArguments)
        return true;

    if(a instanceof Argument && b instanceof Argument) {
        throw new Error("`Argument` should only be used to set up value or verify, not in the implementation.")
    }

    if(a instanceof Argument) 
        return a.matches(b);

    if(b instanceof Argument)
        return b.matches(a);

    // I think this is surprising behaviour. null !== undefined, test lib should be strict about it -- domasx2
    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;

    return a === b;
};