import { ObjectSubstitute } from "./Transformations";
export declare class Substitute {
    static for<T>(): ObjectSubstitute<T>;
    private static doesExistingCallMatchCount;
}
