export function stringifyArguments(args: any[]) {
    return args && args.length > 0 ? '[' + args + ']' : '(no arguments)';
};

export function stringifyCalls(property: ProxyPropertyContext, calls: ProxyCallRecord[]) {
    let output = '';
    for (let call of calls) {
        output += '\n-> ' + call.callCount + ' call(s) to ' + property.name;
        if(call.arguments)
            output += ' with arguments ' + stringifyArguments(call.arguments);
    }

    return output;
};

export function findCallMatchingArguments(calls: ProxyCallRecord[], args: any[]) {
    let call = calls.filter(x => equals(x.arguments, args))[0];
    return call || null;
};

export function equals(a: any, b: any) {
    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;

    if ((!a || !b) && a !== b)
        return false;

    if (Array.isArray(a) !== Array.isArray(b))
        return false;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;

        for (let i = 0; i < a.length; i++) {
            if (!equals(a[i], b[i]))
                return false;
        }

        return true;
    }

    return a === b;
};