import { areArgumentsEqual } from "./Utilities";
import { ENGINE_METHOD_DIGESTS } from "constants";

export abstract class ProxyPropertyContextBase {
    name: string;

    type: 'function' | 'object';
    access: 'write' | 'read';

    constructor() {
        this.name = null;
        this.type = null;
        this.access = null;
    }
}

export class ProxyPropertyContext extends ProxyPropertyContextBase {
    type: 'object';
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

    findActualPropertyCall(propertyName: string, access: 'read' | 'write') {
        return this.calls.actual.filter(x => 
            x.property.name === propertyName &&
            x.property.access === access)[0] || null;
    }

    findActualMethodCall(propertyName: string, args: any[]) {
        return this.calls
            .actual
            .filter(x => x.property.name === propertyName)
            .filter(x => {
                if(x.property.type !== 'function') return false;
                
                const args1 = x.property.method.arguments;
                const args2 = args;

                if(!args1 || !args2)
                    return false;

                if(args1.length !== args2.length)
                    return false;

                for(let i=0;i<args1.length;i++) {
                    const arg1 = args1[i];
                    const arg2 = args2[i];

                    if(!areArgumentsEqual(arg1, arg2))
                        return false;
                }

                return true;
            })[0] || null;
    }

    addActualPropertyCall() {
        let existingCall: ProxyCallRecord;

        const existingCallCandidates = this.calls.actual.filter(x => 
            x.property.name === this.property.name &&
            x.property.access === this.property.access);

        const thisProperty = this.property;
        if(thisProperty.type === 'function') {
            existingCall = existingCallCandidates.filter(x => 
                x.property.type === thisProperty.type && 
                areArgumentsEqual(x.property.method.arguments, thisProperty.method.arguments))[0];
        } else {
            existingCall = existingCallCandidates[0];
        }
            
        if(existingCall) {
            existingCall.callCount++;
            return;
        }

        const newCall = new ProxyCallRecord(this.property);
        this.calls.actual.push(newCall);
    }

    private findCall(callList: ProxyCallRecord[], propertyName: string, access: 'read'|'write') {
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