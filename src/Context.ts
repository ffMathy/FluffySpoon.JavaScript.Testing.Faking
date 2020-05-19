import { inspect } from 'util'
import { ContextState } from './states/ContextState';
import { InitialState } from './states/InitialState';
import { HandlerKey } from './Substitute';
import { PropertyType } from './Utilities';
import { SetPropertyState } from './states/SetPropertyState';
import { SubstituteJS as SubstituteBase, SubstituteException } from './SubstituteBase'

export class Context {
    private _initialState: InitialState;

    private _proxy: any;
    private _rootProxy: any;
    private _receivedProxy: any;

    private _getState: ContextState;
    private _setState: ContextState;
    private _receivedState: ContextState;

    private _configurationMode: boolean;

    constructor() {
        this._initialState = new InitialState();
        this._setState = this._initialState;
        this._getState = this._initialState;

        this._configurationMode = false;

        this._proxy = new Proxy(SubstituteBase, {
            apply: (_target, _this, args) => this.getStateApply(_target, _this, args),
            set: (_target, property, value) => (this.setStateSet(_target, property, value), true),
            get: (_target, property) => this._filterAndReturnProperty(_target, property, this.getStateGet)
        });

        this._rootProxy = new Proxy(SubstituteBase, {
            apply: (_target, _this, args) => this.initialState.apply(this, args),
            set: (_target, property, value) => (this.initialState.set(this, property, value), true),
            get: (_target, property) => this._filterAndReturnProperty(_target, property, this.rootGet)
        });

        this._receivedProxy = new Proxy(SubstituteBase, {
            apply: (_target, _this, args) => this._receivedState === void 0 ? void 0 : this._receivedState.apply(this, args),
            set: (_target, property, value) => (this.setStateSet(_target, property, value), true),
            get: (_target, property) => {
                const state = this.initialState.getPropertyStates.find(getPropertyState => getPropertyState.property === property);
                if (state === void 0) return this.handleNotFoundState(property);
                if (!state.isFunctionState)
                    state.get(this, property);
                this._receivedState = state;
                return this.receivedProxy;
            }
        });
    }

    private _filterAndReturnProperty(target: typeof SubstituteBase, property: PropertyKey, getToExecute: ContextState['get']) {
        switch (property) {
            case 'constructor':
            case 'valueOf':
            case '$$typeof':
            case 'length':
            case 'toString':
            case 'inspect':
            case 'lastRegisteredSubstituteJSMethodOrProperty':
                return target.prototype[property];
            case Symbol.toPrimitive:
                return target.prototype[Symbol.toPrimitive];
            case inspect.custom:
                return target.prototype[inspect.custom];
            case Symbol.iterator:
                return target.prototype[Symbol.iterator];
            case Symbol.toStringTag:
                return target.prototype[Symbol.toStringTag];
            default:
                target.prototype.lastRegisteredSubstituteJSMethodOrProperty = property.toString()
                return getToExecute.bind(this)(target as any, property);
        }
    }

    private handleNotFoundState(property: PropertyKey) {
        if (this.initialState.hasExpectations && this.initialState.expectedCount !== null) {
            this.initialState.assertCallCountMatchesExpectations([], 0, PropertyType.property, property, []);
            return this.receivedProxy;
        }
        throw SubstituteException.forPropertyNotMocked(property);
    }

    rootGet(_target: any, property: PropertyKey) {
        return this.initialState.get(this, property);
    }

    getStateApply(_target: any, _this: any, args: any[]) {
        return this._getState.apply(this, args);
    }

    setStateSet(_target: any, property: PropertyKey, value: any) {
        return this._setState.set(this, property, value);
    }

    getStateGet(_target: any, property: PropertyKey) {
        if (property === HandlerKey) {
            return this;
        }

        return this._getState.get(this, property);
    }

    public enableConfigurationMode(): void {
        this._configurationMode = true;
    }

    public disableConfigurationMode(): void {
        this._configurationMode = false;
    }

    public isConfigurationMode(): boolean {
        return this._configurationMode;
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