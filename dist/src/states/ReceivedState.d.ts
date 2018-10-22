import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
export declare class ReceivedState implements ContextState {
    private count?;
    constructor(count?: number);
    apply(context: Context, args: any[]): any;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
