import { ContextState } from "./states/ContextState";
import { InitialState } from "./states/InitialState";
export declare class Context {
    private _initialState;
    private _proxy;
    private _state;
    constructor();
    apply(args: any[]): any;
    set(property: PropertyKey, value: any): any;
    get(property: PropertyKey): any;
    readonly proxy: any;
    readonly initialState: InitialState;
    state: ContextState;
}
