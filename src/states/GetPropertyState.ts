import { ContextState, PropertyKey } from './ContextState';
import { Context } from '../Context';
import { PropertyType, SubstituteMethods, Call, areArgumentArraysEqual } from '../Utilities';
import { SubstituteException } from '../SubstituteBase';

interface SubstituteMock {
    arguments: Call
    mockValues: any[]
    substituteType: SubstituteMethods
}

export class GetPropertyState implements ContextState {
    private _mocks: SubstituteMock[];
    private _recordedCalls: Call[];
    private _isFunctionState: boolean;
    private _lastArgs?: Call;

    public get property(): PropertyKey {
        return this._property;
    }

    get isFunctionState(): boolean {
        return this._isFunctionState;
    }

    public get callCount(): number {
        return this._recordedCalls.length;
    }

    constructor(private _property: PropertyKey) {
        this._mocks = [];
        this._recordedCalls = [];
        this._isFunctionState = false;
    }

    private getCallCount(args: Call): number {
        const callFilter = (recordedCall: Call): boolean => areArgumentArraysEqual(recordedCall, args);
        return this._recordedCalls.filter(callFilter).length;
    }

    private applySubstituteMethodLogic(substituteMethod: SubstituteMethods, mockValue: any, args?: Call) {
        switch (substituteMethod) {
            case SubstituteMethods.resolves:
                return Promise.resolve(mockValue);
            case SubstituteMethods.rejects:
                return Promise.reject(mockValue);
            case SubstituteMethods.returns:
                return mockValue;
            case SubstituteMethods.throws:
                throw mockValue;
            case SubstituteMethods.mimicks:
                return mockValue.apply(mockValue, args);
            default:
                throw SubstituteException.generic(`Method ${substituteMethod} not implemented`)
        }
    }

    private processProperty(context: Context, args: any[], propertyType: PropertyType) {
        const hasExpectations = context.initialState.hasExpectations;
        if (!hasExpectations) {
            this._recordedCalls.push(args);
            const foundSubstitute = this._mocks.find(mock => areArgumentArraysEqual(mock.arguments, args));
            if (foundSubstitute !== void 0) {
                const mockValue = foundSubstitute.mockValues.length > 1 ?
                    foundSubstitute.mockValues.shift() :
                    foundSubstitute.mockValues[0];
                return this.applySubstituteMethodLogic(foundSubstitute.substituteType, mockValue, args);
            }
        }

        context.initialState.assertCallCountMatchesExpectations(
            this._recordedCalls,
            this.getCallCount(args),
            propertyType,
            this.property,
            args
        );

        return context.proxy;
    }

    apply(context: Context, args: any[]) {
        if (!this._isFunctionState) {
            this._isFunctionState = true;
            this._recordedCalls = [];
        }
        this._lastArgs = args;
        return this.processProperty(context, args, PropertyType.method);
    }

    set(context: Context, property: PropertyKey, value: any) { }

    private isSubstituteMethod(property: PropertyKey): property is SubstituteMethods {
        return property === SubstituteMethods.returns ||
            property === SubstituteMethods.mimicks ||
            property === SubstituteMethods.throws ||
            property === SubstituteMethods.resolves ||
            property === SubstituteMethods.rejects;
    }

    private sanitizeSubstituteMockInputs(mockInputs: Call): Call {
        if (mockInputs.length === 0) return [undefined];
        return mockInputs.length > 1 ?
            [...mockInputs, undefined] :
            [...mockInputs];
    }

    get(context: Context, property: PropertyKey) {
        if (property === 'then') return void 0;

        if (this.isSubstituteMethod(property)) {
            return (...inputs: Call) => {
                const mockInputs = this.sanitizeSubstituteMockInputs(inputs);
                const args = this._isFunctionState ? this._lastArgs : [];
                if (args === void 0)
                    throw SubstituteException.generic('Eh, there\'s a bug, no args recorded :/');

                this._mocks.push({
                    arguments: args,
                    mockValues: mockInputs,
                    substituteType: property
                });

                this._recordedCalls.pop();
                context.state = context.initialState;
            }
        }
        if (this._isFunctionState) return context.proxy;
        return this.processProperty(context, [], PropertyType.property);
    }
}