import { areArgumentsEqual } from "./Utilities";
import { AllArguments } from "./Arguments";

export abstract class ProxyPropertyContextBase {
    name: string;

    type: 'function' | 'object';

    constructor() {
        this.name = null;
        this.type = null;
    }
}

export class ProxyPropertyContext extends ProxyPropertyContextBase {
    type: 'object';
    
    mimicks: Function;
    returnValues: any[];

    constructor() {
        super();
    }

    promoteToMethod(): ProxyMethodPropertyContext {
        const methodContext = this as any as ProxyMethodPropertyContext;
        methodContext.method = new ProxyMethodContext();
        methodContext.type = 'function';

        return methodContext;
    }
}

export class ProxyMethodPropertyContext extends ProxyPropertyContextBase {
    method: ProxyMethodContext;

    type: 'function';

    constructor() {
        super();

        this.method = new ProxyMethodContext();
    }
}

export class ProxyMethodContext {
    arguments: any[];
    returnValues: any[];
    mimicks: Function;

    constructor() {
        this.arguments = [];
    }
}

export class ProxyCallRecords {
    expected: ProxyExpectation;
    actual: ProxyCallRecord[];

    constructor() {
        this.expected = null;
        this.actual = [];
    }
}

export class ProxyExpectation {
    callCount: number;
    negated: boolean;
    propertyName: string;
    arguments: Array<any>;

    constructor() {
        this.callCount = void 0;
        this.negated = false;
    }
}

export class ProxyObjectContext {
    property: ProxyPropertyContext|ProxyMethodPropertyContext;
    calls: ProxyCallRecords;

    constructor() {
        this.calls = new ProxyCallRecords();
        this.property = new ProxyPropertyContext();
    }

    setExpectations(count: number, negated: boolean) {
        const call = new ProxyExpectation();
        call.callCount = count;
        call.negated = negated;

        this.calls.expected = call;
    }

    findActualPropertyCalls(propertyName: string) {
        return this.calls.actual.filter(x => 
            x.property.name === propertyName);
    }

    findActualMethodCalls(propertyName: string, args: any[]) {
        let result = this.calls
            .actual
            .filter(x => x.property.name === propertyName)
            .filter(x => {
                if(x.property.type !== 'function') return false;
                
                const args1 = x.property.method.arguments;
                const args2 = args;

                if(!args1 || !args2)
                    return false;

                const firstArg1 = args1[0];
                const firstArg2 = args2[0];
                if(firstArg1 instanceof AllArguments || firstArg2 instanceof AllArguments)
                    return true;

                if(args1.length !== args2.length)
                    return false;

                for(let i=0;i<args1.length;i++) {
                    const arg1 = args1[i];
                    const arg2 = args2[i];

                    if(!areArgumentsEqual(arg1, arg2)) 
                        return false;
                }

                return true;
            });

        return result;
    }

    getLastCall() {
        return this.calls.actual[this.calls.actual.length-1];
    }

    addActualPropertyCall() {
        let existingCall: ProxyCallRecord;

        const existingCallCandidates = this.calls.actual.filter(x => 
            x.property.name === this.property.name);

        const thisProperty = this.property;
        if(thisProperty.type === 'function') {
            existingCall = existingCallCandidates.filter(x => 
                x.property.type === thisProperty.type && 
                areArgumentsEqual(x.property.method.arguments, thisProperty.method.arguments))[0];
        } else {
            existingCall = existingCallCandidates[0];
        }
            
        if(!existingCall) {
            existingCall = new ProxyCallRecord(this.property);
            this.calls.actual.push(existingCall);
        }

        existingCall.callCount++;
    }
}

export class ProxyCallRecord {
    callCount: number;
    property: ProxyPropertyContext | ProxyMethodPropertyContext;

    constructor(property?: ProxyPropertyContext | ProxyMethodPropertyContext) {
        this.callCount = 0;
        this.property = property || null;
    }
}