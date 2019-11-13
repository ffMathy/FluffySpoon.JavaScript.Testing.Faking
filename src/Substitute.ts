import { Context } from "./Context";
import { ObjectSubstitute, OmitProxyMethods, DisabledSubstituteObject } from "./Transformations";
import { Get } from './Utilities'

export const HandlerKey = Symbol();
export const AreProxiesDisabledKey = Symbol();

export type SubstituteOf<T extends Object> = ObjectSubstitute<OmitProxyMethods<T>, T> & T;

export class Substitute {
    static for<T>(): SubstituteOf<T> {
        const objectContext = new Context();
        return objectContext.rootProxy;
    }

    static disableFor<T extends ObjectSubstitute<OmitProxyMethods<any>>>(substitute: T): DisabledSubstituteObject<T> {
        const thisProxy = substitute as any; // rootProxy
        const thisExposedProxy = thisProxy[HandlerKey]; // Context

        const disableProxy = <K extends Function>(f: K): K => {
            return function() {
                thisProxy[AreProxiesDisabledKey] = true; // for what reason need to do this? 
                const returnValue = f.call(thisExposedProxy, ...arguments);
                thisProxy[AreProxiesDisabledKey] = false;
                return returnValue;
            } as any;
        };

        return new Proxy(() => { }, {
            apply: function (_target, _this, args) {
                return disableProxy(thisExposedProxy.apply)(...arguments)
            },
            set: function (_target, property, value) {
                return disableProxy(thisExposedProxy.set)(...arguments)
            },
            get: function (_target, property) {
                Get(thisExposedProxy._initialState, thisExposedProxy, property)
                return disableProxy(thisExposedProxy.get)(...arguments)
            }
        }) as any;
    }
}