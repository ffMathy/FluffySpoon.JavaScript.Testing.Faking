"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Utilities_1 = require("../Utilities");
var Nothing = Symbol();
var SetPropertyState = /** @class */ (function () {
    function SetPropertyState(_property) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        this._property = _property;
        this._arguments = args;
        this._callCount = 0;
    }
    Object.defineProperty(SetPropertyState.prototype, "arguments", {
        get: function () {
            return this._arguments;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SetPropertyState.prototype, "property", {
        get: function () {
            return this._property;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SetPropertyState.prototype, "callCount", {
        get: function () {
            return this._callCount;
        },
        enumerable: true,
        configurable: true
    });
    SetPropertyState.prototype.apply = function (context) {
        return void 0;
    };
    SetPropertyState.prototype.set = function (context, property, value) {
        var callCount = this._callCount;
        var hasExpectations = context.initialState.hasExpectations;
        if (hasExpectations) {
            callCount = context.initialState
                .setPropertyStates
                .filter(function (x) { return Utilities_1.areArgumentsEqual(x.arguments[0], value); })
                .map(function (x) { return x._callCount; })
                .reduce(function (a, b) { return a + b; }, 0);
        }
        context.initialState.assertCallCountMatchesExpectations(context.initialState.setPropertyStates, callCount, 'property', this.property, this.arguments);
        if (!hasExpectations) {
            this._callCount++;
        }
    };
    SetPropertyState.prototype.get = function (context, property) {
        return void 0;
    };
    return SetPropertyState;
}());
exports.SetPropertyState = SetPropertyState;
//# sourceMappingURL=SetPropertyState.js.map