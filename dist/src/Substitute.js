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
                var existingCalls = objectContext.findActualMethodCalls(propertyContext.name, argumentsList);
                var existingCall = existingCalls[0];
                var allCalls = objectContext.findActualMethodCalls(propertyContext.name);
                if (propertyContext.type === 'function') {
                    var expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        expected.arguments = argumentsList;
                        expected.propertyName = propertyContext.name;
                        _this.assertCallMatchCount('method', expected, allCalls, existingCalls);
                        return void 0;
                    }
                    if (existingCall) {
                        existingCall.callCount++;
                        if (existingCall.property.type === 'function') {
                            var mimicks = existingCall.property.method.mimicks;
                            if (mimicks)
                                return mimicks.call.apply(mimicks, [_target].concat(argumentsList));
                        }
                    }
                    else {
                        propertyContext.method.arguments = argumentsList;
                        objectContext.addActualPropertyCall();
                        return void 0;
                    }
                    if (propertyContext.method.returnValues)
                        return propertyContext.method.returnValues[existingCall.callCount - 1];
                    return void 0;
                }
                var newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;
                objectContext.fixExistingCallArguments();
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
                        _this.assertCallMatchCount('property', expected, objectContext.findActualMethodCalls(propertyContext.name), existingCalls);
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
                objectContext.addActualPropertyCall();
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
                    var createReturnsFunction = function (context) {
                        return function () {
                            var args = [];
                            for (var _i = 0; _i < arguments.length; _i++) {
                                args[_i] = arguments[_i];
                            }
                            context.returnValues = args;
                            context.mimicks = void 0;
                            objectContext.getLastCall().callCount--;
                        };
                    };
                    if (currentPropertyContext.type === 'object')
                        return createReturnsFunction(currentPropertyContext);
                    if (currentPropertyContext.type === 'function')
                        return createReturnsFunction(currentPropertyContext.method);
                }
                if (property === 'mimicks') {
                    var createMimicksFunction = function (context) {
                        return function (value) {
                            context.returnValues = void 0;
                            context.mimicks = value;
                            objectContext.getLastCall().callCount--;
                        };
                    };
                    if (currentPropertyContext.type === 'object')
                        return createMimicksFunction(currentPropertyContext);
                    if (currentPropertyContext.type === 'function') {
                        return createMimicksFunction(currentPropertyContext.method);
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
                        _this.assertCallMatchCount('property', expected, [existingCall], [existingCall]);
                        return thisProxy;
                    }
                    existingCall.callCount++;
                    if (existingCallProperty.returnValues)
                        return existingCallProperty.returnValues[existingCall.callCount - 1];
                    var mimicks = existingCallProperty.mimicks;
                    if (mimicks)
                        return mimicks();
                    return void 0;
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
    Substitute.assertCallMatchCount = function (type, expected, allCalls, matchingCalls) {
        var getCallCounts = function (calls) {
            var callCounts = calls.map(function (x) { return x.callCount; });
            var totalCallCount = callCounts.length === 0 ? 0 : callCounts.reduce(function (accumulator, value) { return accumulator + value; });
            return totalCallCount;
        };
        var matchingCallsCount = getCallCounts(matchingCalls);
        var isMatch = !((!expected.negated && ((expected.callCount === null && matchingCallsCount === 0) ||
            (expected.callCount !== null && expected.callCount !== matchingCallsCount))) ||
            (expected.negated && ((expected.callCount === null && matchingCallsCount !== 0) ||
                (expected.callCount !== null && expected.callCount === matchingCallsCount))));
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
                    errorMessage += ' with ';
                    errorMessage += Utilities_1.stringifyArguments(expected.arguments);
                }
            }
            errorMessage += ', but received ';
            errorMessage += matchingCallsCount === 0 ? 'none' : matchingCallsCount;
            if (expected.arguments) {
                errorMessage += ' of such call';
                errorMessage += matchingCallsCount !== 1 ? 's' : '';
            }
            errorMessage += '.';
            if (expected.arguments) {
                errorMessage += '\nAll calls received to ';
                errorMessage += type;
                errorMessage += ' ';
                errorMessage += expected.propertyName;
                errorMessage += ':';
                errorMessage += Utilities_1.stringifyCalls(allCalls);
            }
            throw new Error(errorMessage);
        }
    };
    return Substitute;
}());
exports.Substitute = Substitute;
//# sourceMappingURL=Substitute.js.map