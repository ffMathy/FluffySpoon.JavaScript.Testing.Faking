import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { GetPropertyState } from "./GetPropertyState";
import { SetPropertyState } from "./SetPropertyState";
import { Call } from "../Utilities";
export declare class InitialState implements ContextState {
    private recordedGetPropertyStates;
    private recordedSetPropertyStates;
    private _expectedCount;
    private _areProxiesDisabled;
    readonly expectedCount: number;
    readonly hasExpectations: boolean;
    readonly setPropertyStates: SetPropertyState[];
    readonly getPropertyStates: GetPropertyState[];
    constructor();
    assertCallCountMatchesExpectations(calls: Call[], callCount: number, type: string, property: PropertyKey, args: any[]): void;
    private doesCallCountMatchExpectations;
    apply(context: Context, args: any[]): void;
    set(context: Context, property: PropertyKey, value: any): void;
    get(context: Context, property: PropertyKey): any;
    private clearExpectations;
    onSwitchedTo(): void;
}
