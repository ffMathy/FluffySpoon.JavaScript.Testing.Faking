"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Context_1 = require("./Context");
var Utilities_1 = require("./Utilities");
var Substitute = /** @class */ (function () {
    function Substitute() {
    }
    Substitute.for = function () {
        var objectContext = new Context_1.ProxyObjectContext();
        var thisProxy;
        return thisProxy = new Proxy(function () { }, {
            apply: function (_target, _thisArg, argumentsList) {
                var propertyContext = objectContext.property;
                if (propertyContext.type === 'function') {
                    console.log(objectContext.calls.actual.map(function (x) { return x.property; }).filter(function (x) { return x.type === 'function'; }).map(function (x) { return x.method; }));
                    var existingCall = objectContext.findActualMethodCall(propertyContext.name, argumentsList);
                    if (!existingCall)
                        return void 0;
                    return propertyContext.method.returnValues[existingCall.callCount++];
                }
                var newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;
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
                if (property === 'received') {
                    return function (count) {
                        if (count === void 0)
                            count = null;
                        objectContext.setExpectedCallCount(count);
                        return thisProxy;
                    };
                }
                var existingCall = objectContext.findActualPropertyCall(property.toString(), 'read');
                if (existingCall) {
                    var existingCallProperty = existingCall.property;
                    if (existingCallProperty.type === 'function')
                        return thisProxy;
                    var expectedCall = objectContext.calls.expected;
                    if (expectedCall && expectedCall.callCount !== void 0) {
                        var expectedCallProperty = new Context_1.ProxyPropertyContext();
                        expectedCallProperty.access = 'read';
                        expectedCallProperty.type = 'object';
                        expectedCallProperty.name = property.toString();
                        expectedCall.property = expectedCallProperty;
                        var shouldFail = (expectedCall.callCount === null && existingCall.callCount === 0) ||
                            (expectedCall.callCount !== null && expectedCall.callCount !== existingCall.callCount);
                        if (shouldFail)
                            throw new Error('Expected ' + (expectedCall.callCount === null ? 'at least one' : expectedCall.callCount) + ' call(s) to the method ' + expectedCallProperty.name + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + Utilities_1.stringifyCalls(expectedCallProperty, objectContext.calls.actual));
                        return thisProxy;
                    }
                    if (!existingCallProperty.returnValues)
                        return void 0;
                    return existingCallProperty.returnValues[existingCall.callCount++];
                }
                var newPropertyContext = new Context_1.ProxyPropertyContext();
                newPropertyContext.name = property.toString();
                newPropertyContext.type = 'object';
                newPropertyContext.access = 'read';
                newPropertyContext.returnValues = null;
                objectContext.property = newPropertyContext;
                objectContext.addActualPropertyCall();
                return thisProxy;
            }
        });
        // const findExistingCall = (calls: Call[]) => findCallMatchingArguments(calls, localRecord.arguments);
        // const findOrCreateExistingCall = (calls: Call[]) => {
        //     let existingCall = findExistingCall(calls);
        //     if (!existingCall) {
        //         existingCall = { 
        //             callCount: 0, 
        //             arguments: localRecord.arguments,
        //             name: localRecord.property.toString()
        //         };
        //         calls.push(existingCall);
        //     }
        //     return existingCall;
        // };
        // const assertExpectedCalls = () => {
        //     const existingCall = findExistingCall(localRecord.calls);
        //     if(!localRecord.arguments || localRecord.arguments.length === 0 || ((localRecord.expectedCallCount === -1 && existingCall.callCount === 0) || (localRecord.expectedCallCount !== -1 && localRecord.expectedCallCount !== existingCall.callCount))) {
        //         throw new Error('Expected ' + (localRecord.expectedCallCount === -1 ? 'at least one' : localRecord.expectedCallCount) + ' call(s) to the property ' + localRecord.property + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(localRecord.calls));
        //     }
        //     const expectedCall = findExistingCall(localRecord.expectedCalls);
        //     if (existingCall === null || ((expectedCall.callCount === -1 && existingCall.callCount === 0) || (expectedCall.callCount !== -1 && expectedCall.callCount !== existingCall.callCount))) {
        //         throw new Error('Expected ' + (expectedCall.callCount === -1 ? 'at least one' : expectedCall.callCount) + ' call(s) to the method ' + localRecord.property + ' with arguments ' + stringifyArguments(expectedCall.arguments) + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(localRecord.calls));
        //     }
        // }
    };
    return Substitute;
}());
exports.Substitute = Substitute;
//# sourceMappingURL=Substitute.js.map