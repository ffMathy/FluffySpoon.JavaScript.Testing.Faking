"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Context_1 = require("./Context");
var Substitute = /** @class */ (function () {
    function Substitute() {
    }
    Substitute.for = function () {
        var objectContext = new Context_1.Context();
        return objectContext.rootProxy;
    };
    return Substitute;
}());
exports.Substitute = Substitute;
//# sourceMappingURL=Substitute.js.map