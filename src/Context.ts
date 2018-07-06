export class ProxyPropertyContext {
    name: string;

    type: 'function' | 'object';
    access: 'write' | 'read';
}

export class ProxyMethodContext {
    arguments: any[];
}

export class ProxyCallRecords {
    expected: ProxyCallRecord[];
    actual: ProxyCallRecord[];
}

export class ProxyObjectContext {
    property: ProxyPropertyContext;
    method: ProxyMethodContext;

    calls: ProxyCallRecords;
}

export class ProxyCallRecord {
    arguments?: Array<any>;
    callCount: number;
}