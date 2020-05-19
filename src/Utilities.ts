import { Argument, AllArguments } from './Arguments';
import { GetPropertyState } from './states/GetPropertyState';
import { InitialState } from './states/InitialState';
import { Context } from './Context';
import * as util from 'util';

export type Call = any[] // list of args

export enum PropertyType {
    method = 'method',
    property = 'property'
}

export enum SubstituteMethods {
    received = 'received',
    didNotReceive = 'didNotReceive',
    mimicks = 'mimicks',
    configure = 'configure',
    throws = 'throws',
    returns = 'returns',
    resolves = 'resolves',
    rejects = 'rejects'
}

const seenObject = Symbol();

export function stringifyArguments(args: any[]) {
    args = args.map(x => util.inspect(x));
    return args && args.length > 0 ? 'arguments [' + args.join(', ') + ']' : 'no arguments';
};

export function areArgumentArraysEqual(a: any[], b: any[]) {
    if (a.find(x => x instanceof AllArguments) || b.find(b => b instanceof AllArguments)) {
        return true;
    }

    for (let i = 0; i < Math.max(b.length, a.length); i++) {
        if (!areArgumentsEqual(b[i], a[i])) {
            return false;
        }
    }

    return true;
}

export function stringifyCalls(calls: Call[]) {

    if (calls.length === 0)
        return ' (no calls)';

    let output = '';
    for (let call of calls) {
        output += '\n-> call with ' + (call.length ? stringifyArguments(call) : '(no arguments)')
    }

    return output;
};

export function areArgumentsEqual(a: any, b: any) {

    if (a instanceof Argument && b instanceof Argument)
        return false;

    if (a instanceof AllArguments || b instanceof AllArguments)
        return true;

    if (a instanceof Argument)
        return a.matches(b);

    if (b instanceof Argument)
        return b.matches(a);

    return deepEqual(a, b);
};

function deepEqual(realA: any, realB: any, objectReferences: object[] = []): boolean {
    const a = objectReferences.includes(realA) ? seenObject : realA;
    const b = objectReferences.includes(realB) ? seenObject : realB;
    const newObjectReferences = updateObjectReferences(objectReferences, a, b);

    if (nonNullObject(a) && nonNullObject(b)) {
        if (a.constructor !== b.constructor) return false;
        const objectAKeys = Object.keys(a);
        if (objectAKeys.length !== Object.keys(b).length) return false;
        for (const key of objectAKeys) {
            if (!deepEqual(a[key], b[key], newObjectReferences)) return false;
        }
        return true;
    }
    return a === b;
}

function updateObjectReferences(objectReferences: Array<object>, a: any, b: any) {
    const tempObjectReferences = [...objectReferences, nonNullObject(a) && !objectReferences.includes(a) ? a : void 0];
    return [...tempObjectReferences, nonNullObject(b) && !tempObjectReferences.includes(b) ? b : void 0];
}

function nonNullObject(value: any): value is { [key: string]: any } {
    return typeof value === 'object' && value !== null;
}