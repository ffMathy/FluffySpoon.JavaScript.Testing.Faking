import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { stringifyArguments } from "../Utilities";

const Nothing = Symbol();

export class FunctionState implements ContextState {
    private returns: any[]|Symbol;
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
        this.returns = Nothing;
        this.callCount = 0;
    }

    apply(context: Context) {
        if(!context.initialState.doesCallCountMatchExpectations(this.callCount)) {
            throw new Error('Expected ' + context.initialState.expectedCount);
        }

        this.callCount++;

        if(this.returns === Nothing)
            return context.proxy;

        const returnValue = this.returns[this.callCount - 1];
        console.log('result', returnValue);

        return returnValue;
    }

    set(context: Context, property: PropertyKey, value: any) {
    }

    get(context: Context, property: PropertyKey) {
        if (property === 'then')
            return void 0;

        if(property === 'returns') {
            if(this.returns !== Nothing)
                throw new Error('The return value for the function ' + this._property.toString() + ' with ' + stringifyArguments(this._arguments) + ' has already been set to ' + this.returns);

            return (...returns: any[]) => {
                console.log('returns', returns);

                this.returns = returns;
                this.callCount--;

                context.state = context.initialState;
            };
        }

        return context.proxy;
    }
}