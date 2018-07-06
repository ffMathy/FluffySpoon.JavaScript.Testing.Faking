"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Substitute = /** @class */ (function () {
    function Substitute() {
    }
    Substitute.for = function () {
        var lastRecord;
        var createRecord = function () {
            lastRecord = {
                arguments: null,
                shouldReturn: [],
                proxy: null,
                currentReturnOffset: 0,
                property: null
            };
            return lastRecord;
        };
        var equals = function (a, b) {
            if ((!a || !b) && a !== b)
                return false;
            if (typeof a !== typeof b)
                return false;
            if (Array.isArray(a) !== Array.isArray(b))
                return false;
            if (Array.isArray(a) && Array.isArray(b)) {
                if (a.length !== b.length)
                    return false;
                for (var i = 0; i < a.length; i++) {
                    if (!equals(a[i], b[i]))
                        return false;
                }
                return true;
            }
            return a === b;
        };
        var createProxy = function (r) {
            if (r === void 0) { r = null; }
            var localRecord = r;
            var thisProxy;
            return thisProxy = new Proxy(function () { }, {
                apply: function (_target, _thisArg, argumentsList) {
                    if (localRecord.arguments) {
                        if (!equals(localRecord.arguments, argumentsList))
                            return void 0;
                        return localRecord.shouldReturn[localRecord.currentReturnOffset++];
                    }
                    localRecord.arguments = argumentsList;
                    return thisProxy;
                },
                get: function (target, property) {
                    if (typeof property === 'symbol') {
                        if (property === Symbol.toPrimitive)
                            return function () { return void 0; };
                        return void 0;
                    }
                    if (property === 'valueOf')
                        return void 0;
                    if (property === 'toString')
                        return (target[property] || '').toString();
                    if (property === 'inspect')
                        return function () { return "{SubstituteJS fake}"; };
                    if (property === 'constructor')
                        return function () { return thisProxy; };
                    if (property === 'returns')
                        return function () {
                            var args = [];
                            for (var _i = 0; _i < arguments.length; _i++) {
                                args[_i] = arguments[_i];
                            }
                            return localRecord.shouldReturn = args;
                        };
                    if (localRecord && localRecord.property === property) {
                        if (localRecord.arguments)
                            return thisProxy;
                        return localRecord.shouldReturn[localRecord.currentReturnOffset++];
                    }
                    localRecord = createRecord();
                    localRecord.property = property;
                    return thisProxy;
                }
            });
        };
        return createProxy();
    };
    return Substitute;
}());
exports.Substitute = Substitute;
//# sourceMappingURL=index.js.map