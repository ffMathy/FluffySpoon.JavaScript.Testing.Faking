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
var Utilities_1 = require("../Utilities");
var Arguments_1 = require("../Arguments");
var Nothing = Symbol();
var FunctionState = /** @class */ (function () {
    function FunctionState(_getPropertyState) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        this._getPropertyState = _getPropertyState;
        this.returns = Nothing;
        this.mimicks = null;
        this._arguments = args;
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
    FunctionState.prototype.apply = function (context, args, matchingFunctionStates) {
        var e_1, _a, e_2, _b;
        var callCount = this._callCount;
        var hasExpectations = context.initialState.hasExpectations;
        if (!matchingFunctionStates) {
            matchingFunctionStates = this._getPropertyState
                .recordedFunctionStates
                .filter(function (x) { return Utilities_1.areArgumentArraysEqual(x.arguments, args); });
        }
        if (hasExpectations) {
            callCount = matchingFunctionStates
                .filter(function (x) { return x._arguments[0] !== Arguments_1.Arg.all(); })
                .map(function (x) { return x.callCount; })
                .reduce(function (a, b) { return a + b; }, 0);
        }
        context.initialState.assertCallCountMatchesExpectations(this._getPropertyState.recordedFunctionStates, callCount, 'method', this.property, args);
        if (!hasExpectations) {
            this._callCount++;
            try {
                for (var matchingFunctionStates_1 = __values(matchingFunctionStates), matchingFunctionStates_1_1 = matchingFunctionStates_1.next(); !matchingFunctionStates_1_1.done; matchingFunctionStates_1_1 = matchingFunctionStates_1.next()) {
                    var matchingFunctionState = matchingFunctionStates_1_1.value;
                    try {
                        for (var _c = __values(matchingFunctionState.arguments), _d = _c.next(); !_d.done; _d = _c.next()) {
                            var argument = _d.value;
                            if (!(argument instanceof Arguments_1.Argument))
                                continue;
                            var indexOffset = matchingFunctionState
                                .arguments
                                .indexOf(argument);
                            var myArg = args[indexOffset];
                            if (myArg instanceof Arguments_1.Argument)
                                continue;
                            argument.encounteredValues.push(myArg);
                        }
                    }
                    catch (e_2_1) { e_2 = { error: e_2_1 }; }
                    finally {
                        try {
                            if (_d && !_d.done && (_b = _c.return)) _b.call(_c);
                        }
                        finally { if (e_2) throw e_2.error; }
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (matchingFunctionStates_1_1 && !matchingFunctionStates_1_1.done && (_a = matchingFunctionStates_1.return)) _a.call(matchingFunctionStates_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
        }
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
                _this.mimicks = input;
                _this._callCount--;
                context.state = context.initialState;
            };
        }
        if (property === 'returns') {
            if (this.returns !== Nothing)
                throw new Error('The return value for the function ' + this._getPropertyState.toString() + ' with ' + Utilities_1.stringifyArguments(this._arguments) + ' has already been set to ' + this.returns);
            return function () {
                var returns = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    returns[_i] = arguments[_i];
                }
                _this.returns = returns;
                _this._callCount--;
                if (_this._callCount === 0) {
                    // var indexOfSelf = this
                    //     ._getPropertyState
                    //     .recordedFunctionStates
                    //     .indexOf(this);
                    // this._getPropertyState
                    //     .recordedFunctionStates
                    //     .splice(indexOfSelf, 1);
                }
                context.state = context.initialState;
            };
        }
        return context.proxy;
    };
    return FunctionState;
}());
exports.FunctionState = FunctionState;
//# sourceMappingURL=FunctionState.js.map