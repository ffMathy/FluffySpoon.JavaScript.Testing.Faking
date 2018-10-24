import { Context } from "src/Context";

export type PropertyKey = string|number|symbol;

export interface ContextState {
    apply(context: Context, args: any[]): any;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}