import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { Call } from "../Utilities";
import { GetPropertyState } from "./GetPropertyState";
export declare class FunctionState implements ContextState {
    private _getPropertyState;
    private returns;
    private mimicks;
    private _calls;
    private _lastArgs?;
    readonly calls: Call[];
    readonly callCount: number;
    readonly property: string | number | symbol;
    constructor(_getPropertyState: GetPropertyState);
    private getCallCount;
    apply(context: Context, args: any[]): any;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
