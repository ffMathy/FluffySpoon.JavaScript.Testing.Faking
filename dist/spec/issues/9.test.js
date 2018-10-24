"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var Index_1 = require("../../src/Index");
var Example = /** @class */ (function () {
    function Example() {
    }
    Example.prototype.blocking = function () {
        console.log('blocking');
        return 123;
    };
    return Example;
}());
exports.Example = Example;
var substitute;
ava_1.default.beforeEach(function () {
    substitute = Index_1.Substitute.for();
});
ava_1.default('issue 9: can record method with 0 arguments', function (t) {
    substitute.blocking().returns(42);
    substitute.blocking();
    substitute.received(1).blocking();
    t.pass();
});
//# sourceMappingURL=9.test.js.map