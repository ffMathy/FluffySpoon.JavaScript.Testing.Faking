import { ObjectSubstitute } from "./Transformations";
import { ProxyObjectContext, ProxyReturnValues } from "./Context";

export class Substitute {
    static for<T>(): ObjectSubstitute<T> {
        const objectContext = new ProxyObjectContext();
        
        let thisProxy: ObjectSubstitute<T>;
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

                if (property === 'returns' && objectContext.property.type === 'object')
                    return (...args: any[]) => objectContext.property.returnValues = new ProxyReturnValues(...args);

                if (property === 'received') {
                    return (count?: number) => {
                        objectContext.setExpectedCallCount(count);
                        return thisProxy;
                    };
                }

                const existingCall = objectContext.findActualCall(property.toString(), 'read');
                if(existingCall) {
                    if(existingCall.property.type === 'function')
                        return thisProxy;
                    
                    const expectedCall = objectContext.findExpectedCall(property.toString(), 'read');
                    if(expectedCall && expectedCall.property.type === 'object') {
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
        }) as any;

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
    }
}