import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { FunctionState } from "./FunctionState";
import { areArgumentsEqual, areArgumentArraysEqual } from "../Utilities";

const Nothing = Symbol();

export class GetPropertyState implements ContextState {
    private returns: any[]|Symbol;
    private callCount: number;
    private recordedFunctionStates: FunctionState[];

    private get isFunction() {
        return this.recordedFunctionStates.length > 0;
    }

    public get property() {
        return this._property;
    }

    constructor(private _property: PropertyKey) {
        this.returns = Nothing;
        this.recordedFunctionStates = [];
        this.callCount = 0;
    }

    apply(context: Context, args: any[]) {
        this.callCount = 0;

        const matchingFunctionState = this.recordedFunctionStates.find(x => areArgumentArraysEqual(x.arguments, args));
        if(matchingFunctionState) {
            console.log('ex-func');
            return matchingFunctionState.apply(context);
        }

        var functionState = new FunctionState(this._property, ...args);
        context.state = functionState;

        this.recordedFunctionStates.push(functionState);

        console.log('states', this.recordedFunctionStates);

        return context.apply(args);
    }

    set(context: Context, property: PropertyKey, value: any) {
    }

    get(context: Context, property: PropertyKey) {
        if (property === 'then')
            return void 0;

        if(this.isFunction)
            return context.proxy;

        if(!context.initialState.doesCallCountMatchExpectations(this.callCount)) {
            throw new Error('Expected ' + context.initialState.expectedCount);
        }

        if(property === 'returns') {
            if(this.returns !== Nothing)
                throw new Error('The return value for the property ' + this._property.toString() + ' has already been set to ' + this.returns);

            return (returns: any) => {
                console.log('returns', returns);

                this.returns = returns;
                this.callCount--;

                context.state = context.initialState;
            };
        }

        this.callCount++;

        if(this.returns !== Nothing)
            return this.returns[this.callCount-1];

        return context.proxy;
    }
}