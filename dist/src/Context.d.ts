export declare class ProxyPropertyContext {
    name: string;
    type: 'function' | 'object';
    access: 'write' | 'read';
}
export declare class ProxyMethodContext {
    arguments: any[];
}
export declare class ProxyCallRecords {
    expected: ProxyCallRecord[];
    actual: ProxyCallRecord[];
}
export declare class ProxyObjectContext {
    property: ProxyPropertyContext;
    method: ProxyMethodContext;
    calls: ProxyCallRecords;
}
export declare class ProxyCallRecord {
    arguments?: Array<any>;
    callCount: number;
}
