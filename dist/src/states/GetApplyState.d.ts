import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
export declare class GetApplyState implements ContextState {
    apply(context: Context, args: any[]): void;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): void;
}
