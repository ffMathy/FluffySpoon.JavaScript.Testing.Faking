"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var index_1 = require("../../src/index");
ava_1.default("issue 23: mimick received should not call method", function (t) {
    var mockedCalculator = index_1.Substitute.for();
    var calls = 0;
    mockedCalculator.add(index_1.Arg.all()).mimicks(function (a, b) {
        t.deepEqual(++calls, 1, 'mimick called twice');
        return a + b;
    });
    mockedCalculator.add(1, 1); // ok
    mockedCalculator.received(1).add(1, 1); // not ok, calls mimick func
});
//# sourceMappingURL=23.test.js.map