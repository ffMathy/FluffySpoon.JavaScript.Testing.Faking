import { ObjectSubstitute, OmitProxyMethods, DisabledSubstituteObject } from "./Transformations";
export declare const HandlerKey: unique symbol;
export declare const AreProxiesDisabledKey: unique symbol;
export declare type SubstituteOf<T extends Object> = ObjectSubstitute<OmitProxyMethods<T>, T> & T;
export declare class Substitute {
    static for<T>(): SubstituteOf<T>;
    static disableFor<T extends ObjectSubstitute<OmitProxyMethods<any>>>(substitute: T): DisabledSubstituteObject<T>;
}
