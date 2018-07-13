# substitute.js
[`@fluffy-spoon/substitute`](https://www.npmjs.com/package/@fluffy-spoon/substitute) is a TypeScript port of [NSubstitute](http://nsubstitute.github.io), which aims to provide a much more fluent mocking opportunity for strong-typed languages.

## Installing
`npm install @fluffy-spoon/substitute --save-dev`

## Requirements
* `TypeScript^3.0.0`

## Usage
Experience full strong-typing of your fakes all the way, and let the TypeScript compiler help with all the dirty work! All methods below have full strong typing all around, even when creating a fake from an interface!

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute';

interface Calculator {
  add(a: number, b: number): number;
}

//Create:
var calculator = Substitute.for<Calculator>();
 
//Set a return value:
calculator.add(1, 2).returns(3);
 
//Check received calls:
calculator.received().add(1, Arg.any());
calculator.didNotReceive().add(2, 2);
```

### Creating a mock
`var myFakeCalculator = Substitute.for<Calculator>();`

### Setting return types
Multiple return types can be set in sequence. Consider the example below.

```
myFakeCalculator.add(1, 2).returns(3, 7, 9);
console.log(myFakeCalculator.add(1, 2)); //prints 3
console.log(myFakeCalculator.add(1, 2)); //prints 7
console.log(myFakeCalculator.add(1, 2)); //prints 9
console.log(myFakeCalculator.add(1, 2)); //prints undefined
```

## Why TypeScript 3?
Let's say I want to mock the type T, so I create a function `function mock<T>(): T`. If I then passed the object `{ doFooWithOneArgument: (input: string) => boolean, doFooWithTwoArguments: (input1: string, input2: boolean) => string }` to it, I would get a strong-typed variant of it in return.

That's all good, but if I wanted to map that type into `{ doFooWithOneArgument: (whateverTheOneParameterTypeWas) => boolean, doWithTwoArguments: (whateverTheTwoParameterTypesWas) => string } & { returns: (...returnValuesInSequence: whateverTheReturnTypeOfDoFooWas[]) => void }`, I wouldn't be able to do it in a fully strong-typed manner, since there would be no way of expressing `whateverTheOneParameterTypeWas` and `whateverTheTwoParameterTypesWas` in a mapped type, and they would have to be defined as `...args: any[]`. However, now there's "Generic rest parameters" that can express this, as seen in [the example in the announcement post](https://github.com/Microsoft/TypeScript/wiki/What's-new-in-TypeScript#generic-rest-parameters).

See [this example TypeScript file](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing/blob/master/src/Transformations.ts) for an example of how the type is defined. For each property of the original type given, I then handle it differently whether or not it's a function or a property by using the `infer` keyword. If it's a function, I then infer the arguments and its return type and re-express them in a strong-typed manner, but retaining the type safety of the arguments given. This was not possible before.

The end-result of this is that I can do something like `myFake.doWithTwoArguments('foo', false).returns("firstThis", "thenThis", "andThenThis")`, where both `'foo'` and `false` are strong-typed.

## What is this - black magic?
`@fluffy-spoon/substitute` works the same way that NSubstitute does, except that it uses the EcmaScript 6 `Proxy` class to produce the fakes. You can read more about how NSubstitute works to get inspired.
