import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { stringifyArguments, areArgumentsEqual } from "../Utilities";

const Nothing = Symbol();

export class SetPropertyState implements ContextState {
    private _callCount: number;
    private _arguments: any[];

    public get arguments() {
        return this._arguments;
    }

    public get property() {
        return this._property;
    }

    public get callCount() {
        return this._callCount;
    }

    constructor(private _property: PropertyKey, ...args: any[]) {
        this._arguments = args;

        this._callCount = 0;
    }

    apply(context: Context): undefined {
        return void 0;
    }

    set(context: Context, property: PropertyKey, value: any) {
        let callCount = this._callCount;
        const hasExpectations = context.initialState.hasExpectations;
        if(hasExpectations) {
            callCount = context.initialState
                .setPropertyStates
                .filter(x => areArgumentsEqual(x.arguments[0], value))
                .map(x => x._callCount)
                .reduce((a, b) => a + b, 0);
        }

        context.initialState.assertCallCountMatchesExpectations(
            context.initialState.setPropertyStates,
            callCount,
            'property',
            this.property,
            this.arguments);

        if(!hasExpectations) {
            this._callCount++;
        }
    }

    get(context: Context, property: PropertyKey): undefined {
        return void 0;
    }
}