export declare abstract class ProxyPropertyContextBase {
    name: string;
    type: 'function' | 'object';
    access: 'write' | 'read';
    constructor();
}
export declare class ProxyReturnValues {
    valueSequence: any[];
    currentSequenceOffset: number;
    constructor(...args: any[]);
}
export declare class ProxyPropertyContext extends ProxyPropertyContextBase {
    type: 'object';
    returnValues: ProxyReturnValues;
}
export declare class ProxyMethodPropertyContext extends ProxyPropertyContextBase {
    method: ProxyMethodContext;
    type: 'function';
    constructor();
}
export declare class ProxyMethodContext {
    arguments: any[];
    returnValues: ProxyReturnValues;
    constructor();
}
export declare class ProxyCallRecords {
    expected: ProxyCallRecord;
    actual: ProxyCallRecord[];
    constructor();
}
export declare class ProxyObjectContext {
    property: ProxyPropertyContext;
    calls: ProxyCallRecords;
    constructor();
    setExpectedCallCount(count: number): void;
    findExpectedCall(propertyName: string, access: 'read' | 'write'): any;
    findActualCall(propertyName: string, access: 'read' | 'write'): ProxyCallRecord;
    addActualCall(...args: any[]): void;
    private findCall;
    private addCall;
}
export declare class ProxyCallRecord {
    callCount: number;
    property: ProxyPropertyContext | ProxyMethodPropertyContext;
    constructor(property?: ProxyPropertyContext | ProxyMethodPropertyContext);
}
