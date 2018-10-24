"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Nothing = Symbol();
var SetPropertyState = /** @class */ (function () {
    function SetPropertyState(_property) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        this._property = _property;
        this._arguments = args;
        this.callCount = 0;
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
    SetPropertyState.prototype.apply = function (context) {
        return void 0;
    };
    SetPropertyState.prototype.set = function (context, property, value) {
        if (!context.initialState.doesCallCountMatchExpectations(this.callCount)) {
            throw new Error('Expected ' + context.initialState.expectedCount);
        }
        this.callCount++;
    };
    SetPropertyState.prototype.get = function (context, property) {
        return void 0;
    };
    return SetPropertyState;
}());
exports.SetPropertyState = SetPropertyState;
//# sourceMappingURL=SetPropertyState.js.map