"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var Index_1 = require("../../src/Index");
ava_1.default('issue 23: mimick received should not call method', function (t) {
    var mockedCalculator = Index_1.Substitute.for();
    var result = 0;
    mockedCalculator.add(Index_1.Arg.all()).mimicks(function (a, b) {
        return result = a + b;
    });
    t.throws(function () { return mockedCalculator.received().add(Index_1.Arg.any(), Index_1.Arg.any()); });
    t.is(result, 0);
});
//# sourceMappingURL=23.test.js.map