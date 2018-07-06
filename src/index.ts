export type FunctionSubstitute<F extends any[], T> = (...args: F) => (T & {
  returns: (...args: T[]) => void;
})

export type PropertySubstitute<T> = T & {
  returns: (...args: T[]) => void;
}

export type ObjectSubstitute<T extends Object> = {
  [P in keyof T]:
  T[P] extends (...args: infer F) => infer R ? FunctionSubstitute<F, R> :
  PropertySubstitute<T[P]>;
}

export class Substitute {
  static for<T>(): ObjectSubstitute<T> {
    let lastRecord: {
      arguments: Array<any>,
      shouldReturn: Array<any>,
      currentReturnOffset: number,
      proxy: any,
      property: string|number
    };

    const createRecord = () => {
      lastRecord = {
        arguments: null,
        shouldReturn: [],
        proxy: null,
        currentReturnOffset: 0,
        property: null
      };

      return lastRecord;
    };

    const equals = (a: any, b: any) => {
      if((!a || !b) && a !== b)
        return false;

      if(typeof a !== typeof b)
        return false;

      if(Array.isArray(a) !== Array.isArray(b))
        return false;

      if(Array.isArray(a) && Array.isArray(b)) {
        if(a.length !== b.length)
          return false;

        for(let i=0;i<a.length;i++) {
          if(!equals(a[i], b[i]))
            return false;
        }

        return true;
      }

      return a === b;
    }
    
    const createProxy = (r: any = null) => {
      let localRecord: typeof lastRecord = r;
      
      let thisProxy: any;
      return thisProxy = new Proxy(() => {}, {
        apply: (_target, _thisArg, argumentsList) => {
          if(localRecord.arguments) {
            if(!equals(localRecord.arguments, argumentsList))
              return void 0;

            return localRecord.shouldReturn[localRecord.currentReturnOffset++];
          }

          localRecord.arguments = argumentsList;
          return thisProxy;
        },
        get: (target, property) => {
          if(typeof property === 'symbol') {
            if(property === Symbol.toPrimitive)
              return () => void 0;

            return void 0;
          }

          if(property === 'valueOf')
            return void 0;

          if(property === 'toString')
            return (target[property] || '').toString();

          if(property === 'inspect')
            return () => "{SubstituteJS fake}";

          if(property === 'constructor')
            return () => thisProxy;

          if(property === 'returns')
            return (...args: any[]) => localRecord.shouldReturn = args;

          if(localRecord && localRecord.property === property) {
            if(localRecord.arguments)
              return thisProxy;

            return localRecord.shouldReturn[localRecord.currentReturnOffset++];
          }
          
          localRecord = createRecord();
          localRecord.property = property;

          return thisProxy;
        }
      });
    };

    return createProxy() as any;
  }
}