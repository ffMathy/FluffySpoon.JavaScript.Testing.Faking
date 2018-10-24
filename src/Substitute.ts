import { Context } from "./Context";
import { ObjectSubstitute, OmitProxyMethods } from "./Transformations";

export class Substitute {
    static for<T>(): ObjectSubstitute<OmitProxyMethods<T>, T> {
        const objectContext = new Context();
        return objectContext.rootProxy;
    }

    // private static assertCallMatchCount(
    //     type: 'property' | 'method', 
    //     thisProxy: any,
    //     objectContext: ProxyObjectContext, 
    //     allCalls: ProxyCallRecord[],
    //     matchingCalls: ProxyCallRecord[]): void 
    // {
    //     const expected = objectContext.calls.expected;
    //     objectContext.property = null;
    //     objectContext.calls.expected = null;
                        
    //     thisProxy[areProxiesDisabledKey] = false;

    //     const getCallCounts = (calls: ProxyCallRecord[]) => {
    //         const callCounts = calls.map(x => x.callCount);
    //         const totalCallCount = callCounts.length === 0 ? 0 : callCounts.reduce((accumulator, value) => accumulator + value);
    //         return totalCallCount;
    //     }

    //     const matchingCallsCount = getCallCounts(matchingCalls);

    //     const isMatch = 
    //     !(
    //         (
    //             !expected.negated && (
    //                 (expected.callCount === null && matchingCallsCount === 0) ||
    //                 (expected.callCount !== null && expected.callCount !== matchingCallsCount)
    //             )
    //         ) ||
    //         (
    //             expected.negated && (
    //                 (expected.callCount === null && matchingCallsCount !== 0) ||
    //                 (expected.callCount !== null && expected.callCount === matchingCallsCount)
    //             )
    //         )
    //     );
        
    //     if (!isMatch) {
    //         let errorMessage = '';

    //         errorMessage += expected.negated ? 'Did not expect' : 'Expected';
    //         errorMessage += ' ';
    //         errorMessage += expected.callCount === null ? 'one or more' : expected.callCount;
    //         errorMessage += ' call';
    //         errorMessage += (expected.callCount === null || expected.callCount !== 1) ? 's' : '';
    //         errorMessage += ' to the ';
    //         errorMessage += type;
    //         errorMessage += ' ';
    //         errorMessage += expected.propertyName;

    //         if(expected.arguments) {
    //             if(type === 'property') {
    //                 errorMessage += ' with value ';

    //                 const value = expected.arguments[0];
    //                 if(value === null)
    //                     errorMessage += 'null';
                    
    //                 if(value === void 0)
    //                     errorMessage += 'undefined';

    //                 if(value)
    //                     errorMessage += value;
    //             } else if(type === 'method') {
    //                 errorMessage += ' with ';
    //                 errorMessage += stringifyArguments(expected.arguments);
    //             }
    //         }

    //         errorMessage += ', but received ';
    //         errorMessage += matchingCallsCount === 0 ? 'none' : matchingCallsCount;

    //         if(expected.arguments) {
    //             errorMessage += ' of such call';
    //             errorMessage += matchingCallsCount !== 1 ? 's' : '';
    //         }

    //         errorMessage += '.';

    //         if(expected.arguments) {
    //             errorMessage += '\nAll calls received to ';
    //             errorMessage += type;
    //             errorMessage += ' ';
    //             errorMessage += expected.propertyName;
    //             errorMessage += ':';
    //             errorMessage += stringifyCalls(allCalls);
    //         }

    //         throw new Error(errorMessage);
    //     }
    // }
}