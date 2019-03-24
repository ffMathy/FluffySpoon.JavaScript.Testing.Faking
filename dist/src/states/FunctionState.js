"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Utilities_1 = require("../Utilities");
var Nothing = Symbol();
var FunctionState = /** @class */ (function () {
    function FunctionState(_getPropertyState) {
        this._getPropertyState = _getPropertyState;
        this.returns = [];
        this.mimicks = null;
        this._calls = [];
    }
    Object.defineProperty(FunctionState.prototype, "calls", {
        get: function () {
            return this._calls;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(FunctionState.prototype, "callCount", {
        get: function () {
            return this._calls.length;
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
    FunctionState.prototype.getCallCount = function (args) {
        return this._calls.reduce(function (count, cargs) { return Utilities_1.areArgumentArraysEqual(cargs, args) ? count + 1 : count; }, 0);
    };
    FunctionState.prototype.apply = function (context, args) {
        var hasExpectations = context.initialState.hasExpectations;
        this._lastArgs = args;
        context.initialState.assertCallCountMatchesExpectations(this._calls, this.getCallCount(args), 'method', this.property, args);
        if (!hasExpectations) {
            this._calls.push(args);
        }
        if (!hasExpectations) {
            if (this.mimicks)
                return this.mimicks.apply(this.mimicks, args);
            if (!this.returns.length)
                return context.proxy;
            var returns = this.returns.find(function (r) { return Utilities_1.areArgumentArraysEqual(r.args, args); });
            if (returns) {
                var returnValues = returns.returnValues;
                if (returnValues.length === 1) {
                    return returnValues[0];
                }
                if (returnValues.length > returns.returnIndex) {
                    return returnValues[returns.returnIndex++];
                }
                return void 0; // probably a test setup error, imho throwin is more helpful -- domasx2
                //throw Error(`${String(this._getPropertyState.property)} with ${stringifyArguments(returns.args)} called ${returns.returnIndex + 1} times, but only ${returnValues.length} return values were set up`)
            }
        }
        return context.proxy;
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
                _this._calls.pop();
                context.state = context.initialState;
            };
        }
        if (property === 'returns') {
            return function () {
                var returns = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    returns[_i] = arguments[_i];
                }
                if (!_this._lastArgs) {
                    throw new Error('Eh, there\'s a bug, no args recorded for this return :/');
                }
                _this.returns.push({
                    returnValues: returns,
                    returnIndex: 0,
                    args: _this._lastArgs
                });
                _this._calls.pop();
                if (_this.callCount === 0) {
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