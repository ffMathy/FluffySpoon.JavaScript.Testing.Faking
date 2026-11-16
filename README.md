<a href="https://opencollective.com/substitute-js#section-contribute"><img src="https://opencollective.com/substitute-js/all/badge.svg?label=financial+contributors" alt="Financial Contributors on Open Collective" /></a>

# What is this?
[`@fluffy-spoon/substitute`](https://www.npmjs.com/package/@fluffy-spoon/substitute) is a TypeScript port of [NSubstitute](http://nsubstitute.github.io), which aims to provide a much more fluent mocking opportunity for strong-typed languages.

*You can read an in-depth comparison of `substitute.js` versus other popular TypeScript mocking frameworks here: https://medium.com/@mathiaslykkegaardlorenzen/with-typescript-3-and-substitute-js-you-are-already-missing-out-when-mocking-or-faking-a3b3240c4607 (written for version 1; the ideas still apply).*

**PRs are very welcome! Help is much appreciated.**

> Upgrading from 1.x or from a 2.0.0 beta? Read the [migration guide](MIGRATION.md). What changed in each version is in the [changelog](CHANGELOG.md).

# Table of contents
- [Installing](#installing) · [Requirements](#requirements) · [Importing](#importing)
- [Usage](#usage): [creating a substitute](#creating-a-substitute), [return values](#setting-return-values), [promises](#working-with-promises), [exceptions](#throwing-exceptions), [mimicking](#mimicking-an-implementation)
- [Argument matchers](#argument-matchers) and [match order](#match-order)
- [Re-configuring a call](#re-configuring-a-call-configure) · [Partial mocks](#partial-mocks) · [Auto-substitutes](#auto-substitutes-and-nested-members)
- [Verifying calls](#verifying-calls): [counts](#received-and-didnotreceive), [properties](#properties), [what counts as a call](#what-counts-as-a-call), [clearing](#clearing-received-calls), [SubstituteException](#substituteexception), [deferred failures](#assertions-that-fail-later)
- [Names that conflict with the library](#names-that-conflict-with-the-library) and [the symbol API](#the-symbol-api)
- [Special members](#special-members) · [Typing limitations](#typing-limitations) · [Test runners](#test-runners)

# Installing
```sh
npm install @fluffy-spoon/substitute --save-dev
```

This README describes version 2. Until 2.0.1, `npm install` installed 1.208.0 (the `latest` tag). If you depend on version 1, pin it with `npm install @fluffy-spoon/substitute@1 --save-dev`; its README is at the [v1.208.0 tag](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/tree/v1.208.0#readme).

# Requirements
* Node.js 10 or newer for CommonJS (`require`), and Node.js 12.17 or newer for the ES module entry point (`import`).
* TypeScript 3.6 or newer, if you use TypeScript. `strict` mode, including `strictNullChecks`, is supported.
* Any test runner. ava, jest, mocha, node:test and vitest are tested on every change (see [Test runners](#test-runners)).

# Importing
TypeScript, or code compiled by a bundler:

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'
// or: import Substitute, { Arg } from '@fluffy-spoon/substitute'
```

CommonJS:

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const calculator = Substitute.for()
calculator.add(1, Arg.any()).returns(3)
console.log(calculator.add(1, 2)) // prints 3
```

Native ES modules (`.mjs` files or `"type": "module"`). The default import is the `Substitute` class, and named imports work too:

<!-- docs-check: esm -->
```js
import Substitute, { Arg, received } from '@fluffy-spoon/substitute'

const calculator = Substitute.for()
calculator.add(Arg.all()).returns(3)
console.log(calculator.add(1, 2)) // prints 3
calculator[received](1).add(1, 2)
```

The ES module entry point wraps the CommonJS build, so both share one copy of the library. Everything is exported from the package root: `Substitute`, `Arg`, `SubstituteException`, the type `SubstituteOf<T>`, and the symbols `received`, `didNotReceive`, `clearReceivedCalls`, `mimick`, `configure`, `returns`, `throws`, `resolves`, `rejects` and `mimicks`. Paths inside the package (`@fluffy-spoon/substitute/dist/...`) are not public API and can change in any release.

# Usage
The examples in this README use this interface:

<!-- docs-check: name=calculator -->
```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Calculator {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  divide(a: number, b: number): number
  heavyOperation(...numbers: number[]): Promise<number>
  isEnabled: boolean
}

// Create:
const calculator = Substitute.for<Calculator>()
```

Each of the following examples starts with a fresh `calculator`:

<!-- docs-check: uses=calculator -->
```typescript
// Set a return value:
calculator.add(1, 2).returns(3)

// Use the substitute wherever a Calculator is expected (normally in the code under test):
const sum = (c: Calculator) => c.add(1, 2)
console.log(sum(calculator)) // prints 3

// Check received calls:
calculator.received().add(1, Arg.any())
calculator.didNotReceive().add(2, 2)
```

## Creating a substitute
`Substitute.for<T>()` creates a substitute for an interface, a class or any other type. Its type, `SubstituteOf<T>`, is assignable to `T`, so you can hand it to the code under test. Nothing of a real instance is used: every member is substituted. (To use parts of a real instance, see [Partial mocks](#partial-mocks).)

<!-- docs-check: uses=calculator -->
```typescript
class Display {
  constructor(private readonly calculator: Calculator) { }

  showSum(a: number, b: number) {
    return `${a} + ${b} = ${this.calculator.add(a, b)}`
  }
}

calculator.add(1, 2).returns(3)
console.log(new Display(calculator).showSum(1, 2)) // prints 1 + 2 = 3
```

## Setting return values
Make the call with the arguments you want to configure, then call `.returns()` on it. The same syntax works for properties.

<!-- docs-check: uses=calculator -->
```typescript
// a single value is returned by every matching call
calculator.add(1, 2).returns(4)
console.log(calculator.add(1, 2)) // prints 4
console.log(calculator.add(1, 2)) // prints 4

// several values are returned in sequence, and then the last value repeats
calculator.subtract(5, 1).returns(3, 7, 9)
console.log(calculator.subtract(5, 1)) // prints 3
console.log(calculator.subtract(5, 1)) // prints 7
console.log(calculator.subtract(5, 1)) // prints 9
console.log(calculator.subtract(5, 1)) // prints 9

// properties work the same way
calculator.isEnabled.returns(true)
console.log(calculator.isEnabled) // prints true
```

A call or property that is not configured does not return `undefined`: it returns an [auto-substitute](#auto-substitutes-and-nested-members). A configured value can be changed later with [`configure`](#re-configuring-a-call-configure). Another substitute is a fine return value, too.

## Working with promises
For members that return a promise, `resolves()` and `rejects()` are shortcuts for returning a resolved or rejected promise. They work on methods and on promise-typed properties.

<!-- docs-check: uses=calculator -->
```typescript
calculator.heavyOperation(1, 2).resolves(4)
// same as calculator.heavyOperation(1, 2).returns(Promise.resolve(4))

calculator.heavyOperation(0).rejects(new Error('too light'))
// like calculator.heavyOperation(0).returns(Promise.reject(new Error('too light'))), except that the
// rejected promise is only created when heavyOperation(0) is called

async function run() {
  console.log(await calculator.heavyOperation(1, 2)) // prints 4
  await calculator.heavyOperation(0).catch(error => console.log(error.message)) // prints too light
}
run()
```

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface Connection {
  ready: Promise<boolean>
}

const connection = Substitute.for<Connection>()
connection.ready.resolves(true)
connection.ready.then(ready => console.log(ready)) // prints true
```

## Throwing exceptions
Exceptions can be thrown from methods and properties, with different exceptions for different arguments. The exception is thrown when the configured call happens.

<!-- docs-check: uses=calculator -->
```typescript
calculator.divide(Arg.any(), 0).throws(new Error('Cannot divide by 0'))
calculator.divide(1, 0) // throws Error: Cannot divide by 0

calculator.isEnabled.throws(new Error('Not available'))
calculator.isEnabled // throws Error: Not available
```

Like `returns()`, `throws()`, `resolves()`, `rejects()` and `mimicks()` take several values, which are used in sequence. The last one repeats.

## Mimicking an implementation
`mimicks()` runs a function of your own for the matching calls. It gets the call's arguments, and its return value is returned.

<!-- docs-check: uses=calculator -->
```typescript
calculator.add(Arg.all()).mimicks((a, b) => a + b)
console.log(calculator.add(2, 3)) // prints 5

let enabled = false
calculator.isEnabled.mimicks(() => enabled)
console.log(calculator.isEnabled) // prints false
enabled = true
console.log(calculator.isEnabled) // prints true
```

The function is not called with the substitute as `this`. Pass an arrow function or a bound method if the implementation needs `this`.

# Argument matchers
There are several ways of matching arguments. They work the same when you set up calls and when you verify them, and they also work for property assignments (`calculator.received().isEnabled = Arg.any()`).

## Matching specific arguments
`Arg.any()` matches any value. `Arg.is(predicate)` matches the values for which the predicate returns `true`. When `Arg.is` replaces an argument, the type of the predicate's parameter is inferred from that argument.

<!-- docs-check: uses=calculator -->
```typescript
// ignoring the first argument
calculator.add(Arg.any(), 2).returns(10)
console.log(calculator.add(1337, 2)) // prints 10
// calculator.add(1337, 3) does not match: it returns an auto-substitute, not 10

// x is inferred as a number
calculator.subtract(Arg.is(x => x < 0), Arg.any()).returns(0)
console.log(calculator.subtract(-5, 3)) // prints 0

// matchers verify received calls, too
calculator.received().add(Arg.is(x => x > 1000), 2)
```

Outside of an argument position, for example in a variable, there is nothing to infer the type from, so annotate the parameter:

<!-- docs-check: uses=calculator -->
```typescript
const negative = Arg.is((x: number) => x < 0)
calculator.divide(negative, negative).returns(1)
console.log(calculator.divide(-4, -2)) // prints 1
```

`Arg.is()` with something other than a function throws a `TypeError` right away. A predicate that throws, for example because it reads a property of `null`, counts as a non-match: the code under test is not affected, and a failed assertion says that the predicate threw.

## Matching by type
`Arg.any(type)` matches values of a type:

| `type` | Matches |
|---|---|
| `'any'` (the default) | any value, including `undefined` and `null` |
| `'string'`, `'number'`, `'boolean'`, `'symbol'`, `'undefined'` | values with that `typeof` |
| `'object'` | objects, arrays and substitutes, but not `null` |
| `'function'` | functions (and classes) and substitutes |
| `'array'` | arrays (`Array.isArray`) |

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Printer {
  print(value: unknown): string
}

const printer = Substitute.for<Printer>()
printer.print(Arg.any('string')).returns('a string')
printer.print(Arg.any('object')).returns('an object')
printer.print(Arg.any('array')).returns('an array')

console.log(printer.print('hello')) // prints a string
console.log(printer.print({ id: 1 })) // prints an object
// an array matches both 'object' and 'array'; the setup made last wins (see "Match order")
console.log(printer.print([1, 2])) // prints an array

printer.print(null)
// { id: 1 } and [1, 2] are objects, null is not
printer.received(2).print(Arg.any('object'))
```

## Inverse matchers
`Arg.is.not(predicate)` and `Arg.any.not(type)` match the values that the matcher without `.not` does not match.

<!-- docs-check: uses=calculator -->
```typescript
const isZero = (x: number) => x === 0

// the first argument matches any number, the second any number except 0
calculator.divide(Arg.any('number'), Arg.is.not(isZero)).returns(10)
console.log(calculator.divide(100, 10)) // prints 10
// calculator.divide(100, 0) does not match

calculator.received(1).divide(Arg.any(), Arg.is.not(isZero))
calculator.didNotReceive().divide(Arg.any.not('number'), Arg.any())
```

## Ignoring all arguments
`Arg.all()` as the only argument matches every call, whatever its arguments:

<!-- docs-check: uses=calculator -->
```typescript
calculator.add(Arg.all()).returns(10)
console.log(calculator.add(1, 3)) // prints 10
console.log(calculator.add(5, 2)) // prints 10
```

After other arguments, `Arg.all()` matches the rest of the arguments, which can also be none. The arguments before it must match as usual. Arguments after `Arg.all()` are an error (a `SubstituteException`).

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Logger {
  log(message: string, ...details: unknown[]): void
}

const logger = Substitute.for<Logger>()
logger.log('saved')
logger.log('saved', 42, 'extra')
logger.log('deleted', 7)

logger.received(2).log('saved', Arg.all())
logger.received(1).log('deleted', Arg.all())
logger.received(3).log(Arg.all())
```

## Match order
When several setups match a call, the most specific one wins:

1. a setup whose arguments are all literal values,
2. then a setup with at least one `Arg.any()` / `Arg.is()` matcher (or literals followed by `Arg.all()`),
3. then a setup with `Arg.all()` as its only argument.

Among setups of the same kind, the one configured last wins, so a later setup overrides an earlier one.

<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 3).returns(1337)
calculator.add(Arg.all()).returns(10)
calculator.add(Arg.is(a => a > 100), Arg.any()).returns(100)

// literal arguments win over matchers, and matchers win over Arg.all()
console.log(calculator.add(1, 3)) // prints 1337
console.log(calculator.add(200, 3)) // prints 100
console.log(calculator.add(5, 2)) // prints 10

// among setups with matchers, the newest one wins
calculator.add(Arg.any(), Arg.is(b => b > 10)).returns(-1)
console.log(calculator.add(200, 30)) // prints -1
console.log(calculator.add(200, 3)) // prints 100
```

## Re-configuring a call (configure)
Outside of a setup, a call whose literal arguments match an existing setup is a real call: it returns the configured value. A primitive value like `10` has no `.returns()`, so you cannot configure such a call again by writing it out. (If the configured value is an object or a substitute, `.returns()` would even configure that object instead.)

Use `sub[configure]()` instead. It gives a view of the substitute in which every call and property read is a setup: it never runs an existing setup and is never recorded as a received call.

<!-- docs-check: uses=calculator -->
```typescript
import { configure } from '@fluffy-spoon/substitute'

calculator.add(Arg.all()).returns(10)
// add(1, 3) matches the setup above, so it returns 10 and has no .returns():
calculator.add(1, 3).returns(1337) // throws TypeError: calculator.add(...).returns is not a function

calculator[configure]().add(1, 3).returns(1337)
console.log(calculator.add(1, 3)) // prints 1337
console.log(calculator.add(5, 2)) // prints 10

// the same applies to changing a value that is already configured, and to properties
calculator.isEnabled.returns(true)
calculator[configure]().isEnabled.returns(false)
console.log(calculator.isEnabled) // prints false
```

Calls with argument matchers are always setups (see [What counts as a call](#what-counts-as-a-call)), so a catch-all setup *after* a specific one needs no `configure`. In TypeScript, the `configure` view only offers the setup methods.

# Partial mocks
With partial mocks you always start with a true substitute where everything is mocked, and then opt out of substitutions in certain scenarios: per call with `mimicks()`, or for a whole instance with `[mimick]()`. The examples use this implementation:

<!-- docs-check: name=real-calculator uses=calculator -->
```typescript
class RealCalculator implements Calculator {
  isEnabled = true
  add(a: number, b: number) { return a + b }
  subtract(a: number, b: number) { return a - b }
  divide(a: number, b: number) { return a / b }
  async heavyOperation(...numbers: number[]) { return numbers.reduce((total, n) => total + n, 0) }
}

const realCalculator = new RealCalculator()
```

<!-- docs-check: uses=real-calculator -->
```typescript
// let the subtract method always use the real method
calculator.subtract(Arg.all()).mimicks(realCalculator.subtract)
console.log(calculator.subtract(20, 10)) // prints 10
console.log(calculator.subtract(1, 2)) // prints -1

// for the add method, use the real method only when the first argument is less than 10
// else, always return 1337
calculator.add(Arg.is(x => x < 10), Arg.any()).mimicks(realCalculator.add)
calculator.add(Arg.is(x => x >= 10), Arg.any()).returns(1337)
console.log(calculator.add(5, 100)) // prints 105
console.log(calculator.add(210, 7)) // prints 1337

// for the divide method, use the real method only for these exact arguments
calculator.divide(10, 2).mimicks(realCalculator.divide)
calculator.divide(Arg.all()).returns(1338)
console.log(calculator.divide(10, 2)) // prints 5
console.log(calculator.divide(10, 5)) // prints 1338
```

`sub[mimick](instance)` hands everything that is not configured to a real instance: property reads return the instance's values, method calls run the instance's methods (with `this` being the instance), and assignments write to the instance. Members that the instance does not have read as `undefined`. Setups still win, and every call is recorded, so you can verify it. Because real calls are passed on to the instance, configure a mimicked substitute through [`[configure]()`](#re-configuring-a-call-configure).

<!-- docs-check: uses=real-calculator -->
```typescript
import { mimick, configure } from '@fluffy-spoon/substitute'

calculator[mimick](realCalculator)
console.log(calculator.add(2, 3)) // prints 5
console.log(calculator.isEnabled) // prints true

calculator[configure]().divide(Arg.all()).returns(0)
console.log(calculator.divide(1, 1)) // prints 0

// the code under test sets a property
const disable = (c: Calculator) => { c.isEnabled = false }
disable(calculator)
console.log(realCalculator.isEnabled) // prints false

calculator.received().add(2, 3)
calculator.received().isEnabled = false
```

The string `mimick` is not part of the API (any more): `sub.mimick(...)` is an ordinary member, like every name except the [conflicting names](#names-that-conflict-with-the-library).

# Auto-substitutes and nested members
A member or call that is not configured returns an auto-substitute: a substitute of its own, created the first time and then reused. The same member, or the same method with equal arguments, always gives the same auto-substitute. So the code under test can use nested members without crashing, and you can configure and verify them:

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const app = Substitute.for()
console.log(app.logger === app.logger) // prints true
console.log(app.getCalculator() === app.getCalculator()) // prints true

app.getCalculator().add(1, 2).returns(99)
console.log(app.getCalculator().add(1, 2)) // prints 99

// the code under test logs a message
app.logger.info('started')

app.logger.received().info('started')
app.logger.didNotReceive().info('stopped')
```

Setups and calls never leak between members: `app.add(1, 2).returns(99)` does not configure `app.getCalculator().add(1, 2)`, and the other way round. The calls in a setup or an assertion (`app.getCalculator()` above) are not recorded as received calls.

**Typing limitation:** in TypeScript, nested auto-substitutes are typed as plain values, not as substitutes, so `app.getCalculator().add(1, 2).returns(99)` and `app.logger.received()` do not compile. They do work at runtime (in JavaScript, or through a cast). In TypeScript, configure the member to return a substitute you create yourself; that is fully typed:

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface Logger { info(message: string): void }
interface Calculator { add(a: number, b: number): number }
interface App {
  logger: Logger
  getCalculator(): Calculator
}

const app = Substitute.for<App>()
const logger = Substitute.for<Logger>()
const calculator = Substitute.for<Calculator>()
app.logger.returns(logger)
app.getCalculator().returns(calculator)

calculator.add(1, 2).returns(99)
console.log(app.getCalculator().add(1, 2)) // prints 99

app.logger.info('started')
logger.received().info('started')
```

# Verifying calls
## received and didNotReceive
`received()` checks that a call was received at least once, `received(count)` that it was received exactly `count` times, and `didNotReceive()` that it was never received. A failed check throws a [`SubstituteException`](#substituteexception).

<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2)
calculator.add(1, 2)
calculator.add(3, 4)

calculator.received().add(1, 2)
calculator.received(2).add(1, 2)
calculator.received(3).add(Arg.all())
calculator.didNotReceive().add(5, 6)
calculator.received(0).add(5, 6) // the same as didNotReceive()

calculator.received(1).add(1, 2) // throws SubstituteException
```

The count must be a non-negative integer, or left out (meaning "1 or more"). Anything else (a negative or fractional number, `NaN`, `Infinity`, a string) throws a `SubstituteException` instead of letting the check pass:

<!-- docs-check: uses=calculator -->
```typescript
const items = ['a', 'b']
calculator.received(items.length - 3).add(1, 2) // throws SubstituteException: Expected count has to be a non-negative integer
```

A failed check describes what was expected and lists the calls that were received (at most 50 of them):

<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2)
calculator.received().add(3, 4) // throws SubstituteException
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute.add:
Expected to receive 1 or more method calls matching add(3, 4), but received none.
All property or method calls to @Substitute.add received so far:
› ✘ @Substitute.add(1, 2)
    called at Object.<anonymous> (test/calculator.test.ts:2:12)
```

The message contains ANSI colours only when the output is a terminal. `NO_COLOR`, `NODE_DISABLE_COLORS` and `TERM=dumb` turn colours off, and `FORCE_COLOR` turns them on.

## Properties
`received().property` counts reads of a property, and `received().property = value` counts assignments of that value (matchers work here as well).

<!-- docs-check: uses=calculator -->
```typescript
// the code under test reads the property and sets it
const toggle = (c: Calculator) => { c.isEnabled = !c.isEnabled }

calculator.isEnabled.returns(false)
toggle(calculator)

calculator.received(1).isEnabled
calculator.received().isEnabled = true
calculator.received(1).isEnabled = Arg.any()
calculator.didNotReceive().isEnabled = false
```

In TypeScript, assigning a property on the substitute itself (`calculator.isEnabled = true`) does not compile, see [Typing limitations](#typing-limitations). The code under test assigns through its own type, like `toggle` above.

## What counts as a call
* Every invocation is a call of its own, also through a stored or destructured reference, a callback, or `.call()` / `.apply()` / `.bind()`.
* Reading a method without calling it, for example to register it as an event handler that never fires, is not a call. Method checks (`received().subtract(...)`, also with `Arg.all()`) only count invocations.
* A call with an argument matcher (`Arg.any()`, `Arg.is()`, `Arg.all()`, also with `.not`) is a setup or a check, never a received call. It does not run an existing setup either.
* Checks never run setups or mimicked implementations, and are never recorded themselves. Checking a property configured with `throws()` does not throw, and checking a property configured with a sequence does not use up a value.

<!-- docs-check: uses=calculator -->
```typescript
const { add } = calculator
for (const n of [1, 2, 3]) add(n, n)
calculator.received(3).add(Arg.all())

const handler = calculator.subtract
calculator.received().subtract(Arg.all()) // throws SubstituteException

calculator.divide(Arg.any(), 2) // a setup without a value, not a call
calculator.didNotReceive().divide(Arg.all())
```

**Known issue in 2.0.1:** `didNotReceive().subtract(...)` (or `received(0)`) on a method that has been read but never called fails, because the library decides at `.subtract` whether you check a property read or a method call. If the code under test registers a method without calling it, clear the received calls after that (see below) before you check that it was not called.

## Clearing received calls
`sub[clearReceivedCalls]()` forgets the received calls of a substitute and of its auto-substitutes. Setups are kept, including the position in a sequence of return values. To start over completely, create a new substitute.

<!-- docs-check: uses=calculator -->
```typescript
import { clearReceivedCalls } from '@fluffy-spoon/substitute'

calculator.add(1, 2).returns(3)
calculator.add(1, 2)
calculator[clearReceivedCalls]()

calculator.didNotReceive().add(1, 2)
console.log(calculator.add(1, 2)) // prints 3
```

## SubstituteException
Failed checks, and invalid use of the library such as `received(-1)` or arguments after `Arg.all()`, throw a `SubstituteException`. It is exported, so you can check for it with `instanceof`:

<!-- docs-check: uses=calculator -->
```typescript
import { SubstituteException } from '@fluffy-spoon/substitute'

try {
  calculator.received().add(1, 2)
} catch (error) {
  console.log(error instanceof SubstituteException) // prints true
}
```

## Assertions that fail later
Checks throw right away, with one exception. In a property-style check, `sub.received(count).member` that is not followed by a call, on a member that has been called as a method, the library cannot know yet whether you are about to call it (`sub.received(2).member(...)`). If the property check fails, the failure is reported on `process.nextTick`, and it is cancelled if you call the member. Such a failure escapes `try`/`catch` and `t.throws()`. Test runners report it as an uncaught exception in the running test.

<!-- docs-check: uses=calculator uncaught=SubstituteException -->
```typescript
calculator.add(1, 2)
calculator.add(1, 2)
calculator.add(3, 4)

// not followed by a call, so the library cannot decide yet:
// the SubstituteException is thrown later, on process.nextTick
calculator.received(2).add
```

To avoid this, check methods with a call (`calculator.received(2).add(1, 2)`, or `.add(Arg.all())`). Those are decided right away.

# Names that conflict with the library
A substituted type may have members with the same names as the library's methods: `received`, `didNotReceive`, `returns`, `throws`, `resolves`, `rejects` or `mimicks`. Each of them has a symbol (exported from the package) that always means the library method.

## In TypeScript
If the substituted type has a member with one of these names, `sub.received()` and `sub.didNotReceive()` are not offered, because they would be ambiguous. Use the symbols `sub[received]()` and `sub[didNotReceive]()`; they are always available.

```typescript
import { Substitute, Arg, received } from '@fluffy-spoon/substitute'

class Example {
  received(someNumber: number) {
    return someNumber
  }
}

const fake = Substitute.for<Example>()

// `fake.received` is the class' own method
fake.received(1).returns(2)
console.log(fake.received(1)) // prints 2

// check it with the symbol
fake[received]().received(1)
fake[received](1).received(Arg.any())
fake[received](2).received(1) // throws SubstituteException
```

In the same way, `.returns()`, `.throws()`, `.mimicks()`, `.resolves()` and `.rejects()` are not offered on a value that has its own member with that name. That value is the property's type, or the return type of the call. Use the symbols `[returns]`, `[throws]`, `[mimicks]`, `[resolves]` and `[rejects]` there; they always work.

```typescript
import { Substitute, returns } from '@fluffy-spoon/substitute'

interface Order {
  returns: string[]
  total(): number
}

interface Shop {
  find(id: string): Order
}

const shop = Substitute.for<Shop>()
const order = Substitute.for<Order>()

// an Order has a member called `returns`, so shop.find('1').returns is that member
shop.find('1')[returns](order)
order.total().returns(42)

console.log(shop.find('1').total()) // prints 42
```

`clearReceivedCalls`, `mimick` and `configure` exist only as symbols, so members with those names never conflict.

## In JavaScript
Without types, the library decides by how a name is used:

* `sub.received(...)` and `sub.didNotReceive()` are checks when they are called and followed by a member, like `sub.received(2).add(1, 2)`. Followed by `.returns()`, `.throws()`, `.resolves()`, `.rejects()` or `.mimicks()`, they configure a member of your own called `received` or `didNotReceive`.
* `sub.received` that is not called is an ordinary member, so the code under test can read a property called `received`.
* The symbols `sub[received]()` and `sub[didNotReceive]()` are always checks. Use them to check members called `returns`, `throws`, `resolves`, `rejects` or `mimicks`.

```js
const { Substitute, received } = require('@fluffy-spoon/substitute')

const mailbox = Substitute.for()
mailbox.received(1).returns(['mail'])
console.log(mailbox.received(1)) // prints [ 'mail' ]

const builder = Substitute.for()
builder.returns(5) // the code under test calls its own `returns` method
builder[received]().returns(5)
```

# The symbol API
All of these are exported from the package root.

| Symbol | Usage | Notes |
|---|---|---|
| `received` | `sub[received](count?).member...` | Always a check. |
| `didNotReceive` | `sub[didNotReceive]().member...` | Always a check, the same as `[received](0)`. |
| `clearReceivedCalls` | `sub[clearReceivedCalls]()` | Symbol only. See [Clearing received calls](#clearing-received-calls). |
| `mimick` | `sub[mimick](instance)` | Symbol only. See [Partial mocks](#partial-mocks). |
| `configure` | `sub[configure]().member...` | Symbol only. See [Re-configuring a call](#re-configuring-a-call-configure). |
| `returns`, `throws`, `resolves`, `rejects`, `mimicks` | `sub.member(...)[returns](value)`, `sub.property[throws](error)` | The same as the string methods. They configure a member or a call, so using them on the substitute itself (`sub[returns](1)`) is an error. |

The symbols are registered with `Symbol.for()`, so they also work when two copies of the package are installed.

# Special members
A few members are handled by the substitute itself and cannot be configured or checked:

* `then` is always `undefined`, so a substitute is not a thenable. You can return it from an `async` function or `await` it, and you get the substitute back. In TypeScript, a member called `then` is typed `never`.
* `toJSON`: `JSON.stringify(sub)` gives a short description of the substitute.
* `Symbol.toPrimitive` and `util.inspect.custom`: `String(sub)`, template strings and `console.log(sub)` show the substitute's setups and received calls.

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface Calculator { add(a: number, b: number): number }

const calculator = Substitute.for<Calculator>()
async function load() { return calculator }
load().then(loaded => console.log(loaded === calculator)) // prints true
```

# Typing limitations
TypeScript cannot express a few things about substitutes:

* **Assigning a property on the substitute** (`calculator.isEnabled = true`) does not compile, because the property's type also carries the setup API (`.returns()` and so on). Assign through the interface type, as the code under test does, and check with `calculator.received().isEnabled = true`.
* **`null` and `undefined`** are not part of the type of a call or property under `strictNullChecks`, although `.returns(null)` is accepted. Assign the value to the declared type, or give explicit type arguments (`t.is<string | null>(repository.find(1), null)`).
* **A generic method called with explicit type arguments** (`store.get<number>('answer')`) has no setup API. Call it without type arguments.
* **Overloads whose parameters have literal types** (`on(event: 'data', ...)`) resolve to the interface's own declaration when you call them directly. Configure them with `sub[configure]().on('data', ...)`.
* **More than 8 overloads:** only the last 8 have the setup API.
* **A property typed `never`** cannot be configured.
* **Nested auto-substitutes** are not typed as substitutes, see [Auto-substitutes](#auto-substitutes-and-nested-members).

<!-- docs-check: uses=calculator -->
```typescript
import { configure } from '@fluffy-spoon/substitute'

// @ts-expect-error the property's type carries the setup API
calculator.isEnabled = true
const asCalculator: Calculator = calculator
asCalculator.isEnabled = true
// at runtime, both assignments are recorded
calculator.received(2).isEnabled = true

interface Repository {
  find(id: number): string | null
}
const repository = Substitute.for<Repository>()
repository.find(1).returns(null)
const found: string | null = repository.find(1)
console.log(found) // prints null

interface Store {
  get<T>(key: string): T
}
const store = Substitute.for<Store>()
store.get('answer').returns(42)
console.log(store.get<number>('answer')) // prints 42

interface Socket {
  on(event: 'data', listener: (data: string) => void): Socket
  on(event: 'close', listener: () => void): Socket
}
const socket = Substitute.for<Socket>()
socket[configure]().on('data', Arg.any()).returns(socket)
console.log(socket.on('data', () => { }) === socket) // prints true
```

# Test runners
Checks throw a `SubstituteException`, so they work with any test runner: a failed check fails the test, and you can expect one with your runner's `throws` assertion. ava, jest, mocha, node:test and vitest are tested on every change, including a check that [fails later](#assertions-that-fail-later), which each of them reports as a failure.

```typescript
import { test } from 'node:test'
import * as assert from 'node:assert'
import { Substitute, SubstituteException } from '@fluffy-spoon/substitute'

interface Calculator { add(a: number, b: number): number }

test('adds the numbers', () => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 2)

  calculator.received().add(1, 2)
  assert.throws(() => calculator.received().add(3, 4), SubstituteException)
})
```

With ava:

<!-- docs-check: compile-only -->
```typescript
import test from 'ava'
import { Substitute, SubstituteException } from '@fluffy-spoon/substitute'

interface Calculator { add(a: number, b: number): number }

test('adds the numbers', t => {
  const calculator = Substitute.for<Calculator>()
  calculator.add(1, 2)

  t.notThrows(() => calculator.received().add(1, 2))
  t.throws(() => calculator.received().add(3, 4), { instanceOf: SubstituteException })
})
```

# Benefits over other mocking libraries
- Easier-to-understand fluent syntax.
- No need to cast to `any` in certain places (for instance, when overriding read-only properties) due to the `myProperty.returns(...)` syntax.
- Doesn't weigh much.
- Produces very clean and descriptive error messages. Try it out - you'll love it.
- Doesn't rely on object instances - you can produce a strong-typed fake from nothing, ensuring that everything is mocked.

# Contributors

## Code Contributors

This project exists thanks to all the people who contribute. [[Contribute](CONTRIBUTING.md)].
<a href="https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/graphs/contributors"><img src="https://opencollective.com/substitute-js/contributors.svg?width=890&button=false" /></a>

## Financial Contributors

Become a financial contributor and help us sustain our community. [[Contribute](https://opencollective.com/substitute-js/contribute)]

### Individuals

<a href="https://opencollective.com/substitute-js"><img src="https://opencollective.com/substitute-js/individuals.svg?width=890"></a>

### Organizations

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
