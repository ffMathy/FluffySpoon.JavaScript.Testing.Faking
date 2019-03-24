"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
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
var AllArguments = /** @class */ (function (_super) {
    __extends(AllArguments, _super);
    function AllArguments() {
        return _super.call(this, '{all}', function () { return true; }) || this;
    }
    return AllArguments;
}(Argument));
exports.AllArguments = AllArguments;
var Arg = /** @class */ (function () {
    function Arg() {
    }
    Arg.all = function () {
        return this._all = (this._all || new AllArguments());
    };
    Arg.any = function (type) {
        var description = !type ? '{any arg}' : '{type ' + type + '}';
        return new Argument(description, function (x) {
            if (!type)
                return true;
            if (typeof x === 'undefined')
                return true;
            if (type === 'array')
                return x && Array.isArray(x);
            return typeof x === type;
        });
    };
    Arg.is = function (predicate) {
        return new Argument('{predicate ' + this.toStringify(predicate) + '}', predicate);
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