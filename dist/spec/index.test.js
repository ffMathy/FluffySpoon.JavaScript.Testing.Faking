"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var Index_1 = require("../src/Index");
var Utilities_1 = require("../src/Utilities");
var Example = /** @class */ (function () {
    function Example() {
        this.a = "1337";
    }
    Example.prototype.c = function (arg1, arg2) {
        return "hello " + arg1 + " world (" + arg2 + ")";
    };
    Object.defineProperty(Example.prototype, "d", {
        get: function () {
            return 1337;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Example.prototype, "v", {
        set: function (x) {
            console.log('define: ' + x);
        },
        enumerable: true,
        configurable: true
    });
    return Example;
}());
exports.Example = Example;
var substitute;
ava_1.default.beforeEach(function () {
    substitute = Index_1.Substitute.for();
});
ava_1.default('are arguments equal', function (t) {
    t.false(Utilities_1.areArgumentsEqual(['foo', 'bar'], ['foo', 'bar']));
    t.true(Utilities_1.areArgumentsEqual(Index_1.Arg.any('array'), ['foo', 'bar']));
});
ava_1.default('class string field returns', function (t) {
    substitute.a.returns("foo", "bar");
    t.deepEqual(substitute.a, 'foo');
    t.deepEqual(substitute.a, 'bar');
    t.deepEqual(substitute.a, void 0);
    t.deepEqual(substitute.a, void 0);
});
ava_1.default('class string field received', function (t) {
    substitute.a.returns("foo", "bar");
    void substitute.a;
    void substitute.a;
    void substitute.a;
    void substitute.a;
    t.throws(function () { return substitute.received(3).a; });
    t.notThrows(function () { return substitute.received().a; });
    t.notThrows(function () { return substitute.received(4).a; });
});
ava_1.default('class method returns', function (t) {
    substitute.c("hi", "there").returns("blah", "haha");
    t.deepEqual(substitute.c("hi", "there"), 'blah');
    t.deepEqual(substitute.c("hi", "the1re"), void 0);
    t.deepEqual(substitute.c("hi", "there"), 'haha');
    t.deepEqual(substitute.c("hi", "there"), void 0);
    t.deepEqual(substitute.c("hi", "there"), void 0);
});
ava_1.default('class method received', function (t) {
    substitute.c("hi", "there").returns("blah", "haha");
    void substitute.c("hi", "there");
    void substitute.c("hi", "the1re");
    void substitute.c("hi", "there");
    void substitute.c("hi", "there");
    void substitute.c("hi", "there");
    t.throws(function () { return substitute.received(7).c('hi', 'there'); });
    t.notThrows(function () { return substitute.received(4).c('hi', 'there'); });
    t.notThrows(function () { return substitute.received().c('hi', 'there'); });
});
//# sourceMappingURL=index.test.js.map