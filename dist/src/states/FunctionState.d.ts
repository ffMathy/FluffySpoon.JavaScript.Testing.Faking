import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { GetPropertyState } from "./GetPropertyState";
export declare class FunctionState implements ContextState {
    private _getPropertyState;
    private returns;
    private mimicks;
    private _callCount;
    private _arguments;
    readonly arguments: any[];
    readonly callCount: number;
    readonly property: string | number | symbol;
    constructor(_getPropertyState: GetPropertyState, ...args: any[]);
    apply(context: Context, args: any[], matchingFunctionStates: FunctionState[]): any;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
