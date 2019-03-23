import { Context } from "../Context";
import { FunctionState } from "./FunctionState";
export declare type PropertyKey = string | number | symbol;
export interface ContextState {
    onSwitchedTo?(context: Context): void;
    apply(context: Context, args: any[], matchingFunctionStates?: FunctionState[]): any;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
