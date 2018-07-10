import { ProxyPropertyContext, ProxyCallRecord } from "./Context";

export function stringifyArguments(args: any[]) {
    return args && args.length > 0 ? '[' + args + ']' : '(no arguments)';
};

export function stringifyCalls(property: ProxyPropertyContext, calls: ProxyCallRecord[]) {
    let output = '';
    for (let call of calls) {
        output += '\n-> ' + call.callCount + ' call(s) to ' + property.name;
        if(call.property.type === 'function')
            output += ' with arguments ' + stringifyArguments(call.property.method.arguments);
    }

    return output;
};

export function areArgumentsEqual(a: any, b: any) {
    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;

    if ((!a || !b) && a !== b)
        return false;

    if (Array.isArray(a) !== Array.isArray(b))
        return false;

    return a === b;
};