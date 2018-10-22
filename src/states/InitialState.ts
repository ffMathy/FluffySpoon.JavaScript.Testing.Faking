import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { PropertyState } from "./PropertyState";

export class InitialState implements ContextState {
    private recordedGetStates: Map<PropertyKey, PropertyState>;
    private _expectedCount: number;

    public get expectedCount() {
        return this._expectedCount;
    }

    public get hasExpectations() {
        return this._expectedCount !== void 0;
    }

    constructor() {
        this.recordedGetStates = new Map();
        this._expectedCount = void 0;
    }

    doesCallCountMatchExpectations(callCount: number) {
        if(!this.hasExpectations)
            return true;

        if(this.expectedCount === null && callCount > 0)
            return true;

        return this.expectedCount === callCount;
    }

    apply(context: Context, args: any[]) {
    }

    set(context: Context, property: PropertyKey, value: any) {
    }

    get(context: Context, property: PropertyKey) {
        if (typeof property === 'symbol') {
            if (property === Symbol.toPrimitive)
                return () => void 0;
            
            if(property === Symbol.toStringTag)
                return void 0;
        }

        if (property === 'valueOf')
            return void 0;

        if (property === 'toString')
            return '{SubstituteJS fake}';

        if (property === 'inspect')
            return () => '{SubstituteJS fake}';

        if (property === 'constructor')
            return () => context.proxy;

        if(property === 'then')
            return void 0;
            
        if(property === 'received') {
            return (count?: number) => {
                console.log('expectation', count);

                this._expectedCount = count === void 0 ? null : count;
                return context.proxy;
            };
        }

        const existingGetState = this.recordedGetStates.get(property);
        if(existingGetState) {
            context.state = existingGetState;
            return context.get(property);
        }

        if(this.hasExpectations)
            throw new Error('No calls were made to property or method ' + property.toString() + ' but ' + this._expectedCount + ' calls were expected.');

        const getState = new PropertyState(property);
        context.state = getState;

        this.recordedGetStates.set(property, getState);

        return context.get(property);
    }
}