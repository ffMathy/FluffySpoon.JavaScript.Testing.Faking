"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var GetPropertyState_1 = require("./GetPropertyState");
var SetPropertyState_1 = require("./SetPropertyState");
var Utilities_1 = require("../Utilities");
var InitialState = /** @class */ (function () {
    function InitialState() {
        this.recordedGetPropertyStates = new Map();
        this.recordedSetPropertyStates = [];
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
        var existingSetState = this.recordedSetPropertyStates.find(function (x) { return Utilities_1.areArgumentArraysEqual(x.arguments, [value]); });
        ;
        if (existingSetState) {
            context.state = existingSetState;
            return context.set(property, value);
        }
        if (this.hasExpectations)
            throw new Error('No calls were made to property ' + property.toString() + ' but ' + this._expectedCount + ' calls were expected.');
        var setPropertyState = new SetPropertyState_1.SetPropertyState(property, value);
        context.state = setPropertyState;
        this.recordedSetPropertyStates.push(setPropertyState);
    };
    InitialState.prototype.get = function (context, property) {
        var _this = this;
        if (typeof property === 'symbol') {
            if (property === Symbol.toPrimitive)
                return function () { return '{SubstituteJS fake}'; };
            if (property === Symbol.iterator)
                return void 0;
            if (property === Symbol.toStringTag)
                return 'Substitute';
            if (property.toString() === 'Symbol(util.inspect.custom)')
                return void 0;
        }
        if (property === 'valueOf')
            return '{SubstituteJS fake}';
        if (property === '$$typeof')
            return '{SubstituteJS fake}';
        if (property === 'length')
            return '{SubstituteJS fake}';
        if (property === 'toString')
            return '{SubstituteJS fake}';
        if (property === 'inspect')
            return function () { return '{SubstituteJS fake}'; };
        if (property === 'constructor')
            return function () { return context.rootProxy; };
        if (property === 'received') {
            return function (count) {
                console.log('expectation', count);
                _this._expectedCount = count === void 0 ? null : count;
                return context.proxy;
            };
        }
        var existingGetState = this.recordedGetPropertyStates.get(property);
        if (existingGetState) {
            context.state = existingGetState;
            return context.get(property);
        }
        if (this.hasExpectations)
            throw new Error('No calls were made to property or method ' + property.toString() + ' but ' + this._expectedCount + ' calls were expected.');
        var getState = new GetPropertyState_1.GetPropertyState(property);
        context.state = getState;
        this.recordedGetPropertyStates.set(property, getState);
        return context.get(property);
    };
    return InitialState;
}());
exports.InitialState = InitialState;
//# sourceMappingURL=InitialState.js.map