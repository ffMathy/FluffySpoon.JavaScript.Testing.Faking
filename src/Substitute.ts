import { Context } from "./Context";
import { ObjectSubstitute, OmitProxyMethods, DisabledSubstituteObject } from "./Transformations";

export const HandlerKey = Symbol();
export const AreProxiesDisabledKey = Symbol();

export type SubstituteOf<T extends Object> = ObjectSubstitute<OmitProxyMethods<T>, T> & T;

export class Substitute {
    static for<T>(): SubstituteOf<T> {
        const objectContext = new Context();
        return objectContext.rootProxy;
    }

    static disableFor<T extends ObjectSubstitute<OmitProxyMethods<any>>>(substitute: T): DisabledSubstituteObject<T> {
        const thisProxy = substitute as any;
        const thisExposedProxy = thisProxy[HandlerKey];

        const disableProxy = <K extends Function>(f: K): K => {
            return function() {
                thisProxy[AreProxiesDisabledKey] = true;
                const returnValue = f.call(thisExposedProxy, ...arguments);
                thisProxy[AreProxiesDisabledKey] = false;
                return returnValue;
            } as any;
        };

        return new Proxy(() => { }, {
            apply: disableProxy(thisExposedProxy.apply),
            set: disableProxy(thisExposedProxy.set),
            get: disableProxy(thisExposedProxy.get)
        }) as any;
    }
}