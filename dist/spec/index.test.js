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
    Example.prototype.received = function (stuff) {
    };
    Example.prototype.foo = function () {
        return 'stuff';
    };
    return Example;
}());
exports.Example = Example;
var instance;
var substitute;
ava_1.default.beforeEach(function () {
    console.log('');
    console.log('Ava: beforeEach');
    console.log('');
    instance = new Example();
    substitute = Index_1.Substitute.for();
});
ava_1.default('class string field set received', function (t) {
    substitute.v = undefined;
    substitute.v = null;
    substitute.v = 'hello';
    substitute.v = 'hello';
    substitute.v = 'world';
    t.notThrows(function () { return substitute.received().v = 'hello'; });
    t.notThrows(function () { return substitute.received(5).v = Index_1.Arg.any(); });
    t.notThrows(function () { return substitute.received().v = Index_1.Arg.any(); });
    t.notThrows(function () { return substitute.received(2).v = 'hello'; });
    t.notThrows(function () { return substitute.received(2).v = Index_1.Arg.is(function (x) { return x && x.indexOf('ll') > -1; }); });
    t.throws(function () { return substitute.received(2).v = Index_1.Arg.any(); });
    t.throws(function () { return substitute.received(1).v = Index_1.Arg.any(); });
    t.throws(function () { return substitute.received(1).v = Index_1.Arg.is(function (x) { return x && x.indexOf('ll') > -1; }); });
    t.throws(function () { return substitute.received(3).v = 'hello'; });
});
ava_1.default('class method returns with specific args', function (t) {
    substitute.c("hi", "there").returns("blah", "haha");
    t.is(substitute.c("hi", "there"), 'blah');
    t.is(substitute.c("hi", "the1re"), substitute);
    t.deepEqual(substitute.c("hi", "there"), 'haha');
    t.is(substitute.c("hi", "there"), void 0);
    t.is(substitute.c("hi", "there"), void 0);
});
ava_1.default('partial mocks using function mimicks with specific args', function (t) {
    substitute.c('a', 'b').mimicks(instance.c);
    t.is(substitute.c('c', 'b'), substitute);
    t.is(substitute.c('a', 'b'), 'hello a world (b)');
});
ava_1.default('class method returns with placeholder args', function (t) {
    substitute.c(Index_1.Arg.any(), "there").returns("blah", "haha");
    t.is(substitute.c("hi", "there"), 'blah');
    t.is(substitute.c("hi", "the1re"), substitute);
    t.is(substitute.c("his", "there"), 'haha');
    t.is(substitute.c("his", "there"), void 0);
    t.is(substitute.c("hi", "there"), void 0);
});
ava_1.default('class void returns', function (t) {
    substitute.foo().returns(void 0, null);
    t.is(substitute.foo(), void 0);
    t.is(substitute.foo(), null);
});
ava_1.default('class method received', function (t) {
    void substitute.c("hi", "there");
    void substitute.c("hi", "the1re");
    void substitute.c("hi", "there");
    void substitute.c("hi", "there");
    void substitute.c("hi", "there");
    t.notThrows(function () { return substitute.received(4).c('hi', 'there'); });
    t.notThrows(function () { return substitute.received(1).c('hi', 'the1re'); });
    t.notThrows(function () { return substitute.received().c('hi', 'there'); });
    t.throws(function () { return substitute.received(7).c('hi', 'there'); }, "Expected 7 calls to the method c with arguments [hi, there], but received 4 of such calls.\nAll calls received to method c:\n-> 4 calls with arguments [hi, there]\n-> 1 call with arguments [hi, the1re]");
});
ava_1.default('received call matches after partial mocks using property instance mimicks', function (t) {
    substitute.d.mimicks(function () { return instance.d; });
    substitute.c('lala', 'bar');
    substitute.received(1).c('lala', 'bar');
    substitute.received(1).c('lala', 'bar');
    t.notThrows(function () { return substitute.received(1).c('lala', 'bar'); });
    t.throws(function () { return substitute.received(2).c('lala', 'bar'); }, "Expected 2 calls to the method c with arguments [lala, bar], but received 1 of such call.\nAll calls received to method c:\n-> 1 call with arguments [lala, bar]");
    t.deepEqual(substitute.d, 1337);
});
ava_1.default('can call received twice', function (t) {
    t.throws(function () { return substitute.received(1337).c('foo', 'bar'); }, "Expected 1337 calls to the method c with arguments [foo, bar], but received none of such calls.\nAll calls received to method c: (no calls)");
    t.throws(function () { return substitute.received(2117).c('foo', 'bar'); }, "Expected 2117 calls to the method c with arguments [foo, bar], but received none of such calls.\nAll calls received to method c: (no calls)");
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
ava_1.default('class with method called "received" can be used for call count verification when proxies are suspended', function (t) {
    Index_1.Substitute.disableFor(substitute).received(2);
    t.throws(function () { return substitute.received(2).received(2); });
    t.notThrows(function () { return substitute.received(1).received(2); });
});
ava_1.default('class with method called "received" can be used for call count verification', function (t) {
    Index_1.Substitute.disableFor(substitute).received('foo');
    t.notThrows(function () { return substitute.received(1).received('foo'); });
    t.throws(function () { return substitute.received(2).received('foo'); });
});
ava_1.default('partial mocks using property instance mimicks', function (t) {
    substitute.d.mimicks(function () { return instance.d; });
    t.deepEqual(substitute.d, 1337);
});
ava_1.default('partial mocks using function mimicks with all args', function (t) {
    substitute.c(Index_1.Arg.all()).mimicks(instance.c);
    t.deepEqual(substitute.c('a', 'b'), 'hello a world (b)');
});
ava_1.default('are arguments equal', function (t) {
    t.true(Utilities_1.areArgumentsEqual(Index_1.Arg.any(), 'hi'));
    t.true(Utilities_1.areArgumentsEqual(Index_1.Arg.any('array'), ['foo', 'bar']));
    t.false(Utilities_1.areArgumentsEqual(['foo', 'bar'], ['foo', 'bar']));
    t.false(Utilities_1.areArgumentsEqual(Index_1.Arg.any('array'), 1337));
});
ava_1.default('class string field get returns', function (t) {
    substitute.a.returns("foo", "bar");
    t.deepEqual(substitute.a, 'foo');
    t.deepEqual(substitute.a, 'bar');
    t.deepEqual(substitute.a, void 0);
    t.deepEqual(substitute.a, void 0);
});
//# sourceMappingURL=index.test.js.map