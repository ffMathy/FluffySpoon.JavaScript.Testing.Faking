import { ObjectSubstitute, OmitProxyMethods, DisabledSubstituteObject } from "./Transformations";
import { ProxyObjectContext, ProxyPropertyContext, ProxyMethodPropertyContext, ProxyCallRecord, ProxyExpectation } from "./Context";
import { stringifyCalls, stringifyArguments } from "./Utilities";

const areProxiesDisabledKey = Symbol.for('areProxiesDisabled');
const handlerKey = Symbol.for('handler');
const isFake = Symbol.for('isFake');

const internalSymbols = [areProxiesDisabledKey, handlerKey, isFake];

export class Substitute {
    static isSubstitute<T>(instance: T) {
        return instance[isFake];
    }

    static disableFor<T extends ObjectSubstitute<OmitProxyMethods<any>>>(substitute: T): DisabledSubstituteObject<T> {
        const thisProxy = substitute as any;
        const thisExposedProxy = thisProxy[handlerKey];

        const disableProxy = <K extends Function>(f: K): K => {
            return function() {
                thisProxy[areProxiesDisabledKey] = true;
                const returnValue = f.call(thisExposedProxy, ...arguments);
                thisProxy[areProxiesDisabledKey] = false;
                return returnValue;
            } as any;
        };

        return new Proxy(() => { }, {
            apply: disableProxy(thisExposedProxy.apply),
            set: disableProxy(thisExposedProxy.set),
            get: disableProxy(thisExposedProxy.get)
        }) as any;
    }

