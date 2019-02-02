"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Utilities_1 = require("../Utilities");
var Nothing = Symbol();
var FunctionState = /** @class */ (function () {
    function FunctionState(_getPropertyState) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        this._getPropertyState = _getPropertyState;
        this._arguments = args;
        this.returns = Nothing;
        this._callCount = 0;
    }
    Object.defineProperty(FunctionState.prototype, "arguments", {
        get: function () {
            return this._arguments;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(FunctionState.prototype, "callCount", {
        get: function () {
            return this._callCount;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(FunctionState.prototype, "property", {
        get: function () {
            return this._getPropertyState.property;
        },
        enumerable: true,
        configurable: true
    });
    FunctionState.prototype.apply = function (context, args) {
        var callCount = this._callCount;
        var hasExpectations = context.initialState.hasExpectations;
        if (hasExpectations) {
            callCount = this._getPropertyState
                .recordedFunctionStates
                .filter(function (x) { return Utilities_1.areArgumentArraysEqual(x.arguments, args); })
                .map(function (x) { return x.callCount; })
                .reduce(function (a, b) { return a + b; }, 0);
        }
        context.initialState.assertCallCountMatchesExpectations(this._getPropertyState.recordedFunctionStates, callCount, 'method', this.property, args);
        if (!hasExpectations)
            this._callCount++;
        if (this.mimicks)
            return this.mimicks.apply(this.mimicks, args);
        if (this.returns === Nothing)
            return context.proxy;
        var returnsArray = this.returns;
        if (returnsArray.length === 1)
            return returnsArray[0];
        return returnsArray[this._callCount - 1];
    };
    FunctionState.prototype.set = function (context, property, value) {
    };
    FunctionState.prototype.get = function (context, property) {
        var _this = this;
        if (property === 'then')
            return void 0;
        if (property === 'mimicks') {
            return function (input) {
                // console.log('mimicks', input);
                _this.mimicks = input;
                _this._callCount--;
                context.state = context.initialState;
            };
        }
        if (property === 'returns') {
            if (this.returns !== Nothing)
                throw new Error('The return value for the function ' + this._getPropertyState.toString() + ' with ' + Utilities_1.stringifyArguments(this._arguments) + ' has already been set to ' + this.returns);
            return function () {
                // console.log('returns', returns);
                var returns = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    returns[_i] = arguments[_i];
                }
                _this.returns = returns;
                _this._callCount--;
                context.state = context.initialState;
            };
        }
        return context.proxy;
    };
    return FunctionState;
}());
exports.FunctionState = FunctionState;
//# sourceMappingURL=FunctionState.js.map