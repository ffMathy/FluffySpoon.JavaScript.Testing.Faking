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
    Example.prototype.foo = function () {
        return 'stuff';
    };
    return Example;
}());
exports.Example = Example;
var instance;
var substitute;
ava_1.default.beforeEach(function () {
    instance = new Example();
    substitute = Index_1.Substitute.for();
});
ava_1.default('are arguments equal', function (t) {
    t.true(Utilities_1.areArgumentsEqual(Index_1.Arg.any(), 'hi'));
    t.true(Utilities_1.areArgumentsEqual(Index_1.Arg.any('array'), ['foo', 'bar']));
    t.false(Utilities_1.areArgumentsEqual(['foo', 'bar'], ['foo', 'bar']));
    t.false(Utilities_1.areArgumentsEqual(Index_1.Arg.any('array'), 1337));
});
ava_1.default('class method returns with placeholder args', function (t) {
    substitute.c(Index_1.Arg.any(), "there").returns("blah", "haha");
    t.deepEqual(substitute.c("hi", "there"), 'blah');
    t.deepEqual(substitute.c("hi", "the1re"), void 0);
    t.deepEqual(substitute.c("his", "there"), 'haha');
    t.deepEqual(substitute.c("his", "there"), void 0);
    t.deepEqual(substitute.c("hi", "there"), void 0);
});
ava_1.default('partial mocks using function mimicks with specific args', function (t) {
    substitute.c('a', 'b').mimicks(instance.c);
    t.deepEqual(substitute.c('c', 'b'), void 0);
    t.deepEqual(substitute.c('a', 'b'), 'hello a world (b)');
});
ava_1.default('class method returns with specific args', function (t) {
    substitute.c("hi", "there").returns("blah", "haha");
    t.deepEqual(substitute.c("hi", "there"), 'blah');
    t.deepEqual(substitute.c("hi", "the1re"), void 0);
    t.deepEqual(substitute.c("hi", "there"), 'haha');
    t.deepEqual(substitute.c("hi", "there"), void 0);
    t.deepEqual(substitute.c("hi", "there"), void 0);
});
ava_1.default('class string field get received', function (t) {
    void substitute.a;
    void substitute.a;
    void substitute.a;
    void substitute.a;
    t.throws(function () { return substitute.received(3).a; });
    t.notThrows(function () { return substitute.received().a; });
    t.notThrows(function () { return substitute.received(4).a; });
});
ava_1.default('partial mocks using function mimicks with all args', function (t) {
    substitute.c(Index_1.Arg.all()).mimicks(instance.c);
    t.deepEqual(substitute.c('a', 'b'), 'hello a world (b)');
});
ava_1.default('partial mocks using property instance mimicks', function (t) {
    substitute.d.mimicks(function () { return instance.d; });
    t.deepEqual(substitute.d, 1337);
});
ava_1.default('class void returns', function (t) {
    substitute.foo().returns(void 0, null);
    t.deepEqual(substitute.foo(), void 0);
    t.deepEqual(substitute.foo(), null);
});
ava_1.default('class string field get returns', function (t) {
    substitute.a.returns("foo", "bar");
    t.deepEqual(substitute.a, 'foo');
    t.deepEqual(substitute.a, 'bar');
    t.deepEqual(substitute.a, void 0);
    t.deepEqual(substitute.a, void 0);
});
ava_1.default('class string field set received', function (t) {
    substitute.v = undefined;
    substitute.v = null;
    substitute.v = 'hello';
    substitute.v = 'hello';
    substitute.v = 'world';
    t.throws(function () { return substitute.received(2).v = Index_1.Arg.any(); });
    t.throws(function () { return substitute.received(1).v = Index_1.Arg.any(); });
    t.throws(function () { return substitute.received(1).v = Index_1.Arg.is(function (x) { return x && x.indexOf('ll') > -1; }); });
    t.throws(function () { return substitute.received(3).v = 'hello'; });
    t.notThrows(function () { return substitute.received().v = Index_1.Arg.any(); });
    t.notThrows(function () { return substitute.received(5).v = Index_1.Arg.any(); });
    t.notThrows(function () { return substitute.received().v = 'hello'; });
    t.notThrows(function () { return substitute.received(2).v = 'hello'; });
    t.notThrows(function () { return substitute.received(2).v = Index_1.Arg.is(function (x) { return x && x.indexOf('ll') > -1; }); });
});
ava_1.default('class method received', function (t) {
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