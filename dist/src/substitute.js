"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Context_1 = require("./Context");
var Substitute = /** @class */ (function () {
    function Substitute() {
    }
    Substitute.for = function () {
        var objectContext = new Context_1.ProxyObjectContext();
        var thisProxy;
        return thisProxy = new Proxy(function () { }, {
            apply: function (_target, _thisArg, argumentsList) {
                if (localRecord.arguments) {
                    var existingCall = findOrCreateExistingCall(localRecord.calls);
                    var expectedCall = findExistingCall(localRecord.expectedCalls);
                    console.log(existingCall, expectedCall);
                    if (expectedCall !== null) {
                        assertExpectedCalls();
                        return void 0;
                    }
                    existingCall.callCount++;
                    if (!equals(localRecord.arguments, argumentsList))
                        return void 0;
                    return localRecord.shouldReturn[localRecord.currentReturnOffset++];
                }
                findOrCreateExistingCall(localRecord.expectedCalls);
                localRecord.arguments = argumentsList.slice();
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
                if (property === 'returns' && objectContext.property.type === 'object')
                    return function () {
                        var args = [];
                        for (var _i = 0; _i < arguments.length; _i++) {
                            args[_i] = arguments[_i];
                        }
                        return objectContext.property.returnValues = new (Context_1.ProxyReturnValues.bind.apply(Context_1.ProxyReturnValues, [void 0].concat(args)))();
                    };
                if (property === 'received') {
                    return function (count) {
                        objectContext.setExpectedCallCount(count);
                        return thisProxy;
                    };
                }
                var existingCall = objectContext.findActualCall(property.toString(), 'read');
                if (existingCall) {
                    if (existingCall.property.type === 'function')
                        return thisProxy;
                    var expectedCall = objectContext.findExpectedCall(property.toString(), 'read');
                    if (expectedCall && expectedCall.property.type === 'object') {
                        //assert expected call matching.
                    }
                }
                // if (existingCall) {
                //     if (existingCall)
                //         return thisProxy;
                //     const existingCall = findOrCreateExistingCall(localRecord.calls);
                //     const expectedCall = findExistingCall(localRecord.expectedCalls);
                //     if (expectedCall !== null) {
                //         assertExpectedCalls();
                //         return void 0;
                //     }
                //     existingCall.callCount++;
                //     return localRecord.shouldReturn[localRecord.currentReturnOffset++];
                // }
                // localRecord = createRecord();
                // localRecord.property = property;
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