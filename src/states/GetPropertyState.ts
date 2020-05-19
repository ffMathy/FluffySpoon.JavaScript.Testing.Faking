import { ContextState, PropertyKey } from './ContextState';
import { Context } from '../Context';
import { PropertyType, SubstituteMethods, Call, areArgumentArraysEqual, areArgumentsEqual } from '../Utilities';
import { SubstituteException } from '../SubstituteBase';
import { Argument, AllArguments } from '../Arguments';

interface SubstituteMock {
    arguments: Call
    mockValues: any[]
    substituteType: SubstituteMethods
}

interface ClassifiedSubstituteMocks {
    'only-primitives': SubstituteMock[]
    'with-single-argument': SubstituteMock[]
    'all-argument': SubstituteMock[]

}

type ArgClassification = 'only-primitives' | 'with-single-argument' | 'all-argument'

export class GetPropertyState implements ContextState {
    private _mocks: ClassifiedSubstituteMocks;
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
        this._mocks = {
            'only-primitives': [],
            'with-single-argument': [],
            'all-argument': []
        };
        this._recordedCalls = [];
        this._isFunctionState = false;
    }

    private getCallCount(args: Call): number {
        const callFilter = (recordedCall: Call): boolean => areArgumentArraysEqual(recordedCall, args);
        return this._recordedCalls.filter(callFilter).length;
    }

    private findSubstituteMock(argsToMatch: Call): SubstituteMock | undefined {
        const findFilter = (args: Call) => (mock: SubstituteMock) => areArgumentArraysEqual(mock.arguments, args);
        return this._mocks['only-primitives'].find(findFilter(argsToMatch)) ??
            this._mocks['with-single-argument'].find(findFilter(argsToMatch)) ??
            this._mocks['all-argument'].find(findFilter(argsToMatch));

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
        if (!hasExpectations && !context.isConfigurationMode()) {
            this._recordedCalls.push(args);

            const foundSubstitute = this.findSubstituteMock(args)
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

    private sanitizeSubstituteMockValues(mockInputs: Call): Call {
        if (mockInputs.length === 0) return [undefined];
        return mockInputs.length > 1 ?
            [...mockInputs, undefined] :
            [...mockInputs];
    }

    private classifyArguments(args: Call): ArgClassification {
        const allPrimitives = args.every(arg => !(arg instanceof Argument || arg instanceof AllArguments));
        if (allPrimitives)
            return 'only-primitives';
        const hasSingleArgument = args.some(arg => arg instanceof Argument);
        if (hasSingleArgument)
            return 'with-single-argument';
        return 'all-argument';
    }

    private calculateMockPosition(mocks: SubstituteMock[], argsType: ArgClassification, args: Call): -1 | number {
        if (argsType === 'all-argument')
            return 0;
        if (argsType === 'only-primitives')
            return mocks.findIndex(mock => areArgumentArraysEqual(mock.arguments, args));

        return mocks.findIndex((mock) => {
            const mockArguments = mock.arguments

            for (let i = 0; i < Math.max(mockArguments.length, args.length); i++) {
                const currentMockArgument: Argument<any> | unknown = mockArguments[i]
                const currentArgument: Argument<any> | unknown = args[i]

                if (currentMockArgument instanceof Argument && currentArgument instanceof Argument) {
                    if (currentMockArgument.toString() !== currentArgument.toString()) return false;
                    continue;
                }

                if (currentMockArgument instanceof Argument || currentArgument instanceof Argument)
                    return false;

                if (!areArgumentsEqual(currentMockArgument, currentArgument)) return false;
            }

            return true;
        })
    }

    get(context: Context, property: PropertyKey) {
        if (property === 'then') return void 0;

        if (this.isSubstituteMethod(property)) {
            return (...values: Call) => {
                const args = this._isFunctionState ? this._lastArgs : [];
                if (args === void 0)
                    throw SubstituteException.generic('Eh, there\'s a bug, no args recorded :/');
                const argsType = this.classifyArguments(args)

                const mockValues = this.sanitizeSubstituteMockValues(values);
                const substituteMock = {
                    arguments: argsType === 'all-argument' ? [new AllArguments()] : args,
                    substituteType: property,
                    mockValues
                };

                const mockPosition = this.calculateMockPosition(this._mocks[argsType], argsType, args);
                if (mockPosition < 0)
                    this._mocks[argsType].push(substituteMock);
                else
                    this._mocks[argsType][mockPosition] = substituteMock;

                this._recordedCalls.pop();
                context.disableConfigurationMode();
                context.state = context.initialState;
            }
        }
        if (this._isFunctionState) return context.proxy;
        return this.processProperty(context, [], PropertyType.property);
    }
}