    static for<T>(): ObjectSubstitute<OmitProxyMethods<T>, T> {
        const objectContext = new ProxyObjectContext();

        let thisProxy: ObjectSubstitute<T>;

        const isProxyDisabled = () => thisProxy[areProxiesDisabledKey];
        const isFluffySpoonProperty = (p: symbol) => internalSymbols.indexOf(p) !== -1;

        const internalStore = Object.create(null) as any;
        
        var thisExposedProxy: ProxyHandler<any> = {
            apply: (_target, _thisArg, argumentsList) => {
                const propertyContext = objectContext.property;

                const existingCalls = objectContext.findActualMethodCalls(propertyContext.name, argumentsList);
                const existingCall = existingCalls[0];

                const allCalls = objectContext.findActualMethodCalls(propertyContext.name);

                if (propertyContext.type === 'function') {
                    const expected = objectContext.calls.expected;
                    if(expected && expected.callCount !== void 0) {
                        expected.arguments = argumentsList;
                        expected.propertyName = propertyContext.name;
                        
                        thisProxy[areProxiesDisabledKey] = false;
                        
                        this.assertCallMatchCount('method', expected, 
                            allCalls,
                            existingCalls);
                        return void 0;
                    }

                    if(existingCall) {
                        existingCall.callCount++;

                        if(existingCall.property.type === 'function') {
                            const mimicks = existingCall.property.method.mimicks;
                            if(mimicks) 
                                return mimicks.call(_target, ...argumentsList);
                        }
                    } else {
                        propertyContext.method.arguments = argumentsList;
                        objectContext.addActualPropertyCall();

                        return void 0;
                    }

                    if(propertyContext.method.returnValues)
                        return propertyContext.method.returnValues[existingCall.callCount - 1];
                    
                    return void 0;
                }

                const newMethodPropertyContext = propertyContext.promoteToMethod();
                newMethodPropertyContext.method.arguments = argumentsList;
                newMethodPropertyContext.method.returnValues = null;

                objectContext.fixExistingCallArguments();

                return thisProxy;
            },
            set: (_target, property, value) => {
                if(isFluffySpoonProperty(property as symbol)) {
                    internalStore[property] = value;
                    return true;
                }

                const propertyContext = objectContext.property;
                const argumentsList = [value];

                let existingCalls = objectContext.findActualMethodCalls(propertyContext.name, argumentsList);
                if (existingCalls.length > 0 && propertyContext.type === 'function') {
                    const expected = objectContext.calls.expected;                    
                    if (expected && expected.callCount !== void 0) {
                        expected.arguments = argumentsList;
                        expected.propertyName = propertyContext.name;
                        
                        thisProxy[areProxiesDisabledKey] = false;

                        this.assertCallMatchCount('property', expected, 
                            objectContext.findActualMethodCalls(propertyContext.name),
                            existingCalls);
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
                if(isFluffySpoonProperty(property as symbol))
                    return internalStore[property];

                if (typeof property === 'symbol') {
                    if (property === Symbol.toPrimitive)
                        return () => void 0;
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
                const addPropertyToObjectContext = () => {
                    const existingCall = objectContext.findActualPropertyCalls(property.toString())[0] || null;
                    if (existingCall) {
                        const existingCallProperty = existingCall.property;
                        if (existingCallProperty.type === 'function')
                            return thisProxy;
    
                        const expected = objectContext.calls.expected;
                        if (expected && expected.callCount !== void 0) {
                            expected.propertyName = existingCallProperty.name;
                        
                            thisProxy[areProxiesDisabledKey] = false;
    
                            this.assertCallMatchCount('property', expected, [existingCall], [existingCall]);
                            return thisProxy;
                        }
    
                        existingCall.callCount++;
    
                        if (existingCallProperty.returnValues)
                            return existingCallProperty.returnValues[existingCall.callCount - 1];
                        
                        const mimicks = existingCallProperty.mimicks;
                        if(mimicks) 
                            return mimicks();
    
                        return void 0;
                    }

                    const newPropertyContext = new ProxyPropertyContext();
                    newPropertyContext.name = property.toString();
                    newPropertyContext.type = 'object';
                    newPropertyContext.returnValues = null;

                    objectContext.property = newPropertyContext;

                    objectContext.addActualPropertyCall();

                    return thisProxy;
                };

                if (property === 'returns' && !isProxyDisabled()) {
                    const createReturnsFunction = (context: {returnValues, mimicks}) => {
                        return (...args: any[]) => {
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

                if(property === 'mimicks' && !isProxyDisabled()) {
                    const createMimicksFunction = (context: {returnValues, mimicks}) => {
                        return (value: Function) => {
                            context.returnValues = void 0;
                            context.mimicks = value;

                            objectContext.getLastCall().callCount--;
                        };
                    };

                    if(currentPropertyContext.type === 'object') 
                        return createMimicksFunction(currentPropertyContext);

                    if(currentPropertyContext.type === 'function')
                        return createMimicksFunction(currentPropertyContext.method);
                }

                if (!isProxyDisabled() && (property === 'received' || property === 'didNotReceive')) {
                    return (count?: number, ...args) => {
                        const shouldForwardCall = (typeof count !== 'number' && typeof count !== 'undefined') || args.length > 0 || isProxyDisabled();
                        if(shouldForwardCall) {
                            addPropertyToObjectContext();
                            return thisExposedProxy.apply(target, target, [count, ...args]);
                        }

                        if (count === void 0)
                            count = null;

                        objectContext.setExpectations(count, property === 'didNotReceive');
                        thisProxy[areProxiesDisabledKey] = true;

                        return thisProxy;
                    };
                }

                return addPropertyToObjectContext();
            }
        };

        thisProxy = new Proxy(() => { }, thisExposedProxy) as any;

        thisProxy[areProxiesDisabledKey] = false;
        thisProxy[isFake] = true;
        thisProxy[handlerKey] = thisExposedProxy;

        return thisProxy;
    }

    private static assertCallMatchCount(
        type: 'property' | 'method', 
        expected: ProxyExpectation, 
        allCalls: ProxyCallRecord[],
        matchingCalls: ProxyCallRecord[]): void 
    {
        const getCallCounts = (calls: ProxyCallRecord[]) => {
            const callCounts = calls.map(x => x.callCount);
            const totalCallCount = callCounts.length === 0 ? 0 : callCounts.reduce((accumulator, value) => accumulator + value);
            return totalCallCount;
        }

        const matchingCallsCount = getCallCounts(matchingCalls);

        const isMatch = 
        !(
            (
                !expected.negated && (
                    (expected.callCount === null && matchingCallsCount === 0) ||
                    (expected.callCount !== null && expected.callCount !== matchingCallsCount)
                )
            ) ||
            (
                expected.negated && (
                    (expected.callCount === null && matchingCallsCount !== 0) ||
                    (expected.callCount !== null && expected.callCount === matchingCallsCount)
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
                    errorMessage += ' with ';
                    errorMessage += stringifyArguments(expected.arguments);
                }
            }

            errorMessage += ', but received ';
            errorMessage += matchingCallsCount === 0 ? 'none' : matchingCallsCount;

            if(expected.arguments) {
                errorMessage += ' of such call';
                errorMessage += matchingCallsCount !== 1 ? 's' : '';
            }

            errorMessage += '.';

            if(expected.arguments) {
                errorMessage += '\nAll calls received to ';
                errorMessage += type;
                errorMessage += ' ';
                errorMessage += expected.propertyName;
                errorMessage += ':';
                errorMessage += stringifyCalls(allCalls);
            }

            throw new Error(errorMessage);
        }
    }
}