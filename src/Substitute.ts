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

                if (propertyContext.type === 'function') {
                    let existingCalls = objectContext.findActualMethodCalls(propertyContext.name, argumentsList);
                    if (existingCalls.length === 0)
                        return void 0;

                    const expected = objectContext.calls.expected;
                    if(expected && expected.callCount !== void 0) {
                        expected.arguments = argumentsList;
                        expected.propertyName = propertyContext.name;
                        
                        this.assertCallMatchCount('method', expected, existingCalls);
                        return thisProxy;
                    }

                    const existingCall = existingCalls[0];
                    if(existingCall)
                        existingCall.callCount++;

                    if(!existingCall)
                        return propertyContext.method.returnValues[0];

                    if(propertyContext.method.returnValues)
                        return propertyContext.method.returnValues[existingCall.callCount - 1];
                    
                    return void 0;
                }

                const newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;

                return thisProxy;
            },
            set: (_target, property, value) => {
                const propertyContext = objectContext.property;
                const argumentsList = [value];

                let existingCalls = objectContext.findActualMethodCalls(propertyContext.name, argumentsList);
                if (existingCalls.length > 0 && propertyContext.type === 'function') {
                    const expected = objectContext.calls.expected;                    
                    if (expected && expected.callCount !== void 0) {
                        expected.arguments = argumentsList;
                        expected.propertyName = propertyContext.name;

                        this.assertCallMatchCount('property', expected, existingCalls);
                        return true;
                    }

                    const existingCall = existingCalls[0];
                    existingCall.callCount++;

                    return true;
                }

                const newMethodPropertyContext = new ProxyMethodPropertyContext();
                newMethodPropertyContext.name = property.toString();
                newMethodPropertyContext.type = 'function';
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = argumentsList;

                objectContext.property = newMethodPropertyContext;

                objectContext.addActualPropertyCall();

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
                    if (currentPropertyContext.type === 'object') {
                        return (...args: any[]) => {
                            if(currentPropertyContext.mimicks)
                                currentPropertyContext.mimicks = void 0;

                            objectContext.getLastCall().callCount--;
                            currentPropertyContext.returnValues = args;
                        };
                    }

                    if (currentPropertyContext.type === 'function') {
                        return (...args: any[]) => {
                            if(currentPropertyContext.mimicks)
                                currentPropertyContext.mimicks = void 0;

                            objectContext.getLastCall().callCount--;
                            currentPropertyContext.method.returnValues = args;
                        };
                    }
                }

                if(property === 'mimicks') {
                    return (value: T|Function) => {
                        if(currentPropertyContext.type === 'object')
                            currentPropertyContext.returnValues = void 0;
                            
                        if(currentPropertyContext.type === 'function')
                            currentPropertyContext.method.returnValues = void 0;
                        
                        if(typeof value === 'function') {
                            currentPropertyContext.mimicks = value;
                        } else {
                            const currentPropertyName = currentPropertyContext.name;
                            currentPropertyContext.mimicks = value;
                        }
                    };
                }

                if (property === 'received' || property === 'didNotReceive') {
                    return (count?: number) => {
                        if (count === void 0)
                            count = null;

                        objectContext.setExpectations(count, property === 'didNotReceive');
                        return thisProxy;
                    };
                }

                const existingCall = objectContext.findActualPropertyCalls(property.toString())[0] || null;
                if (existingCall) {
                    const existingCallProperty = existingCall.property;
                    if (existingCallProperty.type === 'function')
                        return thisProxy;

                    const expected = objectContext.calls.expected;
                    if (expected && expected.callCount !== void 0) {
                        expected.propertyName = existingCallProperty.name;

                        this.assertCallMatchCount('property', expected, [existingCall]);
                        return thisProxy;
                    }

                    existingCall.callCount++;

                    if (existingCallProperty.returnValues)
                        return existingCallProperty.returnValues[existingCall.callCount - 1];
                    
                    if(existingCallProperty.mimicks)
                        return this;
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

    private static assertCallMatchCount(type: 'property' | 'method', expected: ProxyExpectation, existingCalls: ProxyCallRecord[]): void {
        const existingCallCount = existingCalls.map(x => x.callCount).reduce((accumulator, value) => accumulator + value);
        const isMatch = 
        !(
            (
                !expected.negated && (
                    (expected.callCount === null && existingCallCount === 0) ||
                    (expected.callCount !== null && expected.callCount !== existingCallCount)
                )
            ) ||
            (
                expected.negated && (
                    (expected.callCount === null && existingCallCount !== 0) ||
                    (expected.callCount !== null && expected.callCount === existingCallCount)
                )
            )
        );
        
        if (!isMatch) {
            let errorMessage = '';

            errorMessage += expected.negated ? 'Did not expect' : 'Expected';
            errorMessage += ' ';
            errorMessage += expected.callCount === null ? 'one or more' : expected.callCount;
            errorMessage += ' call';
            errorMessage += (expected.callCount === null || expected.callCount !== 1) ? 's' : '';
            errorMessage += ' to the ';
            errorMessage += type;
            errorMessage += ' ';
            errorMessage += expected.propertyName;

            if(expected.arguments) {
                if(type === 'property') {
                    errorMessage += ' with value ';

                    const value = expected.arguments[0];
                    if(value === null)
                        errorMessage += 'null';
                    
                    if(value === void 0)
                        errorMessage += 'undefined';

                    if(value)
                        errorMessage += value;
                } else if(type === 'method') {
                    errorMessage += ' with arguments ';
                    errorMessage += stringifyArguments(expected.arguments);
                }
            }

            errorMessage += ', but received ';
            errorMessage += existingCallCount === 0 ? 'none' : existingCallCount;

            if(expected.arguments) {
                errorMessage += ' of such call';
                errorMessage += existingCallCount !== 1 ? 's' : '';
            }

            errorMessage += '.';

            if(expected.arguments) {
                errorMessage += '\nCalls received to ';
                errorMessage += type;
                errorMessage += ' ';
                errorMessage += expected.propertyName;
                errorMessage += ' in general: ';
                errorMessage += stringifyCalls(existingCalls);
            }

            throw new Error(errorMessage);
        }
    }
}