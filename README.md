# substitute.js
`@fluffy-spoon/substitute` TypeScript port of [NSubstitute](http://nsubstitute.github.io), which aims to provide a much more fluent mocking opportunity for strong-typed languages.

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

## What is this - black magic?
`@fluffy-spoon/substitute` works the same way that NSubstitute does, except that it uses the EcmaScript 6 `Proxy` class to produce the fakes. You can read more about how NSubstitute works to get inspired.
