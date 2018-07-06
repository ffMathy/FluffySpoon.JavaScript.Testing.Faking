# substitute.js
More concretely named `@fluffy-spoon/substitute` on NPM is a TypeScript port of [NSubstitute](http://nsubstitute.github.io), which aims to provide a much more fluent mocking opportunity for strong-typed languages.

## Requirements
* `TypeScript^3.0.0`

## Usage
Experience full strong-typing of your fakes all the way, and let the TypeScript compiler help with all the dirty work! In the usage example given below, the `exFake` instance is strong-typed all the way, and can be used naturally in a fluent interface!

```typescript
import { Substitute } from '@fluffy-spoon/substitute';

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
console.log(exFake.a); //prints "foo"
console.log(exFake.a); //prints "bar"
console.log(exFake.a); //prints undefined

exFake.b.returns(10, 30, 99);
console.log(exFake.b); //prints 10
console.log(exFake.b); //prints 30
console.log(exFake.b); //prints 99
console.log(exFake.b); //prints undefined

exFake.c("hi", "there").returns("blah", "haha", "oooh", "lala");
console.log(exFake.c("hi", "there")); //prints "blah"
console.log(exFake.c("hi", "there")); //prints "haha"
console.log(exFake.c("hi", "the1re")); //prints undefined (since it doesn't match the parameters)
console.log(exFake.c("hi", "there")); //prints "ooh"
console.log(exFake.c("something", "there")); //prints undefined (since it doesn't match the parameters)

exFake.d.returns(9);
console.log(exFake.d); //prints 9
```

## But how?
`@fluffy-spoon/substitute` works the same way that NSubstitute does, except that it uses the EcmaScript 6 `Proxy` class to produce the fakes. You can read more about how NSubstitute works to get inspired.
