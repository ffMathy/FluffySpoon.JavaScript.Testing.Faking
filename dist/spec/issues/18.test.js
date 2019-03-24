"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ava_1 = require("ava");
var index_1 = require("../../src/index");
ava_1.default('issue 18: receive with arg', function (t) {
    var mockedCalculator = index_1.Substitute.for();
    mockedCalculator.add(1, index_1.Arg.is(function (input) { return input === 2; })).returns(4);
    void mockedCalculator.add(1, 2);
    mockedCalculator.received(1).add(1, index_1.Arg.is(function (input) { return input === 2; }));
    t.pass();
});
//# sourceMappingURL=18.test.js.map