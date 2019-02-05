import { Argument, AllArguments } from "./Arguments";
import util = require('util')

export type Call = {callCount: number, arguments?: any[]};

export function stringifyArguments(args: any[]) {
    args = args.map(x => util.inspect(x));
    return args && args.length > 0 ? 'arguments [' + args.join(', ') + ']' : 'no arguments';
};

export function areArgumentArraysEqual(a: any[], b: any[]) {
    for(var i=0;i<Math.min(b.length, a.length);i++) {
        if(!areArgumentsEqual(b[i], a[i]))
            return false;
    }

    return true;
}

export function stringifyCalls(calls: Call[]) {
    calls = calls.filter(x => x.callCount > 0);

    if(calls.length === 0)
        return ' (no calls)';

    let output = '';
    for (let call of calls) {
        output += '\n-> ' + call.callCount + ' call';
        output += call.callCount !== 1 ? 's' : '';

        if(call.arguments) 
            output += ' with ' + stringifyArguments(call.arguments);
    }

    return output;
};

export function areArgumentsEqual(a: any, b: any) {
    if(a instanceof AllArguments || b instanceof AllArguments)
        return true;

    if(a instanceof Argument && b instanceof Argument) {
        for(let encounteredValue of a.encounteredValues) {
            if(!b.matches(encounteredValue))
                return false;
        }

        for(let encounteredValue of b.encounteredValues) {
            if(!a.matches(encounteredValue))
                return false;
        }

        return true;
    }

    if(a instanceof Argument) 
        return a.matches(b);

    if(b instanceof Argument)
        return b.matches(a);

    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;

    return a === b;
};