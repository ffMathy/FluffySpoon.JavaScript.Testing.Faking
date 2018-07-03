export type FunctionSubstitute<F extends any[], T> = (...args: F) => (T & {
  returns: (...args: T[]) => void;
})

export type PropertySubstitute<T> = {
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
      proxy: any
    };

    const createRecord = () => {
      lastRecord = {
        arguments: null,
        shouldReturn: [],
        proxy: null,
        currentReturnOffset: 0
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
              return localRecord.proxy || (localRecord.proxy = createProxy());

            return localRecord.shouldReturn[localRecord.currentReturnOffset++];
          }

          localRecord.arguments = argumentsList;
          return thisProxy;
        },
        get: (target, property) => {
          if(typeof property === 'symbol')
            return void 0;

          if(property === 'valueOf')
            return void 0;

          if(property === 'toString')
            return target[property].toString();

          if(property === 'inspect')
            return () => "{SubstituteJS fake}";

          if(property === 'constructor')
            return () => thisProxy;

          if(property === 'returns') {
            return (...args: any[]) => {
              localRecord.shouldReturn = args;
            };
          }

          if(localRecord) {
            if(localRecord.arguments)
              return thisProxy;

            return localRecord.shouldReturn[localRecord.currentReturnOffset];
          }
          
          localRecord = createRecord();
          return thisProxy;
        }
      });
    };

    return createProxy() as any;
  }
}

class Example {
  a = "1337";
  b = 1337;

  c(arg1: string, arg2: string) {
    return "hello " + arg1 + " world (" + arg2 + ")";
  }

  get d() {
    return 1337;
  }

  set v(x) {
    console.log('define: ' + x);
  }
}

var exFake = Substitute.for<Example>();

exFake.a.returns("foo", "bar");
console.log('returned', exFake.a);
console.log('returned', exFake.a);

exFake.b.returns(10, 30);
exFake.c("hi", "there").returns("blah", "haha");
exFake.d.returns(9);

console.log(exFake.a);
console.log(exFake.b);

console.log('assert');

console.log(exFake.c("hi", "there"));
console.log(exFake.c("hi", "the1re"));
console.log(exFake.c("hi", "there"));
console.log(exFake.c("hi", "there"));
console.log(exFake.c("something", "there"));

console.log(exFake.d);
