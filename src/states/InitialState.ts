import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { GetPropertyState } from "./GetPropertyState";
import { SetPropertyState } from "./SetPropertyState";
import { stringifyArguments, stringifyCalls, Call } from "../Utilities";
import { AreProxiesDisabledKey } from "../Substitute";

export class InitialState implements ContextState {
    private recordedGetPropertyStates: Map<PropertyKey, GetPropertyState>;
    private recordedSetPropertyStates: SetPropertyState[];
    
    private _expectedCount: number|undefined|null;
    private _areProxiesDisabled: boolean;

    public get expectedCount() {
        return this._expectedCount;
    }

    public get hasExpectations() {
        return this._expectedCount !== void 0;
    }

    public get setPropertyStates() {
        return [...this.recordedSetPropertyStates];
    }

    public get getPropertyStates() {
        return [...this.recordedGetPropertyStates.values()];
    }

    constructor() {
        this.recordedGetPropertyStates = new Map();
        this.recordedSetPropertyStates = [];

        this._areProxiesDisabled = false;
        this._expectedCount = void 0;
    }

    assertCallCountMatchesExpectations(calls: Call[], callCount: number, type: string, property: PropertyKey, args: any[]) {
        const expectedCount = this._expectedCount;

        this.clearExpectations();

        if(this.doesCallCountMatchExpectations(expectedCount, callCount))
            return;

        throw new Error('Expected ' + (expectedCount === null ? '1 or more' : expectedCount) + ' call' + (expectedCount === 1 ? '' : 's') + ' to the ' + type + ' ' + property.toString() + ' with ' + stringifyArguments(args) + ', but received ' + (callCount === 0 ? 'none' : callCount) + ' of such call' + (callCount === 1 ? '' : 's') + '.\nAll calls received to ' + type + ' ' + property.toString() + ':' + stringifyCalls(calls));
    }

    private doesCallCountMatchExpectations(expectedCount: number|undefined|null, actualCount: number) {
        if (expectedCount === void 0)
            return true;

        if (expectedCount === null && actualCount > 0)
            return true;

        return expectedCount === actualCount;
    }

    apply(context: Context, args: any[]) {
    }

    set(context: Context, property: PropertyKey, value: any) {
        if(property === AreProxiesDisabledKey) {
            this._areProxiesDisabled = value;
            return;
        }

        const existingSetState = this.recordedSetPropertyStates.find(x => x.arguments[0] === value);;
        if (existingSetState) {
            return existingSetState.set(context, property, value);
        }

        const setPropertyState = new SetPropertyState(property, value);
        context.state = setPropertyState;

        this.recordedSetPropertyStates.push(setPropertyState);

        setPropertyState.set(context, property, value);
    }

    get(context: Context, property: PropertyKey) {
        if (typeof property === 'symbol') {
            if(property === AreProxiesDisabledKey)
                return this._areProxiesDisabled;

            if (property === Symbol.toPrimitive)
                return () => '{SubstituteJS fake}';

            if (property === Symbol.iterator)
                return void 0;

            if (property === Symbol.toStringTag)
                return 'Substitute';

            if(property.toString() === 'Symbol(util.inspect.custom)')
                return void 0;
        }

        if (property === 'valueOf')
            return '{SubstituteJS fake}';

        if (property === '$$typeof')
            return '{SubstituteJS fake}';

        if (property === 'length')
            return '{SubstituteJS fake}';

        if (property === 'toString')
            return '{SubstituteJS fake}';

        if (property === 'inspect')
            return () => '{SubstituteJS fake}';

        if (property === 'constructor')
            return () => context.rootProxy;

        if (property === 'received') {
            return (count?: number) => {
                this._expectedCount = count === void 0 ? null : count;
                return context.proxy;
            };
        }

        const existingGetState = this.recordedGetPropertyStates.get(property);
        if (existingGetState) {
            context.state = existingGetState;
            return context.get(property);
        }

        const getState = new GetPropertyState(property);
        context.state = getState;

        this.recordedGetPropertyStates.set(property, getState);

        return context.get(property);
    }

    private clearExpectations() {
        this._expectedCount = void 0;
    }

    onSwitchedTo() {
        this.clearExpectations();
    }
}