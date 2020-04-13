import test from 'ava';
import { areArgumentArraysEqual } from '../src/Utilities';
import { Arg } from '../src/index';

const testObject = { "foo": "bar" };
const testArray = ["a", 1, true];
const parent = {} as any;
parent.child = parent;

const root = {} as any;
root.path = { to: { nested: root } };
const testFunc = () => { };

//#region areArgumentArraysEqual
test('areArgumentArraysEqual should return valid result for primitive arguments', t => {
    // single 
    t.true(areArgumentArraysEqual([''], ['']));
    t.true(areArgumentArraysEqual(['a'], ['a']));
    t.true(areArgumentArraysEqual([0], [0]));
    t.true(areArgumentArraysEqual([1], [1]));
    t.true(areArgumentArraysEqual([true], [true]));
    t.true(areArgumentArraysEqual([false], [false]));
    t.true(areArgumentArraysEqual([undefined], [undefined]));
    t.true(areArgumentArraysEqual([null], [null]));
    t.true(areArgumentArraysEqual([testObject], [testObject]));
    t.true(areArgumentArraysEqual([testArray], [testArray]));
    t.true(areArgumentArraysEqual([testFunc], [testFunc]));
    t.true(areArgumentArraysEqual([parent], [parent]));
    t.true(areArgumentArraysEqual([root], [root]));

    t.false(areArgumentArraysEqual(['a'], ['b']));
    t.false(areArgumentArraysEqual([1], [2]));
    t.false(areArgumentArraysEqual([true], [false]));
    t.false(areArgumentArraysEqual([undefined], [null]));
    t.false(areArgumentArraysEqual([testObject], [testArray]));

    // multi
    t.true(areArgumentArraysEqual([1, 2, 3], [1, 2, 3]));

    t.false(areArgumentArraysEqual([1, 2, 3], [3, 2, 1]));
    t.false(areArgumentArraysEqual([1, 2, 3, 4], [1, 2, 3]));
    t.false(areArgumentArraysEqual([1, 2, 3], [1, 2, 3, 4]));
});

test('areArgumentArraysEqual should return valid result using Arg.all()', t => {
    t.true(areArgumentArraysEqual([Arg.all()], []));
    t.true(areArgumentArraysEqual([Arg.all()], [0]));
    t.true(areArgumentArraysEqual([Arg.all()], [1]));
    t.true(areArgumentArraysEqual([Arg.all()], ['string']));
    t.true(areArgumentArraysEqual([Arg.all()], [true]));
    t.true(areArgumentArraysEqual([Arg.all()], [false]));
    t.true(areArgumentArraysEqual([Arg.all()], [null]));
    t.true(areArgumentArraysEqual([Arg.all()], [undefined]));
    t.true(areArgumentArraysEqual([Arg.all()], [1, 2]));
    t.true(areArgumentArraysEqual([Arg.all()], ['string1', 'string2']));
    t.true(areArgumentArraysEqual([Arg.all()], [parent, root]));
})

test('areArgumentArraysEqual should return valid result using Arg.any()', t => {
    t.true(areArgumentArraysEqual([Arg.any()], ['hi']));
    t.true(areArgumentArraysEqual([Arg.any()], [1]));
    t.true(areArgumentArraysEqual([Arg.any()], [0]));
    t.true(areArgumentArraysEqual([Arg.any()], [false]));
    t.true(areArgumentArraysEqual([Arg.any()], [true]));
    t.true(areArgumentArraysEqual([Arg.any()], [null]));
    t.true(areArgumentArraysEqual([Arg.any()], [undefined]));
    t.true(areArgumentArraysEqual([Arg.any()], [testObject]));
    t.true(areArgumentArraysEqual([Arg.any()], [testArray]));
    t.true(areArgumentArraysEqual([Arg.any()], [testFunc]));
    t.true(areArgumentArraysEqual([Arg.any()], []));
    t.true(areArgumentArraysEqual([Arg.any()], [parent]));
    t.true(areArgumentArraysEqual([Arg.any()], [root]));

    t.true(areArgumentArraysEqual([Arg.any('string')], ['foo']));
    t.true(areArgumentArraysEqual([Arg.any('number')], [1]));
    t.true(areArgumentArraysEqual([Arg.any('boolean')], [true]));
    t.true(areArgumentArraysEqual([Arg.any('object')], [testObject]));
    t.true(areArgumentArraysEqual([Arg.any('array')], [testArray]));
    t.true(areArgumentArraysEqual([Arg.any('function')], [testFunc]));

    t.false(areArgumentArraysEqual([Arg.any('string')], [1]));
    t.false(areArgumentArraysEqual([Arg.any('number')], ['string']));
    t.false(areArgumentArraysEqual([Arg.any('boolean')], [null]));
    t.false(areArgumentArraysEqual([Arg.any('object')], ['foo']));
    t.false(areArgumentArraysEqual([Arg.any('array')], ['bar']));
    t.false(areArgumentArraysEqual([Arg.any('function')], ['foo']));
    t.true(areArgumentArraysEqual([Arg.any('object')], [parent]));
    t.true(areArgumentArraysEqual([Arg.any('object')], [root]));
})

test('areArgumentArraysEqual should return valid result using Arg.is()', t => {
    t.true(areArgumentArraysEqual([Arg.is(x => x === 'foo')], ['foo']));
    t.true(areArgumentArraysEqual([Arg.is(x => x % 2 == 0)], [4]));

    t.false(areArgumentArraysEqual([Arg.is(x => x === 'foo')], ['bar']));
    t.false(areArgumentArraysEqual([Arg.is(x => x % 2 == 0)], [3]));
});