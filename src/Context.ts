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
    expected: ProxyCallRecord;
    actual: ProxyCallRecord[];

    constructor() {
        this.expected = null;
        this.actual = [];
    }
}

export class ProxyObjectContext {
    property: ProxyPropertyContext|ProxyMethodPropertyContext;
    calls: ProxyCallRecords;

    constructor() {
        this.calls = new ProxyCallRecords();
        this.property = new ProxyPropertyContext();
    }

    setExpectedCallCount(count: number) {
        const call = new ProxyCallRecord();
        call.callCount = count;

        this.calls.expected = call;
    }

    findActualPropertyCall(propertyName: string, access: 'read' | 'write') {
        return this.calls.actual.filter(x => 
            x.property.name === propertyName &&
            x.property.access === access)[0] || null;
    }

    findActualMethodCall(propertyName: string, args: any[]) {
        return this.calls.actual.filter(x => 
            x.property.type === 'function' &&
            x.property.name === propertyName &&
            areArgumentsEqual(x.property.method.arguments, args))[0] || null;
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