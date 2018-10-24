import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
export declare class GetPropertyState implements ContextState {
    private _property;
    private returns;
    private callCount;
    private recordedFunctionStates;
    private readonly isFunction;
    readonly property: string | number | symbol;
    constructor(_property: PropertyKey);
    apply(context: Context, args: any[]): any;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
