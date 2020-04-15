import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "../Context";
import { SubstituteMethods, areArgumentArraysEqual, Call, Type } from "../Utilities";
import { GetPropertyState } from "./GetPropertyState";
import { SubstituteException } from "../SubstituteBase";

interface ReturnMock {
    args: Call
    returnValues: any[] | Symbol // why symbol, what
    returnIndex: 0
}
interface MimickMock {
    args: Call
    mimickFunction: Function
}
interface ThrowMock {
    args: Call
    throwFunction: any
}

export class FunctionState implements ContextState {
    private returns: ReturnMock[];
    private mimicks: MimickMock[];
    private throws: ThrowMock[];

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
        this.mimicks = [];
        this._calls = [];
        this.throws = [];
    }

    private getCallCount(args: Call): number {
        return this._calls.filter(callArgs => areArgumentArraysEqual(callArgs, args)).length;
    }

    apply(context: Context, args: any[]) {
        const hasExpectations = context.initialState.hasExpectations;
        this._lastArgs = args

        context.initialState.assertCallCountMatchesExpectations(
            this._calls,
            this.getCallCount(args),
            Type.method,
            this.property,
            args);

        if (!hasExpectations) {
            this._calls.push(args)
        }

        if (!hasExpectations) {
            if (this.mimicks.length > 0) {
                const mimicks = this.mimicks.find(mimick => areArgumentArraysEqual(mimick.args, args))
                if (mimicks !== void 0) return mimicks.mimickFunction.apply(mimicks.mimickFunction, args);
            }

            if (this.throws.length > 0) {
                const possibleThrow = this.throws.find(throws => areArgumentArraysEqual(throws.args, args))
                if (possibleThrow !== void 0) throw possibleThrow.throwFunction;
            }

            if (!this.returns.length)
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

        if (property === SubstituteMethods.mimicks) {
            return (input: Function) => {
                if (!this._lastArgs) {
                    throw SubstituteException.generic('Eh, there\'s a bug, no args recorded for this mimicks :/')
                }
                this.mimicks.push({
                    args: this._lastArgs,
                    mimickFunction: input
                })
                this._calls.pop()

                context.state = context.initialState;
            }
        }

        if (property === SubstituteMethods.throws) {
            return (input: Error | Function) => {
                if (!this._lastArgs) {
                    throw SubstituteException.generic('Eh, there\'s a bug, no args recorded for this throw :/')
                }
                this.throws.push({
                    args: this._lastArgs,
                    throwFunction: input
                });
                this._calls.pop();
                context.state = context.initialState;
            }
        }

        if (property === SubstituteMethods.returns
            || property === SubstituteMethods.resolves
            || property === SubstituteMethods.rejects
        ) {
            return (...returnValues: any[]) => {
                if (!this._lastArgs) {
                    throw SubstituteException.generic('Eh, there\'s a bug, no args recorded for this return :/');
                }
                const returnMock: Partial<ReturnMock> = { returnIndex: 0, args: this._lastArgs };
                const returns = returnValues.length === 0 ? [void 0] : returnValues
                switch (property) {
                    case SubstituteMethods.returns:
                        returnMock.returnValues = returns;
                        break;
                    case SubstituteMethods.resolves:
                        returnMock.returnValues = returns.map(value => Promise.resolve(value));
                        break;
                    case SubstituteMethods.rejects:
                        returnMock.returnValues = returns.map(value => Promise.reject(value));
                        break;
                    default:
                        throw SubstituteException.generic(
                            `Expected one of the following methods: "${SubstituteMethods.returns}", "${SubstituteMethods.resolves}" or "${SubstituteMethods.rejects}"`
                        );
                }
                this.returns.push(<ReturnMock>returnMock);
                this._calls.pop()

                if (this.callCount === 0) {
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