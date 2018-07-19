"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Arguments_1 = require("./Arguments");
function stringifyArguments(args) {
    return args && args.length > 0 ? '[' + args + ']' : '(no arguments)';
}
exports.stringifyArguments = stringifyArguments;
;
function stringifyCalls(calls) {
    calls = calls.filter(function (x) { return x.callCount > 0; });
    if (calls.length === 0)
        return '(no calls)';
    var output = '';
    for (var _i = 0, calls_1 = calls; _i < calls_1.length; _i++) {
        var call = calls_1[_i];
        output += '\n-> ' + call.callCount + ' call';
        output += call.callCount !== 1 ? 's' : '';
        if (call.property.type === 'function')
            output += ' with arguments ' + stringifyArguments(call.property.method.arguments);
    }
    return output;
}
exports.stringifyCalls = stringifyCalls;
;
function areArgumentsEqual(a, b) {
    if (a instanceof Arguments_1.AllArguments || b instanceof Arguments_1.AllArguments)
        return true;
    if (a instanceof Arguments_1.Argument && b instanceof Arguments_1.Argument)
        return a.matches(b) && b.matches(a);
    if (a instanceof Arguments_1.Argument)
        return a.matches(b);
    if (b instanceof Arguments_1.Argument)
        return b.matches(a);
    if ((typeof a === 'undefined' || a === null) && (typeof b === 'undefined' || b === null))
        return true;
    return a === b;
}
exports.areArgumentsEqual = areArgumentsEqual;
;
//# sourceMappingURL=Utilities.js.map