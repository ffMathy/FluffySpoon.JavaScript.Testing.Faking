import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { stringifyArguments, stringifyCalls, areArgumentsEqual, areArgumentArraysEqual } from "../Utilities";
import { GetPropertyState } from "./GetPropertyState";

const Nothing = Symbol();

export class FunctionState implements ContextState {
    private returns: any[]|Symbol;
    private mimicks: Function;

    private _callCount: number;
    private _arguments: any[];

    public get arguments() {
        return this._arguments;
    }

    public get callCount() {
        return this._callCount;
    }

    public get property() {
        return this._getPropertyState.property;
    }

    constructor(private _getPropertyState: GetPropertyState, ...args: any[]) {
        this._arguments = args;
        this.returns = Nothing;
        this._callCount = 0;
    }

    apply(context: Context, args: any[]) {
        let callCount = this._callCount;
        const hasExpectations = context.initialState.hasExpectations;
        if(hasExpectations) {
            callCount = this._getPropertyState
                .recordedFunctionStates
                .filter(x => areArgumentArraysEqual(x.arguments, args))
                .map(x => x.callCount)
                .reduce((a, b) => a + b, 0);
        }

        context.initialState.assertCallCountMatchesExpectations(
            this._getPropertyState.recordedFunctionStates,
            callCount,
            'method',
            this.property,
            args);

        if(!hasExpectations)
            this._callCount++;

        if(this.mimicks)
            return this.mimicks.apply(this.mimicks, args);

        if(this.returns === Nothing)
            return context.proxy;

        const returnValue = this.returns[this._callCount - 1];
        // console.log('result', returnValue);

        return returnValue;
    }

    set(context: Context, property: PropertyKey, value: any) {
    }

    get(context: Context, property: PropertyKey) {
        if (property === 'then')
            return void 0;

        if(property === 'mimicks') {
            return (input: Function) => {
                // console.log('mimicks', input);

                this.mimicks = input;
                this._callCount--;

                context.state = context.initialState;
            }
        }

        if(property === 'returns') {
            if(this.returns !== Nothing)
                throw new Error('The return value for the function ' + this._getPropertyState.toString() + ' with ' + stringifyArguments(this._arguments) + ' has already been set to ' + this.returns);

            return (...returns: any[]) => {
                // console.log('returns', returns);

                this.returns = returns;
                this._callCount--;

                context.state = context.initialState;
            };
        }

        return context.proxy;
    }
}