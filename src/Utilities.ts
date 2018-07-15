import { ProxyPropertyContext, ProxyCallRecord } from "./Context";
import { Arg, Argument } from "./Arguments";

export function stringifyArguments(args: any[]) {
    return args && args.length > 0 ? '[' + args + ']' : '(no arguments)';
};

export function stringifyCalls(calls: ProxyCallRecord[]) {
    calls = calls.filter(x => x.callCount > 0);

    if(calls.length === 0)
        return '(no calls)';

    let output = '';
    for (let call of calls) {
        output += '\n-> ' + call.callCount + ' call';
        output += call.callCount !== 1 ? 's' : '';

        if(call.property.type === 'function') 
            output += ' with arguments ' + stringifyArguments(call.property.method.arguments);
    }

    return output;
};

export function areArgumentsEqual(a: any, b: any) {
    if(a instanceof Argument && b instanceof Argument)
        return a.matches(b) && b.matches(a);

    if(a instanceof Argument) 
        return a.matches(b);

    if(b instanceof Argument)
        return b.matches(a);

    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;

    if ((!a || !b) && a !== b)
        return false;

    if (Array.isArray(a) !== Array.isArray(b))
        return false;

    return a === b;
};