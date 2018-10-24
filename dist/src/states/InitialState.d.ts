import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
export declare class InitialState implements ContextState {
    private recordedGetPropertyStates;
    private recordedSetPropertyStates;
    private _expectedCount;
    readonly expectedCount: number;
    readonly hasExpectations: boolean;
    constructor();
    doesCallCountMatchExpectations(callCount: number): boolean;
    apply(context: Context, args: any[]): void;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
}
