"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function stringifyArguments(args) {
    return args && args.length > 0 ? '[' + args + ']' : '(no arguments)';
}
exports.stringifyArguments = stringifyArguments;
;
function stringifyCalls(property, calls) {
    var output = '';
    for (var _i = 0, calls_1 = calls; _i < calls_1.length; _i++) {
        var call = calls_1[_i];
        output += '\n-> ' + call.callCount + ' call(s) to ' + property.name;
        if (call.arguments)
            output += ' with arguments ' + stringifyArguments(call.arguments);
    }
    return output;
}
exports.stringifyCalls = stringifyCalls;
;
function findCallMatchingArguments(calls, args) {
    var call = calls.filter(function (x) { return equals(x.arguments, args); })[0];
    return call || null;
}
exports.findCallMatchingArguments = findCallMatchingArguments;
;
function equals(a, b) {
    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;
    if ((!a || !b) && a !== b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        for (var i = 0; i < a.length; i++) {
            if (!equals(a[i], b[i]))
                return false;
        }
        return true;
    }
    return a === b;
}
exports.equals = equals;
;
//# sourceMappingURL=Utilities.js.map