"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ReceivedState = /** @class */ (function () {
    function ReceivedState(count) {
        this.count = count;
    }
    ReceivedState.prototype.apply = function (context, args) {
        var count = args[0];
        return context.proxy;
    };
    ReceivedState.prototype.set = function (context, property, value) {
    };
    ReceivedState.prototype.get = function (context, property) {
        return context.proxy;
    };
    return ReceivedState;
}());
exports.ReceivedState = ReceivedState;
//# sourceMappingURL=ReceivedState.js.map