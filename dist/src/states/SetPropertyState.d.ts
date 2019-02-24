import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
export declare class SetPropertyState implements ContextState {
    private _property;
    private _callCount;
    private _arguments;
    readonly arguments: any[];
    readonly property: string | number | symbol;
    readonly callCount: number;
    constructor(_property: PropertyKey, ...args: any[]);
    apply(context: Context): undefined;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): undefined;
}
