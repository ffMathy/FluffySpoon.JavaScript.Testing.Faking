"use strict";
var __values = (this && this.__values) || function (o) {
    var m = typeof Symbol === "function" && o[Symbol.iterator], i = 0;
    if (m) return m.call(o);
    return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
};
Object.defineProperty(exports, "__esModule", { value: true });
var Arguments_1 = require("./Arguments");
var util = require("util");
function stringifyArguments(args) {
    console.log('stringifyArguments');
    args = args.map(function (x) { return util.inspect(x); });
    return args && args.length > 0 ? 'arguments [' + args.join(', ') + ']' : 'no arguments';
}
exports.stringifyArguments = stringifyArguments;
;
function areArgumentArraysEqual(a, b) {
    console.log('are equal?', a, b);
    for (var i = 0; i < Math.min(b.length, a.length); i++) { // @TODO should be Math.max I think -- domasx2
        if (!areArgumentsEqual(b[i], a[i]))
            return false;
    }
    return true;
}
exports.areArgumentArraysEqual = areArgumentArraysEqual;
function stringifyCalls(calls) {
    var e_1, _a;
    if (calls.length === 0)
        return ' (no calls)';
    var output = '';
    try {
        for (var calls_1 = __values(calls), calls_1_1 = calls_1.next(); !calls_1_1.done; calls_1_1 = calls_1.next()) {
            var call = calls_1_1.value;
            output += '\n-> call with ' + (call.length ? stringifyArguments(call) : '(no arguments)');
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (calls_1_1 && !calls_1_1.done && (_a = calls_1.return)) _a.call(calls_1);
        }
        finally { if (e_1) throw e_1.error; }
    }
    return output;
}
exports.stringifyCalls = stringifyCalls;
;
function areArgumentsEqual(a, b) {
    if (a instanceof Arguments_1.AllArguments || b instanceof Arguments_1.AllArguments)
        return true;
    if (a instanceof Arguments_1.Argument && b instanceof Arguments_1.Argument) {
        throw new Error("`Argument` should only be used to set up value or verify, not in the implementation.");
    }
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