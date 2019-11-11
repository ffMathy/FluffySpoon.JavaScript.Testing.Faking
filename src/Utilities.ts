import { Argument, AllArguments } from "./Arguments";
import util = require('util')

export type Call = any[] // list of args

export enum Type {
  method = 'method',
  property = 'property'
}

export function stringifyArguments(args: any[]) {
    args = args.map(x => util.inspect(x));
    return args && args.length > 0 ? 'arguments [' + args.join(', ') + ']' : 'no arguments';
};

export function areArgumentArraysEqual(a: any[], b: any[]) {
    if (a.find(x => x instanceof AllArguments) || b.find(b => b instanceof AllArguments)) {
        return true;
    }

    for (var i = 0; i < Math.max(b.length, a.length); i++) {
        if (!areArgumentsEqual(b[i], a[i])) {
            return false;
        }
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
    
    if(a instanceof Argument && b instanceof Argument) {
        return false;
    }

    if(a instanceof AllArguments || b instanceof AllArguments)
        return true;

    if(a instanceof Argument) 
        return a.matches(b);

    if(b instanceof Argument)
        return b.matches(a);

    return a === b;
};