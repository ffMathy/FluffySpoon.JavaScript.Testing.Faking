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
See the example below.

```typescript
//single return type
calculator.add(1, 2).returns(4);
console.log(calculator.add(1, 2)); //prints 4
console.log(calculator.add(1, 2)); //prints undefined

//multiple return types in sequence
calculator.add(1, 2).returns(3, 7, 9);
console.log(calculator.add(1, 2)); //prints 3
console.log(calculator.add(1, 2)); //prints 7
console.log(calculator.add(1, 2)); //prints 9
console.log(calculator.add(1, 2)); //prints undefined
```

### Argument matchers
There are several ways of matching arguments. You don't have to be explicit.

```typescript
import { Arg } from '@fluffy-spoon/substitute';

//ignoring arguments
calculator.add(Arg.any(), 2).returns(10);
console.log(calculator.add(1337, 3)); //prints undefined since second argument doesn't match
console.log(calculator.add(1337, 2)); //prints 10 since second argument matches

//received call with first arg 1 and second arg less than 0
calculator.received().add(1, Arg.is<number>(x => x < 0));
```

## What is this - black magic?
`@fluffy-spoon/substitute` works the same way that NSubstitute does, except that it uses the EcmaScript 6 `Proxy` class to produce the fakes. You can read more about how NSubstitute works to get inspired.
