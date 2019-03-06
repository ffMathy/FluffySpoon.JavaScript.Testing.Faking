"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var Index_1 = require("../../src/Index");
ava_1.default("issue 23: mimick received should not call method", function (t) {
    var mockedCalculator = Index_1.Substitute.for();
    mockedCalculator.add(Index_1.Arg.all()).mimicks(function (a, b) {
        t.deepEqual(a, 1);
        return a + b;
    });
    mockedCalculator.add(1, 1); // ok
    mockedCalculator.received(1).add(2, 1); // not ok, calls mimick func
});
//# sourceMappingURL=23.test.js.map