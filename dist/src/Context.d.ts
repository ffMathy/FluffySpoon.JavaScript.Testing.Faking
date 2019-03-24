import { ContextState } from "./states/ContextState";
import { InitialState } from "./states/InitialState";
export declare class Context {
    private _initialState;
    private _proxy;
    private _rootProxy;
    private _state;
    constructor();
    apply(args: any[]): any;
    set(property: PropertyKey, value: any): void;
    get(property: PropertyKey): any;
    readonly proxy: any;
    readonly rootProxy: any;
    readonly initialState: InitialState;
    state: ContextState;
}
