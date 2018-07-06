export class Substitute {
    static for<T>(): ObjectSubstitute<T> {

        const createProxy = (r: any = null) => {
            let localRecord: typeof lastRecord = r;

            const findExistingCall = (calls: Call[]) => findCallMatchingArguments(calls, localRecord.arguments);

            const findOrCreateExistingCall = (calls: Call[]) => {
                let existingCall = findExistingCall(calls);
                if (!existingCall) {
                    existingCall = { 
                        callCount: 0, 
                        arguments: localRecord.arguments,
                        name: localRecord.property.toString()
                    };
                    calls.push(existingCall);
                }

                return existingCall;
            };

            const assertExpectedCalls = () => {
                const existingCall = findExistingCall(localRecord.calls);
                if(!localRecord.arguments || localRecord.arguments.length === 0 || ((localRecord.expectedCallCount === -1 && existingCall.callCount === 0) || (localRecord.expectedCallCount !== -1 && localRecord.expectedCallCount !== existingCall.callCount))) {
                    throw new Error('Expected ' + (localRecord.expectedCallCount === -1 ? 'at least one' : localRecord.expectedCallCount) + ' call(s) to the property ' + localRecord.property + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(localRecord.calls));
                }

                const expectedCall = findExistingCall(localRecord.expectedCalls);
                if (existingCall === null || ((expectedCall.callCount === -1 && existingCall.callCount === 0) || (expectedCall.callCount !== -1 && expectedCall.callCount !== existingCall.callCount))) {
                    throw new Error('Expected ' + (expectedCall.callCount === -1 ? 'at least one' : expectedCall.callCount) + ' call(s) to the method ' + localRecord.property + ' with arguments ' + stringifyArguments(expectedCall.arguments) + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(localRecord.calls));
                }
            }

            let thisProxy: any;
            return thisProxy = new Proxy(() => { }, {
                apply: (_target, _thisArg, argumentsList) => {
                    if (localRecord.arguments) {
                        const existingCall = findOrCreateExistingCall(localRecord.calls);
                        const expectedCall = findExistingCall(localRecord.expectedCalls);

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
                    localRecord.arguments = [...argumentsList];

                    return thisProxy;
                },
                get: (target, property) => {
                    if (typeof property === 'symbol') {
                        if (property === Symbol.toPrimitive)
                            return () => void 0;

                        return void 0;
                    }

                    if (property === 'valueOf')
                        return void 0;

                    if (property === 'toString')
                        return (target[property] || '').toString();

                    if (property === 'inspect')
                        return () => "{SubstituteJS fake}";

                    if (property === 'constructor')
                        return () => thisProxy;

                    if (property === 'returns')
                        return (...args: any[]) => localRecord.shouldReturn = args;

                    if (property === 'received') {
                        return (count?: number) => {
                            localRecord.expectedCallCount = (count === void 0 || count === null) ? -1 : count;

                            return thisProxy;
                        };
                    }

                    if (localRecord && localRecord.property === property) {
                        if (localRecord.arguments)
                            return thisProxy;

                        const existingCall = findOrCreateExistingCall(localRecord.calls);

                        const expectedCall = findExistingCall(localRecord.expectedCalls);
                        if (expectedCall !== null) {
                            assertExpectedCalls();
                            return void 0;
                        }

                        existingCall.callCount++;

                        return localRecord.shouldReturn[localRecord.currentReturnOffset++];
                    }

                    localRecord = createRecord();
                    localRecord.property = property;

                    return thisProxy;
                }
            });
        };

        return createProxy() as any;
    }
}