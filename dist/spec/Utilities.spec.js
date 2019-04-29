"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var Utilities_1 = require("../src/Utilities");
var index_1 = require("../src/index");
var testObject = { "foo": "bar" };
var testArray = ["a", 1, true];
var testFunc = function () { };
//#region areArgumentArraysEqual
ava_1.default('areArgumentArraysEqual should return valid result for primitive arguments', function (t) {
    // single 
    t.true(Utilities_1.areArgumentArraysEqual([''], ['']));
    t.true(Utilities_1.areArgumentArraysEqual(['a'], ['a']));
    t.true(Utilities_1.areArgumentArraysEqual([0], [0]));
    t.true(Utilities_1.areArgumentArraysEqual([1], [1]));
    t.true(Utilities_1.areArgumentArraysEqual([true], [true]));
    t.true(Utilities_1.areArgumentArraysEqual([false], [false]));
    t.true(Utilities_1.areArgumentArraysEqual([undefined], [undefined]));
    t.true(Utilities_1.areArgumentArraysEqual([null], [null]));
    t.true(Utilities_1.areArgumentArraysEqual([testObject], [testObject]));
    t.true(Utilities_1.areArgumentArraysEqual([testArray], [testArray]));
    t.true(Utilities_1.areArgumentArraysEqual([testFunc], [testFunc]));
    t.false(Utilities_1.areArgumentArraysEqual(['a'], ['b']));
    t.false(Utilities_1.areArgumentArraysEqual([1], [2]));
    t.false(Utilities_1.areArgumentArraysEqual([true], [false]));
    t.false(Utilities_1.areArgumentArraysEqual([undefined], [null]));
    t.false(Utilities_1.areArgumentArraysEqual([testObject], [testArray]));
    // multi
    t.true(Utilities_1.areArgumentArraysEqual([1, 2, 3], [1, 2, 3]));
    t.false(Utilities_1.areArgumentArraysEqual([1, 2, 3], [3, 2, 1]));
    t.false(Utilities_1.areArgumentArraysEqual([1, 2, 3, 4], [1, 2, 3]));
    t.false(Utilities_1.areArgumentArraysEqual([1, 2, 3], [1, 2, 3, 4]));
});
ava_1.default('areArgumentArraysEqual should return valid result using Arg.all()', function (t) {
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], []));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], [0]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], [1]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], ['string']));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], [true]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], [false]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], [null]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], [undefined]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], [1, 2]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.all()], ['string1', 'string2']));
});
ava_1.default('areArgumentArraysEqual should return valid result using Arg.any()', function (t) {
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], ['hi']));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [1]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [0]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [false]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [true]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [null]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [undefined]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [testObject]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [testArray]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], [testFunc]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any()], []));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('string')], ['foo']));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('number')], [1]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('boolean')], [true]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('object')], [testObject]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('array')], [testArray]));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('function')], [testFunc]));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('string')], [1]));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('number')], ['string']));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('boolean')], [null]));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('object')], ['foo']));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('array')], ['bar']));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.any('function')], ['foo']));
});
ava_1.default('areArgumentArraysEqual should return valid result using Arg.is()', function (t) {
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.is(function (x) { return x === 'foo'; })], ['foo']));
    t.true(Utilities_1.areArgumentArraysEqual([index_1.Arg.is(function (x) { return x % 2 == 0; })], [4]));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.is(function (x) { return x === 'foo'; })], ['bar']));
    t.false(Utilities_1.areArgumentArraysEqual([index_1.Arg.is(function (x) { return x % 2 == 0; })], [3]));
});
//# sourceMappingURL=Utilities.spec.js.map