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
var PropertyState = /** @class */ (function () {
    function PropertyState(_property) {
        this._property = _property;
        this.returns = Nothing;
        this.recordedFunctionStates = [];
    }
    Object.defineProperty(PropertyState.prototype, "isFunction", {
        get: function () {
            return this.recordedFunctionStates.length > 0;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(PropertyState.prototype, "property", {
        get: function () {
            return this._property;
        },
        enumerable: true,
        configurable: true
    });
    PropertyState.prototype.apply = function (context, args) {
        this.callCount = 0;
        var matchingFunctionState = this.recordedFunctionStates.find(function (x) {
            if (args.length !== x.arguments.length)
                return false;
            for (var i = 0; i < args.length; i++) {
                if (!Utilities_1.areArgumentsEqual(args[i], x.arguments[i]))
                    return false;
            }
            return true;
        });
        if (matchingFunctionState) {
            console.log('ex-func');
            return matchingFunctionState.apply(context);
        }
        var functionState = new (FunctionState_1.FunctionState.bind.apply(FunctionState_1.FunctionState, __spread([void 0, this._property], args)))();
        context.state = functionState;
        this.recordedFunctionStates.push(functionState);
        return context.apply(args);
    };
    PropertyState.prototype.set = function (context, property, value) {
    };
    PropertyState.prototype.get = function (context, property) {
        var _this = this;
        if (this.isFunction)
            return context.proxy;
        if (!context.initialState.doesCallCountMatchExpectations(this.callCount)) {
            throw new Error('Expected ' + context.initialState.expectedCount);
        }
        if (property === 'returns') {
            if (this.returns !== Nothing)
                throw new Error('The return value for the property ' + this._property.toString() + ' has already been set to ' + this.returns);
            return function (returns) {
                console.log('returns', returns);
                _this.returns = returns;
                _this.callCount--;
                context.state = context.initialState;
            };
        }
        this.callCount++;
        if (this.returns !== Nothing)
            return this.returns[this.callCount - 1];
        return context.proxy;
    };
    return PropertyState;
}());
exports.PropertyState = PropertyState;
//# sourceMappingURL=PropertyState.js.map