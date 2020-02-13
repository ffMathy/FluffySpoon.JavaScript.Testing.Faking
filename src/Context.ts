import { ContextState } from "./states/ContextState";
import { InitialState } from "./states/InitialState";
import { HandlerKey } from "./Substitute";
import { Type } from "./Utilities";
import { SetPropertyState } from "./states/SetPropertyState";

class SubstituteJS { }

export class Context {
    private _initialState: InitialState;

    private _proxy: any;
    private _rootProxy: any;
    private _receivedProxy: any;

    private _getState: ContextState;
    private _setState: ContextState;
    private _receivedState: ContextState;

    constructor() {
        this._initialState = new InitialState();
        this._setState = this._initialState
        this._getState = this._initialState;

        this._proxy = new Proxy(SubstituteJS, {
            apply: (_target, _this, args) => this.apply(_target, _this, args),
            set: (_target, property, value) => (this.set(_target, property, value), true),
            get: (_target, property) => this.get(_target, property),
            getOwnPropertyDescriptor: (obj, prop) => prop === 'constructor' ?
                { value: obj, configurable: true } : Reflect.getOwnPropertyDescriptor(obj, prop)
        });

        this._rootProxy = new Proxy(SubstituteJS, {
            apply: (_target, _this, args) => this.initialState.apply(this, args),
            set: (_target, property, value) => (this.initialState.set(this, property, value), true),
            get: (_target, property) => this.initialState.get(this, property)
        });

        this._receivedProxy = new Proxy(SubstituteJS, {
            apply: (_target, _this, args) => this._receivedState === void 0 ? void 0 : this._receivedState.apply(this, args),
            set: (_target, property, value) => (this.set(_target, property, value), true),
            get: (_target, property) => {
                const state = this.initialState.getPropertyStates.find(getPropertyState => getPropertyState.property === property);
                if (state === void 0) return this.handleNotFoundState(property);
                if (!state.functionState)
                    state.get(this, property);
                this._receivedState = state;
                return this.receivedProxy;
            }
        });
    }

    private handleNotFoundState(property: PropertyKey) {
        if (this.initialState.hasExpectations && this.initialState.expectedCount !== null) {
            this.initialState.assertCallCountMatchesExpectations([], 0, Type.property, property, []);
            return this.receivedProxy;
        }
        throw new Error(`there is no mock for property: ${String(property)}`);
    }

    apply(_target: any, _this: any, args: any[]) {
        return this._getState.apply(this, args);
    }

    set(_target: any, property: PropertyKey, value: any) {
        return this._setState.set(this, property, value);
    }

    get(_target: any, property: PropertyKey) {
        if (property === HandlerKey) {
            return this;
        }

        return this._getState.get(this, property);
    }

    public get proxy() {
        return this._proxy;
    }

    public get rootProxy() {
        return this._rootProxy;
    }

    public get receivedProxy() {
        return this._receivedProxy;
    }

    public get initialState() {
        return this._initialState;
    }

    public set state(state: ContextState) {
        if (this._setState === state)
            return;

        state instanceof SetPropertyState ?
            this._setState = state : this._getState = state
        if (state.onSwitchedTo)
            state.onSwitchedTo(this);
    }
}