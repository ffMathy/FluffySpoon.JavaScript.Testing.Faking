import { ObjectSubstitute, OmitProxyMethods } from "./Transformations";
export declare class Substitute {
    static for<T>(): ObjectSubstitute<OmitProxyMethods<T>, T>;
}
