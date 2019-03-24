import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { stringifyArguments, stringifyCalls, areArgumentsEqual, areArgumentArraysEqual, Call } from "../Utilities";
import { GetPropertyState } from "./GetPropertyState";
import { Argument, Arg } from "../Arguments";

const Nothing = Symbol()

interface ReturnMock {
    args: Call
    returnValues: any[] | Symbol // why symbol, what
    returnIndex: 0
}

export class FunctionState implements ContextState {
    private returns: ReturnMock[];
    private mimicks: Function|null;

    private _calls: Call[]; // list of lists of arguments this was called with
    private _lastArgs?: Call // bit of a hack

    public get calls(): Call[] {
        return this._calls
    }

    public get callCount() {
        return this._calls.length;
    }

    public get property() {
        return this._getPropertyState.property;
    }

    constructor(private _getPropertyState: GetPropertyState) {
        this.returns = [];
        this.mimicks = null;
        this._calls = [];
    }

    private getCallCount(args: Call): number {
        return this._calls.reduce((count, cargs) => areArgumentArraysEqual(cargs, args) ? count + 1 : count, 0)
    }

    apply(context: Context, args: any[]) {
        const hasExpectations = context.initialState.hasExpectations;
        this._lastArgs = args

        context.initialState.assertCallCountMatchesExpectations(
            this._calls,
            this.getCallCount(args),
            'method',
            this.property,
            args);

        if(!hasExpectations) {
            this._calls.push(args)
        }

        if (!hasExpectations) {
            if(this.mimicks)
                return this.mimicks.apply(this.mimicks, args);

            if(!this.returns.length)
                return context.proxy;
            const returns = this.returns.find(r => areArgumentArraysEqual(r.args, args))

            if (returns) {
                const returnValues = returns.returnValues as any[]
                if (returnValues.length === 1) {
                    return returnValues[0]
                }
                if (returnValues.length > returns.returnIndex) {
                    return returnValues[returns.returnIndex++]
                }
                return void 0 // probably a test setup error, imho throwin is more helpful -- domasx2
                //throw Error(`${String(this._getPropertyState.property)} with ${stringifyArguments(returns.args)} called ${returns.returnIndex + 1} times, but only ${returnValues.length} return values were set up`)
            }
        }
        return context.proxy
    }

    set(context: Context, property: PropertyKey, value: any) {
    }

    get(context: Context, property: PropertyKey) {
        if (property === 'then')
            return void 0;

        if(property === 'mimicks') {
            return (input: Function) => {
                this.mimicks = input;
                this._calls.pop()

                context.state = context.initialState;
            }
        }

        if(property === 'returns') {
            return (...returns: any[]) => {
                if (!this._lastArgs) {
                    throw new Error('Eh, there\'s a bug, no args recorded for this return :/')
                }
                this.returns.push({
                    returnValues: returns,
                    returnIndex: 0,
                    args: this._lastArgs
                })
                this._calls.pop()

                if(this.callCount === 0) {
                    // var indexOfSelf = this
                    //     ._getPropertyState
                    //     .recordedFunctionStates
                    //     .indexOf(this);
                    // this._getPropertyState
                    //     .recordedFunctionStates
                    //     .splice(indexOfSelf, 1);
                }

                context.state = context.initialState;
            };
        }

        return context.proxy;
    }
}