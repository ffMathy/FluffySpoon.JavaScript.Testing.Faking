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
var GetPropertyState_1 = require("./GetPropertyState");
var SetPropertyState_1 = require("./SetPropertyState");
var Utilities_1 = require("../Utilities");
var Substitute_1 = require("../Substitute");
var InitialState = /** @class */ (function () {
    function InitialState() {
        this.recordedGetPropertyStates = new Map();
        this.recordedSetPropertyStates = [];
        this._areProxiesDisabled = false;
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
    Object.defineProperty(InitialState.prototype, "setPropertyStates", {
        get: function () {
            return __spread(this.recordedSetPropertyStates);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(InitialState.prototype, "getPropertyStates", {
        get: function () {
            return __spread(this.recordedGetPropertyStates.values());
        },
        enumerable: true,
        configurable: true
    });
    InitialState.prototype.assertCallCountMatchesExpectations = function (calls, callCount, type, property, args) {
        var expectedCount = this._expectedCount;
        this.clearExpectations();
        console.log('expected', expectedCount, 'actual', callCount);
        if (this.doesCallCountMatchExpectations(expectedCount, callCount))
            return;
        throw new Error('Expected ' + (expectedCount === null ? '1 or more' : expectedCount) + ' call' + (expectedCount === 1 ? '' : 's') + ' to the ' + type + ' ' + property.toString() + ' with ' + Utilities_1.stringifyArguments(args) + ', but received ' + (callCount === 0 ? 'none' : callCount) + ' of such call' + (callCount === 1 ? '' : 's') + '.\nAll calls received to ' + type + ' ' + property.toString() + ':' + Utilities_1.stringifyCalls(calls));
    };
    InitialState.prototype.doesCallCountMatchExpectations = function (expectedCount, actualCount) {
        if (expectedCount === void 0)
            return true;
        if (expectedCount === null && actualCount > 0)
            return true;
        return expectedCount === actualCount;
    };
    InitialState.prototype.apply = function (context, args) {
    };
    InitialState.prototype.set = function (context, property, value) {
        if (property === Substitute_1.AreProxiesDisabledKey) {
            this._areProxiesDisabled = value;
            return;
        }
        var existingSetState = this.recordedSetPropertyStates.find(function (x) { return x.arguments[0] === value; });
        ;
        if (existingSetState) {
            return existingSetState.set(context, property, value);
        }
        var setPropertyState = new SetPropertyState_1.SetPropertyState(property, value);
        context.state = setPropertyState;
        this.recordedSetPropertyStates.push(setPropertyState);
        setPropertyState.set(context, property, value);
    };
    InitialState.prototype.get = function (context, property) {
        var _this = this;
        if (typeof property === 'symbol') {
            if (property === Substitute_1.AreProxiesDisabledKey)
                return this._areProxiesDisabled;
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
                _this._expectedCount = count === void 0 ? null : count;
                return context.proxy;
            };
        }
        var existingGetState = this.recordedGetPropertyStates.get(property);
        if (existingGetState) {
            context.state = existingGetState;
            return context.get(property);
        }
        var getState = new GetPropertyState_1.GetPropertyState(property);
        context.state = getState;
        this.recordedGetPropertyStates.set(property, getState);
        return context.get(property);
    };
    InitialState.prototype.clearExpectations = function () {
        this._expectedCount = void 0;
    };
    InitialState.prototype.onSwitchedTo = function () {
        this.clearExpectations();
    };
    return InitialState;
}());
exports.InitialState = InitialState;
//# sourceMappingURL=InitialState.js.map