import { ProxyPropertyContext, ProxyCallRecord } from "./Context";
import { Arg } from "./Arguments";

export function stringifyArguments(args: any[]) {
    return args && args.length > 0 ? '[' + args + ']' : '(no arguments)';
};

export function stringifyCalls(propertyName: string, calls: ProxyCallRecord[]) {
    let output = '';
    for (let call of calls) {
        output += '\n-> ' + call.callCount + ' call(s) to ' + propertyName;
        if(call.property.type === 'function')
            output += ' with arguments ' + stringifyArguments(call.property.method.arguments);
    }

    return output;
};

export function areArgumentsEqual(a: any, b: any) {
    if(a instanceof Arg && b instanceof Arg)
        throw new Error('Can\'t compare two arguments of type Arg.');

    if(a instanceof Arg) 
        return a.matches(b);

    if(b instanceof Arg)
        return b.matches(a);

    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;

    if ((!a || !b) && a !== b)
        return false;

    if (Array.isArray(a) !== Array.isArray(b))
        return false;

    return a === b;
};