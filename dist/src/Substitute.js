"use strict";
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spread = (this && this.__spread) || function () {
    for (var ar = [], i = 0; i < arguments.length; i++) ar = ar.concat(__read(arguments[i]));
    return ar;
};
Object.defineProperty(exports, "__esModule", { value: true });
var Context_1 = require("./Context");
exports.HandlerKey = Symbol();
exports.AreProxiesDisabledKey = Symbol();
var Substitute = /** @class */ (function () {
    function Substitute() {
    }
    Substitute.for = function () {
        var objectContext = new Context_1.Context();
        return objectContext.rootProxy;
    };
    Substitute.disableFor = function (substitute) {
        var thisProxy = substitute;
        var thisExposedProxy = thisProxy[exports.HandlerKey];
        var disableProxy = function (f) {
            return function () {
                thisProxy[exports.AreProxiesDisabledKey] = true;
                var returnValue = f.call.apply(f, __spread([thisExposedProxy], arguments));
                thisProxy[exports.AreProxiesDisabledKey] = false;
                return returnValue;
            };
        };
        return new Proxy(function () { }, {
            apply: disableProxy(thisExposedProxy.apply),
            set: disableProxy(thisExposedProxy.set),
            get: disableProxy(thisExposedProxy.get)
        });
    };
    return Substitute;
}());
exports.Substitute = Substitute;
//# sourceMappingURL=Substitute.js.map