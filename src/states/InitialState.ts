import { ContextState, PropertyKey } from './ContextState';
import { Context } from '../Context';
import { GetPropertyState } from './GetPropertyState';
import { SetPropertyState } from './SetPropertyState';
import { SubstituteMethods, Call, PropertyType } from '../Utilities';
import { AreProxiesDisabledKey } from '../Substitute';
import { SubstituteException } from '../SubstituteBase';

export class InitialState implements ContextState {
    private recordedGetPropertyStates: Map<PropertyKey, GetPropertyState>;
    private recordedSetPropertyStates: SetPropertyState[];

    private _expectedCount: number | undefined | null;
    private _areProxiesDisabled: boolean;

    public get expectedCount(): number | undefined | null {
        return this._expectedCount;
    }

    public get hasExpectations(): boolean {
        return this._expectedCount !== void 0;
    }

    public get setPropertyStates(): SetPropertyState[] {
        return [...this.recordedSetPropertyStates];
    }

    public get getPropertyStates(): GetPropertyState[] {
        return [...this.recordedGetPropertyStates.values()];
    }

    public recordGetPropertyState(property: PropertyKey, getState: GetPropertyState): void {
        this.recordedGetPropertyStates.set(property, getState);
    }

    public recordSetPropertyState(setState: SetPropertyState): void {
        this.recordedSetPropertyStates.push(setState);
    }

    constructor() {
        this.recordedGetPropertyStates = new Map();
        this.recordedSetPropertyStates = [];

        this._areProxiesDisabled = false;
        this._expectedCount = void 0;
    }

    public assertCallCountMatchesExpectations(
        receivedCalls: Call[],
        receivedCount: number,
        type: PropertyType,
        propertyValue: PropertyKey,
        args: any[]
    ): void | never {
        const expectedCount = this._expectedCount;

        this.clearExpectations();
        if (this.doesCallCountMatchExpectations(expectedCount, receivedCount))
            return;

        const callCount = { expected: expectedCount, received: receivedCount };
        const property = { type, value: propertyValue };
        const calls = { expectedArguments: args, received: receivedCalls };

        throw SubstituteException.forCallCountMissMatch(callCount, property, calls);
    }

    private doesCallCountMatchExpectations(expectedCount: number | undefined | null, actualCount: number) {
        if (expectedCount === void 0)
            return true;

        if (expectedCount === null && actualCount > 0)
            return true;

        return expectedCount === actualCount;
    }

    apply(context: Context, args: any[]) { }

    set(context: Context, property: PropertyKey, value: any) {
        if (property === AreProxiesDisabledKey) {
            this._areProxiesDisabled = value;
            return;
        }

        const existingSetState = this.recordedSetPropertyStates.find(x => x.arguments[0] === value);
        if (existingSetState) {
            return existingSetState.set(context, property, value);
        }

        const setPropertyState = new SetPropertyState(property, value);
        this.recordedSetPropertyStates.push(setPropertyState);

        context.state = setPropertyState;
        return context.setStateSet(context, property, value);
    }

    get(context: Context, property: PropertyKey) {
        switch (property) {
            case AreProxiesDisabledKey:
                return this._areProxiesDisabled;
            case SubstituteMethods.received:
                return (count?: number) => {
                    this._expectedCount = count ?? null;
                    return context.receivedProxy;
                };
            case SubstituteMethods.didNotReceive:
                return () => {
                    this._expectedCount = 0;
                    return context.receivedProxy;
                };
            case SubstituteMethods.configure:
                return () => {
                    context.enableConfigurationMode();
                    return context.rootProxy;
                }
            default:
                return this.handleGet(context, property);
        }
    }

    private clearExpectations() {
        this._expectedCount = void 0;
    }

    onSwitchedTo() {
        this.clearExpectations();
    }

    public handleGet(context: Context, property: PropertyKey) {
        const existingGetState = this.getPropertyStates.find(state => state.property === property);
        if (existingGetState !== void 0) {
            context.state = existingGetState;
            return context.getStateGet(void 0, property);
        }

        const getState = new GetPropertyState(property);
        this.recordGetPropertyState(property, getState);

        context.state = getState;
        return context.getStateGet(void 0, property);
    }
}