import { ObjectSubstitute } from "./Transformations";
import { ProxyObjectContext, ProxyPropertyContext, ProxyMethodPropertyContext, ProxyCallRecord, ProxyExpectation } from "./Context";
import { stringifyCalls, stringifyArguments } from "./Utilities";

export class Substitute {
    static for<T>(): ObjectSubstitute<T> {
        const objectContext = new ProxyObjectContext();
        
        let thisProxy: ObjectSubstitute<T>;
        return thisProxy = new Proxy(() => { }, {
            apply: (_target, _thisArg, argumentsList) => {
                const propertyContext = objectContext.property;
                if(propertyContext.type === 'function') {
                    let existingCall = objectContext.findActualMethodCall(propertyContext.name, argumentsList); 
                    if(!existingCall)
                        return void 0;

                    const expected = objectContext.calls.expected;
                    if(expected && expected.callCount !== void 0) {
                        if(!this.doesExistingCallMatchCount(expected, existingCall))
                            throw new Error((expected.negated ? 'Dit not expect' : 'Expected') + ' ' + (expected.callCount === null ? 'more than 0' : expected.callCount) + ' call(s) to the method ' + existingCall.property.name + ' with arguments ' + stringifyArguments(argumentsList) + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(existingCall.property.name, objectContext.calls.actual));

                        return thisProxy;
                    }
                    
                    const callCount = existingCall ? existingCall.callCount++ : 0;
                    return propertyContext.method.returnValues[callCount];
                }

                const newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;

                return thisProxy;
            },
            set: (_target, property, value) => {
                const propertyContext = objectContext.property;
                const argumentsList = [value];

                let existingCall = objectContext.findActualMethodCall(propertyContext.name, argumentsList); 
                if(existingCall && propertyContext.type === 'function') {                    
                    const expected = objectContext.calls.expected;
                    if(expected && expected.callCount !== void 0) {
                        console.log('find', '\n', propertyContext, '\n', existingCall);
                        console.log('expected', expected);
                        
                        if(!this.doesExistingCallMatchCount(expected, existingCall))
                            throw new Error((expected.negated ? 'Dit not expect' : 'Expected') + ' ' + (expected.callCount === null ? 'more than 0' : expected.callCount) + ' call(s) to the property ' + existingCall.property.name + ' with value [' + value + '], but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(existingCall.property.name, objectContext.calls.actual));

                        return true;
                    }
                    
                    existingCall.callCount++;
                    return true;
                }

                const newMethodPropertyContext = new ProxyMethodPropertyContext();
                newMethodPropertyContext.name = property.toString();
                newMethodPropertyContext.type = 'function';
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = argumentsList;

                objectContext.property = newMethodPropertyContext;

                const call = objectContext.addActualPropertyCall();
                call.callCount = 1;

                return true;
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

                if (property === 'received' || property === 'didNotReceive') {
                    return (count?: number) => {
                        if(count === void 0)
                            count = null;

                        objectContext.setExpectations(count, property === 'didNotReceive');
                        return thisProxy;
                    };
                }

                const existingCall = objectContext.findActualPropertyCall(property.toString());
                if(existingCall) {
                    const existingCallProperty = existingCall.property;
                    if(existingCallProperty.type === 'function')
                        return thisProxy;
                    
                    const expected = objectContext.calls.expected;
                    if(expected && expected.callCount !== void 0) {
                        if(!this.doesExistingCallMatchCount(expected, existingCall))
                            throw new Error((expected.negated ? 'Dit not expect' : 'Expected') + ' ' + (expected.callCount === null ? 'more than 0' : expected.callCount) + ' call(s) to the property ' + existingCall.property.name + ', but received ' + existingCall.callCount + ' of such call(s).\nOther calls received:' + stringifyCalls(existingCall.property.name, objectContext.calls.actual));

                        return thisProxy;
                    }

                    if(!existingCallProperty.returnValues)
                        return void 0;

                    return existingCallProperty.returnValues[existingCall.callCount++];
                }

                const newPropertyContext = new ProxyPropertyContext();
                newPropertyContext.name = property.toString();
                newPropertyContext.type = 'object';
                newPropertyContext.returnValues = null;

                objectContext.property = newPropertyContext;

                objectContext.addActualPropertyCall();

                return thisProxy;
            }
        }) as any;
    }

    private static doesExistingCallMatchCount(expected: ProxyExpectation, existingCall: ProxyCallRecord) {
        return !(
            (
                !expected.negated && (
                    (expected.callCount === null && existingCall.callCount === 0) ||
                    (expected.callCount !== null && expected.callCount !== existingCall.callCount)
                )
            ) ||
            (
                expected.negated && (
                    (expected.callCount === null && existingCall.callCount !== 0) ||
                    (expected.callCount !== null && expected.callCount === existingCall.callCount)
                )
            )
        );
        
    }
}