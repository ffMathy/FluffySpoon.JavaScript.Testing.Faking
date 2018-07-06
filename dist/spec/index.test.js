"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var index_1 = require("../src/index");
var Example = /** @class */ (function () {
    function Example() {
        this.a = "1337";
        this.b = 1337;
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
    substitute = index_1.Substitute.for();
});
ava_1.default('class string field', function (t) {
    substitute.a.returns("foo", "bar");
    t.deepEqual(substitute.a, 'foo');
    t.deepEqual(substitute.a, 'bar');
    t.deepEqual(substitute.a, void 0);
    t.deepEqual(substitute.a, void 0);
});
ava_1.default('class number field', function (t) {
    substitute.b.returns(10, 30);
    t.deepEqual(substitute.b, 10);
    t.deepEqual(substitute.b, 30);
    t.deepEqual(substitute.b, void 0);
    t.deepEqual(substitute.b, void 0);
});
ava_1.default('class method', function (t) {
    substitute.c("hi", "there").returns("blah", "haha");
    t.deepEqual(substitute.c("hi", "there"), 'blah');
    t.deepEqual(substitute.c("hi", "the1re"), void 0);
    t.deepEqual(substitute.c("hi", "there"), 'haha');
    t.deepEqual(substitute.c("hi", "there"), void 0);
    t.deepEqual(substitute.c("hi", "there"), void 0);
});
//# sourceMappingURL=index.test.js.map