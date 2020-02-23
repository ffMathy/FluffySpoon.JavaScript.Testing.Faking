import { ContextState, PropertyKey } from "./ContextState";
import { Context } from "src/Context";
import { GetPropertyState } from "./GetPropertyState";
import { SetPropertyState } from "./SetPropertyState";
import { SubstituteMethods, stringifyArguments, stringifyCalls, Call, Type, Get } from "../Utilities";
import { AreProxiesDisabledKey } from "../Substitute";
import { SubstituteException } from "../SubstituteBase";

export class InitialState implements ContextState {
    private recordedGetPropertyStates: Map<PropertyKey, GetPropertyState>;
    private recordedSetPropertyStates: SetPropertyState[];

    private _expectedCount: number | undefined | null;
    private _areProxiesDisabled: boolean;

    public get expectedCount() {
        // expected count of calls,
        // being assigned with received() method call
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

    public recordGetPropertyState(property: PropertyKey, getState: GetPropertyState) {
        this.recordedGetPropertyStates.set(property, getState);
    }

    public recordSetPropertyState(setState: SetPropertyState) {
        this.recordedSetPropertyStates.push(setState);
    }

    constructor() {
        this.recordedGetPropertyStates = new Map();
        this.recordedSetPropertyStates = [];

        this._areProxiesDisabled = false;
        this._expectedCount = void 0;
    }

    assertCallCountMatchesExpectations(
        receivedCalls: Call[], // list of arguments
        receivedCount: number,
        type: Type, // method or property
        propertyValue: PropertyKey,
        args: any[]
    ) {
        const expectedCount = this._expectedCount;

        this.clearExpectations();
        if (this.doesCallCountMatchExpectations(expectedCount, receivedCount))
            return;

        const callCount = { expected: expectedCount, received: receivedCount }
        const property = { type, value: propertyValue }
        const calls = { expectedArguments: args, received: receivedCalls }

        throw SubstituteException.forCallCountMissMatch(callCount, property, calls)
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

        const existingSetState = this.recordedSetPropertyStates.find(x => x.arguments[0] === value);;
        if (existingSetState) {
            return existingSetState.set(context, property, value);
        }

        const setPropertyState = new SetPropertyState(property, value);
        setPropertyState.set(context, property, value);

        context.state = setPropertyState;
        this.recordedSetPropertyStates.push(setPropertyState);
    }

    get(context: Context, property: PropertyKey) {
        switch (property) {
            case AreProxiesDisabledKey:
                return this._areProxiesDisabled;
            case SubstituteMethods.received:
                return (count?: number) => {
                    this._expectedCount = count === void 0 ? null : count;
                    return context.receivedProxy;
                };
            case SubstituteMethods.didNotReceive:
                return () => {
                    this._expectedCount = 0;
                    return context.receivedProxy;
                };
            default:
                return Get(this, context, property);
        }
    }

    private clearExpectations() {
        this._expectedCount = void 0;
    }

    onSwitchedTo() {
        this.clearExpectations();
    }
}