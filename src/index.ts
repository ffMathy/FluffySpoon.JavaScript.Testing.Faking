export type FunctionSubstitute<T> = (...args: any[]) => (T & {
    returns: (...args: T[]) => void;
  })
  
  export type PropertySubstitute<T> = {
    returns: (...args: T[]) => void;
  }
   
  export type ObjectSubstitute<T extends Object> = {
    [P in keyof T]:
      T[P] extends (...args: any[]) => infer R ? FunctionSubstitute<R> :
      PropertySubstitute<T[P]>;
  } 
  
  export class Substitute {
    static for<T>(instance: T): ObjectSubstitute<T> {
      const lastRecord = {
        type: null as string,
        target: null as T,
        metadata: null as any
      };

      const record = (type: string, target: T, metadata: any) => {
        lastRecord.type = type;
        lastRecord.target = target;
        lastRecord.metadata = metadata;
      };

      const setupRecording = (localTarget: any) => {
        const proxy = new Proxy(localTarget, {
          get: (target, property) => {
            record('get', target, property);
            return target[property];
          },
          apply: (target, thisArg, argumentsList) => {
            record('apply', target, argumentsList);
            return target
          }
        });

        return proxy;
      };
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
  
  console.log('start');
  
  var ex = new Example();
  var exFake = Substitute.for(ex);
  
  exFake.a.returns("foo", "bar");
  exFake.b.returns(10, 30);
  exFake.c("hi", "there").returns("blah", "haha");
  exFake.d.returns(9);
  
  console.log(exFake.a);
  console.log(exFake.b);
  
  console.log(exFake.c("hi", "there"));
  console.log(exFake.c("hi", "there"));
  console.log(exFake.c("something", "there"));
  
  console.log(exFake.d);
