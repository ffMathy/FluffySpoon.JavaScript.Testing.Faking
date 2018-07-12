"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Arg = /** @class */ (function () {
    function Arg(description, matchingFunction) {
        this.description = description;
        this.matchingFunction = matchingFunction;
    }
    Arg.prototype.matches = function (arg) {
        return this.matchingFunction(arg);
    };
    Arg.prototype.toString = function () {
        return this.description;
    };
    Arg.prototype.inspect = function () {
        return this.description;
    };
    Arg.any = function (type) {
        var description = !type ? '{any arg}' : '{arg matching ' + type + '}';
        return new Arg(description, function (x) {
            if (typeof type !== 'string')
                return true;
            if (type === 'array')
                return x && Array.isArray(x);
            return typeof x === type;
        });
    };
    Arg.is = function (predicateOrValue) {
        if (typeof predicateOrValue === 'function')
            return new Arg('{arg matching predicate ' + this.toStringify(predicateOrValue) + '}', predicateOrValue);
        return new Arg('{arg matching ' + this.toStringify(predicateOrValue) + '}', function (x) { return x === predicateOrValue; });
    };
    Arg.toStringify = function (obj) {
        if (typeof obj.inspect === 'function')
            return obj.inspect();
        if (typeof obj.toString === 'function')
            return obj.toString();
        return obj;
    };
    return Arg;
}());
exports.Arg = Arg;
//# sourceMappingURL=Arguments.js.map