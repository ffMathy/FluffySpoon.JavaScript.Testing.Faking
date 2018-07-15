"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Arg = /** @class */ (function () {
    function Arg() {
    }
    Arg.any = function (type) {
        var description = !type ? '{any arg}' : '{arg matching ' + type + '}';
        return new Argument(description, function (x) {
            if (typeof type === 'string')
                return true;
            if (typeof type === 'undefined')
                return true;
            if (type === 'array')
                return x && Array.isArray(x);
            return typeof x === type;
        });
    };
    Arg.is = function (predicate) {
        return new Argument('{arg matching predicate ' + this.toStringify(predicate) + '}', predicate);
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
var Argument = /** @class */ (function () {
    function Argument(description, matchingFunction) {
        this.description = description;
        this.matchingFunction = matchingFunction;
    }
    Argument.prototype.matches = function (arg) {
        return this.matchingFunction(arg);
    };
    Argument.prototype.toString = function () {
        return this.description;
    };
    Argument.prototype.inspect = function () {
        return this.description;
    };
    return Argument;
}());
exports.Argument = Argument;
//# sourceMappingURL=Arguments.js.map