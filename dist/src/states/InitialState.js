"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var PropertyState_1 = require("./PropertyState");
var InitialState = /** @class */ (function () {
    function InitialState() {
        this.recordedGetStates = new Map();
        this._expectedCount = void 0;
    }
    Object.defineProperty(InitialState.prototype, "expectedCount", {
        get: function () {
            return this._expectedCount;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(InitialState.prototype, "hasExpectations", {
        get: function () {
            return this._expectedCount !== void 0;
        },
        enumerable: true,
        configurable: true
    });
    InitialState.prototype.doesCallCountMatchExpectations = function (callCount) {
        if (!this.hasExpectations)
            return true;
        if (this.expectedCount === null && callCount > 0)
            return true;
        return this.expectedCount === callCount;
    };
    InitialState.prototype.apply = function (context, args) {
    };
    InitialState.prototype.set = function (context, property, value) {
    };
    InitialState.prototype.get = function (context, property) {
        var _this = this;
        if (typeof property === 'symbol') {
            if (property === Symbol.toPrimitive)
                return function () { return void 0; };
            if (property === Symbol.toStringTag)
                return void 0;
        }
        if (property === 'valueOf')
            return void 0;
        if (property === 'toString')
            return '{SubstituteJS fake}';
        if (property === 'inspect')
            return function () { return '{SubstituteJS fake}'; };
        if (property === 'constructor')
            return function () { return context.proxy; };
        if (property === 'then')
            return void 0;
        if (property === 'received') {
            return function (count) {
                console.log('expectation', count);
                _this._expectedCount = count === void 0 ? null : count;
                return context.proxy;
            };
        }
        var existingGetState = this.recordedGetStates.get(property);
        if (existingGetState) {
            context.state = existingGetState;
            return context.get(property);
        }
        if (this.hasExpectations)
            throw new Error('No calls were made to property or method ' + property.toString() + ' but ' + this._expectedCount + ' calls were expected.');
        var getState = new PropertyState_1.PropertyState(property);
        context.state = getState;
        this.recordedGetStates.set(property, getState);
        return context.get(property);
    };
    return InitialState;
}());
exports.InitialState = InitialState;
//# sourceMappingURL=InitialState.js.map