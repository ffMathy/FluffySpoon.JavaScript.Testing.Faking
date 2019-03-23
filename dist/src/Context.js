"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var InitialState_1 = require("./states/InitialState");
var Substitute_1 = require("./Substitute");
var Context = /** @class */ (function () {
    function Context() {
        var _this_1 = this;
        this._initialState = new InitialState_1.InitialState();
        this._state = this._initialState;
        this._proxy = new Proxy(function () { }, {
            apply: function (_target, _this, args) {
                return _this_1.apply(args);
            },
            set: function (_target, property, value) {
                _this_1.set(property, value);
                return true;
            },
            get: function (_target, property) {
                return _this_1.get(property);
            }
        });
        this._rootProxy = new Proxy(function () { }, {
            apply: function (_target, _this, args) {
                return _this_1.initialState.apply(_this_1, args);
            },
            set: function (_target, property, value) {
                _this_1.initialState.set(_this_1, property, value);
                return true;
            },
            get: function (_target, property) {
                return _this_1.initialState.get(_this_1, property);
            }
        });
    }
    Context.prototype.apply = function (args) {
        return this._state.apply(this, args);
    };
    Context.prototype.set = function (property, value) {
        return this._state.set(this, property, value);
    };
    Context.prototype.get = function (property) {
        if (property === Substitute_1.HandlerKey)
            return this;
        return this._state.get(this, property);
    };
    Object.defineProperty(Context.prototype, "proxy", {
        get: function () {
            return this._proxy;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Context.prototype, "rootProxy", {
        get: function () {
            return this._rootProxy;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Context.prototype, "initialState", {
        get: function () {
            return this._initialState;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Context.prototype, "state", {
        set: function (state) {
            if (this._state === state)
                return;
            this._state = state;
            if (state.onSwitchedTo)
                state.onSwitchedTo(this);
        },
        enumerable: true,
        configurable: true
    });
    return Context;
}());
exports.Context = Context;
//# sourceMappingURL=Context.js.map