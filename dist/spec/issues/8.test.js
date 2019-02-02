"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var Foo = /** @class */ (function () {
    function Foo() {
    }
    Foo.prototype.bar = function () { };
    return Foo;
}());
ava_1.default('issue 8: can record method with 0 arguments', function (t) {
    var a;
    var mock = a; // error TS2322
    t.pass();
});
//# sourceMappingURL=8.test.js.map