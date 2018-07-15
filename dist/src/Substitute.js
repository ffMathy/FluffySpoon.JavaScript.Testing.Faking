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
                    var existingCalls = objectContext.findActualMethodCalls(propertyContext.name, argumentsList);
                    if (existingCalls.length === 0)
                        return void 0;
                    var expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        expected.arguments = argumentsList;
                        expected.propertyName = propertyContext.name;
                        _this.assertCallMatchCount('method', expected, existingCalls);
                        return thisProxy;
                    }
                    var existingCall = existingCalls[0];
                    if (!existingCall)
                        return propertyContext.method.returnValues[0];
                    existingCall.callCount++;
                    if (propertyContext.method.returnValues)
                        return propertyContext.method.returnValues[existingCall.callCount - 1];
                    return void 0;
                }
                var newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;
                return thisProxy;
            },
            set: function (_target, property, value) {
                var propertyContext = objectContext.property;
                var argumentsList = [value];
                var existingCalls = objectContext.findActualMethodCalls(propertyContext.name, argumentsList);
                if (existingCalls.length > 0 && propertyContext.type === 'function') {
                    var expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        expected.arguments = argumentsList;
                        expected.propertyName = propertyContext.name;
                        _this.assertCallMatchCount('property', expected, existingCalls);
                        return true;
                    }
                    var existingCall = existingCalls[0];
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
                    if (currentPropertyContext.type === 'object') {
                        return function () {
                            var args = [];
                            for (var _i = 0; _i < arguments.length; _i++) {
                                args[_i] = arguments[_i];
                            }
                            currentPropertyContext.returnValues = args;
                            objectContext.getLastCall().callCount--;
                        };
                    }
                    if (currentPropertyContext.type === 'function') {
                        return function () {
                            var args = [];
                            for (var _i = 0; _i < arguments.length; _i++) {
                                args[_i] = arguments[_i];
                            }
                            currentPropertyContext.method.returnValues = args;
                            objectContext.getLastCall().callCount--;
                        };
                    }
                }
                if (property === 'received' || property === 'didNotReceive') {
                    return function (count) {
                        if (count === void 0)
                            count = null;
                        objectContext.setExpectations(count, property === 'didNotReceive');
                        return thisProxy;
                    };
                }
                var existingCall = objectContext.findActualPropertyCalls(property.toString())[0] || null;
                if (existingCall) {
                    var existingCallProperty = existingCall.property;
                    if (existingCallProperty.type === 'function')
                        return thisProxy;
                    var expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        expected.propertyName = existingCallProperty.name;
                        _this.assertCallMatchCount('property', expected, [existingCall]);
                        return thisProxy;
                    }
                    existingCall.callCount++;
                    if (!existingCallProperty.returnValues)
                        return void 0;
                    return existingCallProperty.returnValues[existingCall.callCount - 1];
                }
                var newPropertyContext = new Context_1.ProxyPropertyContext();
                newPropertyContext.name = property.toString();
                newPropertyContext.type = 'object';
                newPropertyContext.returnValues = null;
                objectContext.property = newPropertyContext;
                var call = objectContext.addActualPropertyCall();
                call.callCount++;
                return thisProxy;
            }
        });
    };
    Substitute.assertCallMatchCount = function (type, expected, existingCalls) {
        var existingCallCount = existingCalls.map(function (x) { return x.callCount; }).reduce(function (accumulator, value) { return accumulator + value; });
        var isMatch = !((!expected.negated && ((expected.callCount === null && existingCallCount === 0) ||
            (expected.callCount !== null && expected.callCount !== existingCallCount))) ||
            (expected.negated && ((expected.callCount === null && existingCallCount !== 0) ||
                (expected.callCount !== null && expected.callCount === existingCallCount))));
        if (!isMatch) {
            var errorMessage = '';
            errorMessage += expected.negated ? 'Did not expect' : 'Expected';
            errorMessage += ' ';
            errorMessage += expected.callCount === null ? 'one or more' : expected.callCount;
            errorMessage += ' call';
            errorMessage += (expected.callCount === null || expected.callCount !== 1) ? 's' : '';
            errorMessage += ' to the ';
            errorMessage += type;
            errorMessage += ' ';
            errorMessage += expected.propertyName;
            if (expected.arguments) {
                if (type === 'property') {
                    errorMessage += ' with value ';
                    var value = expected.arguments[0];
                    if (value === null)
                        errorMessage += 'null';
                    if (value === void 0)
                        errorMessage += 'undefined';
                    if (value)
                        errorMessage += value;
                }
                else if (type === 'method') {
                    errorMessage += ' with arguments ';
                    errorMessage += Utilities_1.stringifyArguments(expected.arguments);
                }
            }
            errorMessage += ', but received ';
            errorMessage += existingCallCount === 0 ? 'none' : existingCallCount;
            if (expected.arguments) {
                errorMessage += ' of such call';
                errorMessage += existingCallCount !== 1 ? 's' : '';
            }
            errorMessage += '.';
            if (expected.arguments) {
                errorMessage += '\nCalls received to ';
                errorMessage += type;
                errorMessage += ' ';
                errorMessage += expected.propertyName;
                errorMessage += ' in general: ';
                errorMessage += Utilities_1.stringifyCalls(existingCalls);
            }
            throw new Error(errorMessage);
        }
    };
    return Substitute;
}());
exports.Substitute = Substitute;
//# sourceMappingURL=Substitute.js.map