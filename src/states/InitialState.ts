import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { GetPropertyState } from "./GetPropertyState";
import { SetPropertyState } from "./SetPropertyState";
import { areArgumentArraysEqual } from "../Utilities";

export class InitialState implements ContextState {
    private recordedGetPropertyStates: Map<PropertyKey, GetPropertyState>;
    private recordedSetPropertyStates: SetPropertyState[];
    
    private _expectedCount: number;

    public get expectedCount() {
        return this._expectedCount;
    }

    public get hasExpectations() {
        return this._expectedCount !== void 0;
    }

    constructor() {
        this.recordedGetPropertyStates = new Map();
        this.recordedSetPropertyStates = [];

        this._expectedCount = void 0;
    }

    doesCallCountMatchExpectations(callCount: number) {
        if (!this.hasExpectations)
            return true;

        if (this.expectedCount === null && callCount > 0)
            return true;

        return this.expectedCount === callCount;
    }

    apply(context: Context, args: any[]) {
    }

    set(context: Context, property: PropertyKey, value: any) {
        const existingSetState = this.recordedSetPropertyStates.find(x => areArgumentArraysEqual(x.arguments, [value]));;
        if (existingSetState) {
            context.state = existingSetState;
            return context.set(property, value);
        }

        if (this.hasExpectations)
            throw new Error('No calls were made to property ' + property.toString() + ' but ' + this._expectedCount + ' calls were expected.');

        const setPropertyState = new SetPropertyState(property, value);
        context.state = setPropertyState;

        this.recordedSetPropertyStates.push(setPropertyState);
    }

    get(context: Context, property: PropertyKey) {
        if (typeof property === 'symbol') {
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
                console.log('expectation', count);

                this._expectedCount = count === void 0 ? null : count;
                return context.proxy;
            };
        }

        const existingGetState = this.recordedGetPropertyStates.get(property);
        if (existingGetState) {
            context.state = existingGetState;
            return context.get(property);
        }

        if (this.hasExpectations)
            throw new Error('No calls were made to property or method ' + property.toString() + ' but ' + this._expectedCount + ' calls were expected.');

        const getState = new GetPropertyState(property);
        context.state = getState;

        this.recordedGetPropertyStates.set(property, getState);

        return context.get(property);
    }
}