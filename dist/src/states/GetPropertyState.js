"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var FunctionState_1 = require("./FunctionState");
var Nothing = Symbol();
var GetPropertyState = /** @class */ (function () {
    function GetPropertyState(_property) {
        this._property = _property;
        this.returns = Nothing;
        this.mimicks = null;
        this._callCount = 0;
    }
    Object.defineProperty(GetPropertyState.prototype, "isFunction", {
        get: function () {
            return !!this._functionState;
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
    Object.defineProperty(GetPropertyState.prototype, "functionState", {
        get: function () {
            return this._functionState;
        },
        enumerable: true,
        configurable: true
    });
    GetPropertyState.prototype.apply = function (context, args) {
        this._callCount = 0;
        if (this.functionState) {
            context.state = this.functionState;
            return this.functionState.apply(context, args);
        }
        var functionState = new FunctionState_1.FunctionState(this);
        context.state = functionState;
        this._functionState = functionState;
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
        context.initialState.assertCallCountMatchesExpectations([[]], // I'm not sure what this was supposed to mean
        this.callCount, 'property', this.property, []);
        return context.proxy;
    };
    return GetPropertyState;
}());
exports.GetPropertyState = GetPropertyState;
//# sourceMappingURL=GetPropertyState.js.map