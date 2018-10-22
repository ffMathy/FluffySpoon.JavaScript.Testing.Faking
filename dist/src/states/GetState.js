"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var FunctionState_1 = require("./FunctionState");
var Nothing = Symbol();
var PropertyState = /** @class */ (function () {
    function PropertyState() {
        this.returns = Nothing;
        this.isFunction = false;
    }
    PropertyState.prototype.apply = function (context, args) {
        this.isFunction = true;
        var functionState = new FunctionState_1.FunctionState();
        context.state = functionState;
        return functionState.apply(context, args);
    };
    PropertyState.prototype.set = function (context, property, value) {
    };
    PropertyState.prototype.get = function (context, property) {
        var _this = this;
        if (this.isFunction)
            return context.proxy;
        if (property === 'returns') {
            return function (returns) {
                _this.returns = returns;
            };
        }
        if (this.returns !== Nothing)
            return this.returns;
        return context.proxy;
    };
    return PropertyState;
}());
exports.PropertyState = PropertyState;
//# sourceMappingURL=GetState.js.map