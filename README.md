<a href="https://opencollective.com/substitute-js#section-contribute"><a href="https://opencollective.com/substitute-js" alt="Financial Contributors on Open Collective"><img src="https://opencollective.com/substitute-js/all/badge.svg?label=financial+contributors" /></a> 

[`@fluffy-spoon/substitute`](https://www.npmjs.com/package/@fluffy-spoon/substitute) is a TypeScript port of [NSubstitute](http://nsubstitute.github.io), which aims to provide a much more fluent mocking opportunity for strong-typed languages.

*You can read an in-depth comparison of `substitute.js` versus other popular TypeScript mocking frameworks here: https://medium.com/@mathiaslykkegaardlorenzen/with-typescript-3-and-substitute-js-you-are-already-missing-out-when-mocking-or-faking-a3b3240c4607*

**PRs are very welcome! Help is much appreciated.**

# Installing
`npm install @fluffy-spoon/substitute --save-dev`

# Requirements
* `TypeScript^3.0.0`

# Usage
```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute';

interface Calculator {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
  divide(a: number, b: number): number;
  async heavyOperation(): Promise<number>;

  isEnabled: boolean;
}

// Create:
const calculator = Substitute.for<Calculator>();
 
// Set a return value:
calculator.add(1, 2).returns(3);
 
// Check received calls:
calculator.received().add(1, Arg.any());
calculator.didNotReceive().add(2, 2);
```

## Creating a mock
`const calculator = Substitute.for<Calculator>();`

## Setting return types
See the example below. The same syntax also applies to properties and fields.

```typescript
// single return type
calculator.add(1, 2).returns(4);
console.log(calculator.add(1, 2)); // prints 4
console.log(calculator.add(1, 2)); // prints undefined

// multiple return types in sequence
calculator.add(1, 2).returns(3, 7, 9);
console.log(calculator.add(1, 2)); // prints 3
console.log(calculator.add(1, 2)); // prints 7
console.log(calculator.add(1, 2)); // prints 9
console.log(calculator.add(1, 2)); // prints undefined
```

## Working with promises
When working with promises you can also use `resolves()` and `rejects()` to return a promise.

```typescript
calculator.heavyOperation(1, 2).resolves(4); 
// same as calculator.heavyOperation(1, 2).returns(Promise.resolve(4));
console.log(await calculator.heavyOperation(1, 2)); // prints 4
```

```typescript
calculator.heavyOperation(1, 2).rejects(new Error());
// same as calculator.heavyOperation(1, 2).returns(Promise.reject(new Error()));
console.log(await calculator.heavyOperation(1, 2)); // throws Error
```

## Verifying calls
```typescript
calculator.enabled = true;
const foo = calculator.add(1, 2);

// verify call to add(1, 2)
calculator.received().add(1, 2);

// verify property set to "true"
calculator.received().enabled = true;
```

## Argument matchers
There are several ways of matching arguments. The examples below also applies to properties and fields - both when setting up calls and verifying them.

### Matching specific arguments
```typescript
import { Arg } from '@fluffy-spoon/substitute';

// ignoring first argument
calculator.add(Arg.any(), 2).returns(10);
console.log(calculator.add(1337, 3)); // prints undefined since second argument doesn't match
console.log(calculator.add(1337, 2)); // prints 10 since second argument matches

// received call with first arg 1 and second arg less than 0
calculator.received().add(1, Arg.is(x => x < 0));
```

### Generic and inverse matchers
```typescript
import { Arg } from '@fluffy-spoon/substitute';

const equalToZero = (x: number) => x === 0;

// first argument will match any number
// second argument will match a number that is not '0'
calculator.divide(Arg.any('number'), Arg.is.not(equalToZero)).returns(10);
console.log(calculator.divide(100, 10)); // prints 10

const argIsNotZero = Arg.is.not(equalToZero);
calculator.received(1).divide(argIsNotZero, argIsNotZero);
```

> #### Note: `Arg.is()` will automatically infer the type of the argument it's replacing 

### Ignoring all arguments
```typescript
// ignoring all arguments
calculator.add(Arg.all()).returns(10);
console.log(calculator.add(1, 3)); // prints 10
console.log(calculator.add(5, 2)); // prints 10
```

### Match order
The order of argument matchers matters. The first matcher that matches will always be used. Below are two examples.

```typescript
calculator.add(Arg.all()).returns(10);
calculator.add(1, 3).returns(1337);
console.log(calculator.add(1, 3)); // prints 10
console.log(calculator.add(5, 2)); // prints 10
```

```typescript
calculator.add(1, 3).returns(1337);
calculator.add(Arg.all()).returns(10);
console.log(calculator.add(1, 3)); // prints 1337
console.log(calculator.add(5, 2)); // prints 10
```

## Partial mocks
With partial mocks you always start with a true substitute where everything is mocked and then opt-out of substitutions in certain scenarios.

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute';

class RealCalculator implements Calculator {
  add(a: number, b: number) => a + b;
  subtract(a: number, b: number) => a - b;
  divide(a: number, b: number) => a / b;
}

const realCalculator = new RealCalculator();
const fakeCalculator = Substitute.for<Calculator>();

// let the subtract method always use the real method
fakeCalculator.subtract(Arg.all()).mimicks(realCalculator.subtract);
console.log(fakeCalculator.subtract(20, 10)); // prints 10
console.log(fakeCalculator.subtract(1, 2)); // prints -1

// for the add method, we only use the real method when the first arg is less than 10
// else, we always return 1337
fakeCalculator.add(Arg.is(x < 10), Arg.any()).mimicks(realCalculator.add);
fakeCalculator.add(Arg.is(x >= 10), Arg.any()).returns(1337);
console.log(fakeCalculator.add(5, 100)); // prints 105 via real method
console.log(fakeCalculator.add(210, 7)); // prints 1337 via fake method

// for the divide method, we only use the real method for explicit arguments
fakeCalculator.divide(10, 2).mimicks(realCalculator.divide);
fakeCalculator.divide(Arg.all()).returns(1338);
console.log(fakeCalculator.divide(10, 5)); // prints 5
console.log(fakeCalculator.divide(9, 5)); // prints 1338
```

## Throwing exceptions
Exceptions can be thrown on properties or methods. You can add different exceptions for different arguments

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute';

interface Calculator {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
  divide(a: number, b: number): number;
  isEnabled: boolean;
}

const calculator = Substitute.for<Calculator>();
calculator.divide(Arg.any(), 0).throws(new Error('Cannot divide by 0'));
calculator.divide(1, 0); // throws the exception Error: Cannot divide by 0
```

# Benefits over other mocking libraries
- Easier-to-understand fluent syntax.
- No need to cast to `any` in certain places (for instance, when overriding read-only properties) due to the `myProperty.returns(...)` syntax.
- Doesn't weigh much.
- Produces very clean and descriptive error messages. Try it out - you'll love it.
- Doesn't rely on object instances - you can produce a strong-typed fake from nothing, ensuring that everything is mocked.

# Beware
## Names that conflict with Substitute.js
Let's say we have a class with a method called `received`, `didNotReceive` or `mimick` keyword - how do we mock it? 

Simple! We disable the proxy methods temporarily while invoking the method by using the `disableFor` method which disables these special methods.

```typescript
class Example {
  received(someNumber: number) {
    console.log(someNumber);
  }
}

const fake = Substitute.for<Example>();

// BAD: this would have called substitute.js' "received" method.
// fake.received(2);

// GOOD: we now call the "received" method we have defined in the class above.
Substitute.disableFor(fake).received(1337);

// now we can assert that we received a call to the "received" method.
fake.received().received(1337);
```

## Strict mode
If you have `strict` set to `true` in your `tsconfig.json`, you may need to toggle off strict null checks. The framework does not currently support this.

However, it is only needed for your test projects anyway.

```json
{
    "compilerOptions": {
        "strict": true,
        "strictNullChecks": false
    }
}
```

## Contributors

### Code Contributors

This project exists thanks to all the people who contribute. [[Contribute](CONTRIBUTING.md)].
<a href="https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/graphs/contributors"><img src="https://opencollective.com/substitute-js/contributors.svg?width=890&button=false" /></a>

### Financial Contributors

Become a financial contributor and help us sustain our community. [[Contribute](https://opencollective.com/substitute-js/contribute)]

#### Individuals

<a href="https://opencollective.com/substitute-js"><img src="https://opencollective.com/substitute-js/individuals.svg?width=890"></a>

#### Organizations

Support this project with your organization. Your logo will show up here with a link to your website. [[Contribute](https://opencollective.com/substitute-js/contribute)]

<a href="https://opencollective.com/substitute-js/organization/0/website"><img src="https://opencollective.com/substitute-js/organization/0/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/1/website"><img src="https://opencollective.com/substitute-js/organization/1/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/2/website"><img src="https://opencollective.com/substitute-js/organization/2/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/3/website"><img src="https://opencollective.com/substitute-js/organization/3/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/4/website"><img src="https://opencollective.com/substitute-js/organization/4/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/5/website"><img src="https://opencollective.com/substitute-js/organization/5/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/6/website"><img src="https://opencollective.com/substitute-js/organization/6/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/7/website"><img src="https://opencollective.com/substitute-js/organization/7/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/8/website"><img src="https://opencollective.com/substitute-js/organization/8/avatar.svg"></a>
<a href="https://opencollective.com/substitute-js/organization/9/website"><img src="https://opencollective.com/substitute-js/organization/9/avatar.svg"></a>
