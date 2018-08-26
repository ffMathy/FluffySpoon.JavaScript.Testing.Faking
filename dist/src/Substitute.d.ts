import { ObjectSubstitute, OmitProxyMethods, DisabledSubstituteObject } from "./Transformations";
export declare class Substitute {
    static isSubstitute<T>(instance: T): any;
    static disableFor<T extends ObjectSubstitute<OmitProxyMethods<any>>>(substitute: T): DisabledSubstituteObject<T>;
    static for<T>(): ObjectSubstitute<OmitProxyMethods<T>, T>;
    private static assertCallMatchCount;
}
