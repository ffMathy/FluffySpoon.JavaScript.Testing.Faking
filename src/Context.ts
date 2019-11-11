import { ContextState } from "./states/ContextState";
import { InitialState } from "./states/InitialState";
import { HandlerKey } from "./Substitute";

export class Context {
    private _initialState: InitialState;

    private _proxy: any;
    private _rootProxy: any;
    private _receivedProxy: any;
    
    private _state: ContextState;
    private _receivedState: ContextState;

    constructor() {
        this._initialState = new InitialState();
        this._state = this._initialState;

        this._proxy = new Proxy(() => { }, {
            apply: (_target, _this, args) => this.apply(args),
            set: (_target, property, value) => (this.set(property, value), true),
            get: (_target, property) => this.get(property)
        });

        this._rootProxy = new Proxy(() => { }, {
            apply: (_target, _this, args) => this.initialState.apply(this, args),
            set: (_target, property, value) => (this.initialState.set(this, property, value), true),
            get: (_target, property) => this.initialState.get(this, property)
        });

        this._receivedProxy = new Proxy(() => { }, {
            apply: (_target, _this, args) => this._receivedState.apply(this, args),
            set: (_target, property, value) => (this.set(property, value), true),
            get: (_target, property) => {
                console.log(this.initialState.getPropertyStates)
                const state = this.initialState.getPropertyStates.find(getPropertyState => getPropertyState.property === property)
                if (state === void 0) throw new Error(`there are no mock for property: ${String(property)}`)
                this._receivedState = state
                return this.receivedProxy;
            }
        });
    }

    apply(args: any[]) {
        return this._state.apply(this, args);
    }

    set(property: PropertyKey, value: any) {
        return this._state.set(this, property, value);
    }

    get(property: PropertyKey) {
        if(property === HandlerKey)
            return this;

        return this._state.get(this, property);
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
        if(this._state === state)
            return;

        this._state = state;
        if(state.onSwitchedTo)
            state.onSwitchedTo(this);
    }
}