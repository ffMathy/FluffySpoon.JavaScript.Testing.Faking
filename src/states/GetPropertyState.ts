import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { FunctionState } from "./FunctionState";
import { Type } from "../Utilities";

const Nothing = Symbol();

export class GetPropertyState implements ContextState {
    private returns: any[]|Symbol;
    private mimicks: Function|null;

    private _callCount: number;
    private _functionState?: FunctionState;

    private get isFunction(): boolean {
        return !!this._functionState
    }

    public get property() {
        return this._property;
    }

    public get callCount() {
        return this._callCount;
    }

    public get functionState(): FunctionState | undefined {
        return this._functionState
    }

    constructor(private _property: PropertyKey) {
        this.returns = Nothing;
        this.mimicks = null;
        this._callCount = 0;
    }

    apply(context: Context, args: any[]) {
        this._callCount = 0;

        if (this.functionState) {
            context.state = this.functionState
            return this.functionState.apply(context, args);
        }

        var functionState = new FunctionState(this);
        context.state = functionState;
        this._functionState = functionState

        return context.apply(void 0, void 0, args);
    }

    set(context: Context, property: PropertyKey, value: any) {
    }

    get(context: Context, property: PropertyKey) {
        const hasExpectations = context.initialState.hasExpectations;

        if (property === 'then')
            return void 0;

        if(this.isFunction)
            return context.proxy;

        if(property === 'mimicks') {
            return (input: Function) => {
                this.mimicks = input;
                this._callCount--;

                context.state = context.initialState;
            }
        }

        if(property === 'returns') {
            if(this.returns !== Nothing)
                throw new Error('The return value for the property ' + this._property.toString() + ' has already been set to ' + this.returns);

            return (...returns: any[]) => {
                this.returns = returns;
                this._callCount--;

                context.state = context.initialState;
            };
        }

        if(!hasExpectations) {
            this._callCount++;

            if(this.mimicks)
                return this.mimicks.apply(this.mimicks);

            if(this.returns !== Nothing) {
                var returnsArray = this.returns as any[];
                if(returnsArray.length === 1)
                    return returnsArray[0];
        
                return returnsArray[this._callCount-1];
            }
        }

        context.initialState.assertCallCountMatchesExpectations(
            [[]],  // I'm not sure what this was supposed to mean
            this.callCount,
            Type.property,
            this.property,
            []);

        return context.proxy;
    }
}