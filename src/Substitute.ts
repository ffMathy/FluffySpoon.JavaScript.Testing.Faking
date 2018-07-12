import { ObjectSubstitute } from "./Transformations";
import { ProxyObjectContext, ProxyPropertyContext, ProxyMethodPropertyContext } from "./Context";
import { stringifyCalls, stringifyArguments } from "./Utilities";

export class Substitute {
    static for<T>(): ObjectSubstitute<T> {
        const objectContext = new ProxyObjectContext();
        
        let thisProxy: ObjectSubstitute<T>;
        return thisProxy = new Proxy(() => { }, {
            apply: (_target, _thisArg, argumentsList) => {
                const propertyContext = objectContext.property;
                if(propertyContext.type === 'function') {
                    const existingCall = objectContext.findActualMethodCall(propertyContext.name, argumentsList); 
                    if(!existingCall)
                        return void 0;

                    const expectedCallCount = objectContext.calls.expectedCallCount;
                    if(expectedCallCount !== void 0) {
                        if(!this.doesExistingCallMatchCount(expectedCallCount, existingCall))
                            throw new Error('Expected ' + (expectedCallCount === null ? 'at least one' : expectedCallCount) + ' call(s) to the method ' + existingCall.property.name + ' with arguments ' + stringifyArguments(argumentsList) + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(existingCall.property.name, objectContext.calls.actual));

                        return thisProxy;
                    }
                    
                    return propertyContext.method.returnValues[existingCall.callCount++];
                }

                const newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;

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
                    return () => '{SubstituteJS fake}';

                if (property === 'constructor')
                    return () => thisProxy;

                const currentPropertyContext = objectContext.property;
                if (property === 'returns') {
                    if(currentPropertyContext.type === 'object')
                        return (...args: any[]) => currentPropertyContext.returnValues = args;

                    if(currentPropertyContext.type === 'function')
                        return (...args: any[]) => currentPropertyContext.method.returnValues = args;
                }

                if (property === 'received') {
                    return (count?: number) => {
                        if(count === void 0)
                            count = null;

                        objectContext.calls.expectedCallCount = count;
                        return thisProxy;
                    };
                }

                const existingCall = objectContext.findActualPropertyCall(property.toString(), 'read');
                if(existingCall) {
                    const existingCallProperty = existingCall.property;
                    if(existingCallProperty.type === 'function')
                        return thisProxy;
                    
                    const expectedCallCount = objectContext.calls.expectedCallCount;
                    if(expectedCallCount !== void 0) {
                        if(!this.doesExistingCallMatchCount(expectedCallCount, existingCall))
                            throw new Error('Expected ' + (expectedCallCount === null ? 'at least one' : expectedCallCount) + ' call(s) to the property ' + existingCall.property.name + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(existingCall.property.name, objectContext.calls.actual));

                        return thisProxy;
                    }

                    if(!existingCallProperty.returnValues)
                        return void 0;

                    return existingCallProperty.returnValues[existingCall.callCount++];
                }

                const newPropertyContext = new ProxyPropertyContext();
                newPropertyContext.name = property.toString();
                newPropertyContext.type = 'object';
                newPropertyContext.access = 'read';
                newPropertyContext.returnValues = null;

                objectContext.property = newPropertyContext;

                objectContext.addActualPropertyCall();

                return thisProxy;
            }
        }) as any;
    }

    private static doesExistingCallMatchCount(expectedCallCount: number, existingCall) {
        return !((expectedCallCount === null && existingCall.callCount === 0) ||
            (expectedCallCount !== null && expectedCallCount !== existingCall.callCount));
    }
}