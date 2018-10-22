"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var InitialState_1 = require("./states/InitialState");
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
                return _this_1.set(property, value);
            },
            get: function (_target, property) {
                return _this_1.get(property);
            }
        });
    }
    Context.prototype.apply = function (args) {
        console.log('apply', args);
        return this._state.apply(this, args);
    };
    Context.prototype.set = function (property, value) {
        console.log('set', property, value);
        return this._state.set(this, property, value);
    };
    Context.prototype.get = function (property) {
        var uninterestingProperties = [
            '$$typeof',
            'constructor'
        ];
        if (typeof property !== 'symbol' && uninterestingProperties.indexOf(property.toString()) === -1)
            console.log('get', property);
        return this._state.get(this, property);
    };
    Object.defineProperty(Context.prototype, "proxy", {
        get: function () {
            return this._proxy;
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
            this._state = state;
            console.log('state', state);
        },
        enumerable: true,
        configurable: true
    });
    return Context;
}());
exports.Context = Context;
//# sourceMappingURL=Context.js.map