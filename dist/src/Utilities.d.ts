import { ProxyCallRecord } from "./Context";
export declare function stringifyArguments(args: any[]): string;
export declare function stringifyCalls(propertyName: string, calls: ProxyCallRecord[]): string;
export declare function areArgumentsEqual(a: any, b: any): any;
