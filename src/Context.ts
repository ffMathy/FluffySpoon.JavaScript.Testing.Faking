import { ContextState } from "./states/ContextState";
import { InitialState } from "./states/InitialState";
import { HandlerKey } from "./Substitute";

export class Context {
    private _initialState: InitialState;

    private _proxy: any;
    private _rootProxy: any;
    
    private _state: ContextState;

    constructor() {
        this._initialState = new InitialState();
        this._state = this._initialState;

        this._proxy = new Proxy(() => { }, {
            apply: (_target, _this, args) => {
                return this.apply(args);
            },
            set: (_target, property, value) => {
                this.set(property, value);
                return true;
            },
            get: (_target, property) => {
                return this.get(property);
            }
        });

        this._rootProxy = new Proxy(() => { }, {
            apply: (_target, _this, args) => {
                return this.initialState.apply(this, args);
            },
            set: (_target, property, value) => {
                this.initialState.set(this, property, value);
                return true;
            },
            get: (_target, property) => {
                return this.initialState.get(this, property);
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