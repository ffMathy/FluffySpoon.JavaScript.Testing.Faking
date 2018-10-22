import { Context } from "src/Context";
export declare type PropertyKey = string | number | symbol;
export interface ContextState {
    apply(context: Context, args: any[]): any;
    set(context: Context, property: PropertyKey, value: any): any;
    get(context: Context, property: PropertyKey): any;
}
