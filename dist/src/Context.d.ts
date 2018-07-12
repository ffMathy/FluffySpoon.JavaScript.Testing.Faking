export declare abstract class ProxyPropertyContextBase {
    name: string;
    type: 'function' | 'object';
    access: 'write' | 'read';
    constructor();
}
export declare class ProxyPropertyContext extends ProxyPropertyContextBase {
    type: 'object';
    returnValues: any[];
    constructor();
    promoteToMethod(): ProxyMethodPropertyContext;
}
export declare class ProxyMethodPropertyContext extends ProxyPropertyContextBase {
    method: ProxyMethodContext;
    type: 'function';
    constructor();
}
export declare class ProxyMethodContext {
    arguments: any[];
    returnValues: any[];
    constructor();
}
export declare class ProxyCallRecords {
    expected: ProxyCallRecord;
    actual: ProxyCallRecord[];
    constructor();
}
export declare class ProxyObjectContext {
    property: ProxyPropertyContext | ProxyMethodPropertyContext;
    calls: ProxyCallRecords;
    constructor();
    setExpectedCallCount(count: number): void;
    findActualPropertyCall(propertyName: string, access: 'read' | 'write'): ProxyCallRecord;
    findActualMethodCall(propertyName: string, args: any[]): ProxyCallRecord;
    addActualPropertyCall(): void;
    private findCall;
}
export declare class ProxyCallRecord {
    callCount: number;
    property: ProxyPropertyContext | ProxyMethodPropertyContext;
    constructor(property?: ProxyPropertyContext | ProxyMethodPropertyContext);
}
