"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Arguments_1 = require("./Arguments");
function stringifyArguments(args) {
    return args && args.length > 0 ? 'arguments [' + args.join(', ') + ']' : 'no arguments';
}
exports.stringifyArguments = stringifyArguments;
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