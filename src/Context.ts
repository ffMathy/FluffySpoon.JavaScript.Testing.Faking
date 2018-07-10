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

export class ProxyReturnValues {
    valueSequence: any[];
    currentSequenceOffset: number;

    constructor(...args: any[]) {
        this.valueSequence = args || [];
        this.currentSequenceOffset = 0;
    }
}

export class ProxyPropertyContext extends ProxyPropertyContextBase {
    type: 'object';
    returnValues: ProxyReturnValues;
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
    returnValues: ProxyReturnValues;

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
    property: ProxyPropertyContext;
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

    findExpectedCall(propertyName: string, access: 'read' | 'write') {
        return this.findCall(this.calls.expected, propertyName, access);
    }

    findActualCall(propertyName: string, access: 'read' | 'write') {
        return this.findCall(this.calls.actual, propertyName, access);
    }

    addActualCall(...args: any[]) {
        this.addCall(this.calls.actual, args);
    }

    private findCall(callList: ProxyCallRecord[], propertyName: string, access: 'read'|'write') {
        return callList.filter(x => 
            x.property.name === propertyName &&
            x.property.access === access)[0] || null;
    }

    private addCall(callList: ProxyCallRecord[], args?: any[]) {
        let existingCall: ProxyCallRecord;

        const existingCallCandidates = callList.filter(x => 
            x.property.name === this.property.name &&
            x.property.access === this.property.access);

        if(args) {
            existingCall = existingCallCandidates.filter(x => 
                x.property.type === 'function' && 
                areArgumentsEqual(x.property.method.arguments, args))[0];
        } else {
            existingCall = existingCallCandidates[0];
        }
            
        if(existingCall) {
            existingCall.callCount++;
            return;
        }

        const newCall = new ProxyCallRecord(this.property);
        newCall.callCount++;

        callList.push(newCall);
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