import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { FunctionState } from "./FunctionState";
export declare class GetPropertyState implements ContextState {
    private _property;
    private returns;
    private mimicks;
    private _callCount;
    private _recordedFunctionStates;
    private readonly isFunction;
    readonly property: string | number | symbol;
    readonly callCount: number;
    readonly recordedFunctionStates: FunctionState[];
    constructor(_property: PropertyKey);
    apply(context: Context, args: any[]): any;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
