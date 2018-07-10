import { ProxyPropertyContext, ProxyCallRecord } from "./Context";
export declare function stringifyArguments(args: any[]): string;
export declare function stringifyCalls(property: ProxyPropertyContext, calls: ProxyCallRecord[]): string;
export declare function areArgumentsEqual(a: any, b: any): boolean;
