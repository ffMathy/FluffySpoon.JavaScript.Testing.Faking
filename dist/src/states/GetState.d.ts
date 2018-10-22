import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
export declare class PropertyState implements ContextState {
    private returns;
    private isFunction;
    constructor();
    apply(context: Context, args: any[]): void;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
