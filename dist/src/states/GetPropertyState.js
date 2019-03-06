"use strict";
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spread = (this && this.__spread) || function () {
    for (var ar = [], i = 0; i < arguments.length; i++) ar = ar.concat(__read(arguments[i]));
    return ar;
};
Object.defineProperty(exports, "__esModule", { value: true });
var FunctionState_1 = require("./FunctionState");
var Utilities_1 = require("../Utilities");
var Nothing = Symbol();
var GetPropertyState = /** @class */ (function () {
    function GetPropertyState(_property) {
        this._property = _property;
        this.returns = Nothing;
        this.mimicks = null;
        this._recordedFunctionStates = [];
        this._callCount = 0;
    }
    Object.defineProperty(GetPropertyState.prototype, "isFunction", {
        get: function () {
            return this._recordedFunctionStates.length > 0;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GetPropertyState.prototype, "property", {
        get: function () {
            return this._property;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GetPropertyState.prototype, "callCount", {
        get: function () {
            return this._callCount;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(GetPropertyState.prototype, "recordedFunctionStates", {
        get: function () {
            return this._recordedFunctionStates;
        },
        enumerable: true,
        configurable: true
    });
    GetPropertyState.prototype.apply = function (context, args) {
        this._callCount = 0;
        var matchingFunctionStates = this._recordedFunctionStates
            .filter(function (x) { return Utilities_1.areArgumentArraysEqual(x.arguments, args); });
        if (matchingFunctionStates.length > 0) {
            var matchingFunctionState = matchingFunctionStates[0];
            return matchingFunctionState.apply(context, args, matchingFunctionStates);
        }
        var functionState = new (FunctionState_1.FunctionState.bind.apply(FunctionState_1.FunctionState, __spread([void 0, this], args)))();
        context.state = functionState;
        this._recordedFunctionStates.push(functionState);
        return context.apply(args);
    };
    GetPropertyState.prototype.set = function (context, property, value) {
    };
    GetPropertyState.prototype.get = function (context, property) {
        var _this = this;
        var hasExpectations = context.initialState.hasExpectations;
        if (property === 'then')
            return void 0;
        if (this.isFunction)
            return context.proxy;
        if (property === 'mimicks') {
            return function (input) {
                _this.mimicks = input;
                _this._callCount--;
                context.state = context.initialState;
            };
        }
        if (property === 'returns') {
            if (this.returns !== Nothing)
                throw new Error('The return value for the property ' + this._property.toString() + ' has already been set to ' + this.returns);
            return function () {
                var returns = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    returns[_i] = arguments[_i];
                }
                _this.returns = returns;
                _this._callCount--;
                context.state = context.initialState;
            };
        }
        if (!hasExpectations) {
            this._callCount++;
            if (this.mimicks)
                return this.mimicks.apply(this.mimicks);
            if (this.returns !== Nothing) {
                var returnsArray = this.returns;
                if (returnsArray.length === 1)
                    return returnsArray[0];
                return returnsArray[this._callCount - 1];
            }
        }
        context.initialState.assertCallCountMatchesExpectations(context.initialState.getPropertyStates, this.callCount, 'property', this.property, []);
        return context.proxy;
    };
    return GetPropertyState;
}());
exports.GetPropertyState = GetPropertyState;
//# sourceMappingURL=GetPropertyState.js.map