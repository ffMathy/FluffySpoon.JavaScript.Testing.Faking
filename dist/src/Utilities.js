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
        if (call.property.type === 'function')
            output += ' with arguments ' + stringifyArguments(call.property.method.arguments);
    }
    return output;
}
exports.stringifyCalls = stringifyCalls;
;
function areArgumentsEqual(a, b) {
    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;
    if ((!a || !b) && a !== b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    return a === b;
}
exports.areArgumentsEqual = areArgumentsEqual;
;
//# sourceMappingURL=Utilities.js.map