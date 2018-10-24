import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { stringifyArguments } from "../Utilities";

const Nothing = Symbol();

export class SetPropertyState implements ContextState {
    private callCount: number;
    private _arguments: any[];

    public get arguments() {
        return this._arguments;
    }

    public get property() {
        return this._property;
    }

    constructor(private _property: PropertyKey, ...args: any[]) {
        this._arguments = args;
        this.callCount = 0;
    }

    apply(context: Context) {
        return void 0;
    }

    set(context: Context, property: PropertyKey, value: any) {
        if(!context.initialState.doesCallCountMatchExpectations(this.callCount)) {
            throw new Error('Expected ' + context.initialState.expectedCount);
        }

        this.callCount++;
    }

    get(context: Context, property: PropertyKey) {
        return void 0;
    }
}