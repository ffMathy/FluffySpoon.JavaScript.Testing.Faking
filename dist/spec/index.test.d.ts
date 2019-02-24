declare class Dummy {
}
export declare class Example {
    a: string;
    c(arg1: string, arg2: string): string;
    readonly d: number;
    v: string | null | undefined;
    received(stuff: number | string): void;
    returnPromise(): Promise<Dummy>;
    foo(): string | undefined | null;
}
export {};
