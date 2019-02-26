import { ObjectSubstitute, OmitProxyMethods, DisabledSubstituteObject } from "./Transformations";
export declare const HandlerKey: unique symbol;
export declare const AreProxiesDisabledKey: unique symbol;
export declare class Substitute {
    static for<T>(): ObjectSubstitute<OmitProxyMethods<T>, T> & T;
    static disableFor<T extends ObjectSubstitute<OmitProxyMethods<any>>>(substitute: T): DisabledSubstituteObject<T>;
}
