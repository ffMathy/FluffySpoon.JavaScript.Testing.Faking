"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Utilities_1 = require("../Utilities");
var Nothing = Symbol();
var FunctionState = /** @class */ (function () {
    function FunctionState(_property) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        this._property = _property;
        this._arguments = args;
        this.returns = Nothing;
        this.callCount = 0;
    }
    Object.defineProperty(FunctionState.prototype, "arguments", {
        get: function () {
            return this._arguments;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(FunctionState.prototype, "property", {
        get: function () {
            return this._property;
        },
        enumerable: true,
        configurable: true
    });
    FunctionState.prototype.apply = function (context) {
        if (!context.initialState.doesCallCountMatchExpectations(this.callCount)) {
            throw new Error('Expected ' + context.initialState.expectedCount);
        }
        this.callCount++;
        if (this.returns === Nothing)
            return context.rootProxy;
        return this.returns[this.callCount - 1];
    };
    FunctionState.prototype.set = function (context, property, value) {
    };
    FunctionState.prototype.get = function (context, property) {
        var _this = this;
        if (property === 'returns') {
            if (this.returns !== Nothing)
                throw new Error('The return value for the function ' + this._property.toString() + ' with ' + Utilities_1.stringifyArguments(this._arguments) + ' has already been set to ' + this.returns);
            return function () {
                var returns = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    returns[_i] = arguments[_i];
                }
                console.log('returns', returns);
                _this.returns = returns;
                _this.callCount--;
                context.state = context.initialState;
            };
        }
        return context.proxy;
    };
    return FunctionState;
}());
exports.FunctionState = FunctionState;
//# sourceMappingURL=FunctionState.js.map