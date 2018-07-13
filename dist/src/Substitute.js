"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Context_1 = require("./Context");
var Utilities_1 = require("./Utilities");
var Substitute = /** @class */ (function () {
    function Substitute() {
    }
    Substitute.for = function () {
        var _this = this;
        var objectContext = new Context_1.ProxyObjectContext();
        var thisProxy;
        return thisProxy = new Proxy(function () { }, {
            apply: function (_target, _thisArg, argumentsList) {
                var propertyContext = objectContext.property;
                if (propertyContext.type === 'function') {
                    var existingCall = objectContext.findActualMethodCall(propertyContext.name, argumentsList);
                    if (!existingCall)
                        return void 0;
                    var expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        if (!_this.doesExistingCallMatchCount(expected, existingCall))
                            throw new Error((expected.negated ? 'Dit not expect' : 'Expected') + ' ' + (expected.callCount === null ? 'more than 0' : expected.callCount) + ' call(s) to the method ' + existingCall.property.name + ' with arguments ' + Utilities_1.stringifyArguments(argumentsList) + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + Utilities_1.stringifyCalls(existingCall.property.name, objectContext.calls.actual));
                        return thisProxy;
                    }
                    var callCount = existingCall ? existingCall.callCount++ : 0;
                    return propertyContext.method.returnValues[callCount];
                }
                var newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;
                return thisProxy;
            },
            set: function (_target, property, value) {
                var propertyContext = objectContext.property;
                var argumentsList = [value];
                var existingCall = objectContext.findActualMethodCall(propertyContext.name, argumentsList);
                if (existingCall && propertyContext.type === 'function') {
                    var expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        console.log('find', '\n', propertyContext, '\n', existingCall);
                        console.log('expected', expected);
                        if (!_this.doesExistingCallMatchCount(expected, existingCall))
                            throw new Error((expected.negated ? 'Dit not expect' : 'Expected') + ' ' + (expected.callCount === null ? 'more than 0' : expected.callCount) + ' call(s) to the property ' + existingCall.property.name + ' with value [' + value + '], but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + Utilities_1.stringifyCalls(existingCall.property.name, objectContext.calls.actual));
                        return true;
                    }
                    existingCall.callCount++;
                    return true;
                }
                var newMethodPropertyContext = new Context_1.ProxyMethodPropertyContext();
                newMethodPropertyContext.name = property.toString();
                newMethodPropertyContext.type = 'function';
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = argumentsList;
                objectContext.property = newMethodPropertyContext;
                var call = objectContext.addActualPropertyCall();
                call.callCount = 1;
                return true;
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
                    return function () { return '{SubstituteJS fake}'; };
                if (property === 'constructor')
                    return function () { return thisProxy; };
                var currentPropertyContext = objectContext.property;
                if (property === 'returns') {
                    if (currentPropertyContext.type === 'object')
                        return function () {
                            var args = [];
                            for (var _i = 0; _i < arguments.length; _i++) {
                                args[_i] = arguments[_i];
                            }
                            return currentPropertyContext.returnValues = args;
                        };
                    if (currentPropertyContext.type === 'function')
                        return function () {
                            var args = [];
                            for (var _i = 0; _i < arguments.length; _i++) {
                                args[_i] = arguments[_i];
                            }
                            return currentPropertyContext.method.returnValues = args;
                        };
                }
                if (property === 'received' || property === 'didNotReceive') {
                    return function (count) {
                        if (count === void 0)
                            count = null;
                        objectContext.setExpectations(count, property === 'didNotReceive');
                        return thisProxy;
                    };
                }
                var existingCall = objectContext.findActualPropertyCall(property.toString());
                if (existingCall) {
                    var existingCallProperty = existingCall.property;
                    if (existingCallProperty.type === 'function')
                        return thisProxy;
                    var expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        if (!_this.doesExistingCallMatchCount(expected, existingCall))
                            throw new Error((expected.negated ? 'Dit not expect' : 'Expected') + ' ' + (expected.callCount === null ? 'more than 0' : expected.callCount) + ' call(s) to the property ' + existingCall.property.name + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + Utilities_1.stringifyCalls(existingCall.property.name, objectContext.calls.actual));
                        return thisProxy;
                    }
                    if (!existingCallProperty.returnValues)
                        return void 0;
                    return existingCallProperty.returnValues[existingCall.callCount++];
                }
                var newPropertyContext = new Context_1.ProxyPropertyContext();
                newPropertyContext.name = property.toString();
                newPropertyContext.type = 'object';
                newPropertyContext.returnValues = null;
                objectContext.property = newPropertyContext;
                objectContext.addActualPropertyCall();
                return thisProxy;
            }
        });
    };
    Substitute.doesExistingCallMatchCount = function (expected, existingCall) {
        return !((!expected.negated && ((expected.callCount === null && existingCall.callCount === 0) ||
            (expected.callCount !== null && expected.callCount !== existingCall.callCount))) ||
            (expected.negated && ((expected.callCount === null && existingCall.callCount !== 0) ||
                (expected.callCount !== null && expected.callCount === existingCall.callCount))));
    };
    return Substitute;
}());
exports.Substitute = Substitute;
//# sourceMappingURL=Substitute.js.map