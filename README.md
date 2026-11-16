<a href="https://opencollective.com/substitute-js#section-contribute"><img src="https://opencollective.com/substitute-js/all/badge.svg?label=financial+contributors" alt="Financial Contributors on Open Collective" /></a>

# What is this?
[`@fluffy-spoon/substitute`](https://www.npmjs.com/package/@fluffy-spoon/substitute) is a TypeScript port of [NSubstitute](http://nsubstitute.github.io), which aims to provide a much more fluent mocking opportunity for strong-typed languages.

*You can read an in-depth comparison of `substitute.js` versus other popular TypeScript mocking frameworks here: https://medium.com/@mathiaslykkegaardlorenzen/with-typescript-3-and-substitute-js-you-are-already-missing-out-when-mocking-or-faking-a3b3240c4607 (written for version 1; the ideas still apply).*

**PRs are very welcome! Help is much appreciated.**

> Upgrading from 1.x or from a 2.0.0 beta? Read the [migration guide](MIGRATION.md). What changed in each version is in the [changelog](CHANGELOG.md).

# Table of contents
- [Installing](#installing) · [Requirements](#requirements) · [Importing](#importing)
- [Usage](#usage): [creating a substitute](#creating-a-substitute), [return values](#setting-return-values), [promises](#working-with-promises), [exceptions](#throwing-exceptions), [mimicking](#mimicking-an-implementation), [members that are a property and a method](#members-used-as-a-property-and-as-a-method)
- [Argument matchers](#argument-matchers), [inside objects and arrays](#matchers-inside-objects-and-arrays), [how arguments are compared](#how-arguments-are-compared) and [match order](#match-order)
- [Re-configuring a call](#re-configuring-a-call-configure) · [Partial mocks](#partial-mocks) · [Auto-substitutes](#auto-substitutes-and-nested-members) and [which calls lead to a setup](#which-calls-lead-to-a-setup-or-a-check)
- [Verifying calls](#verifying-calls): [counts](#received-and-didnotreceive), [properties](#properties), [what counts as a call](#what-counts-as-a-call), [clearing](#clearing-received-calls), [SubstituteException](#substituteexception), [deferred failures](#assertions-that-fail-later)
- [Names that conflict with the library](#names-that-conflict-with-the-library), [`call`, `apply` and `bind`](#call-apply-and-bind) and [the symbol API](#the-symbol-api)
- [Special members](#special-members) · [Typing limitations](#typing-limitations) · [Test runners](#test-runners) · [Performance](#performance)

# Installing
```sh
npm install @fluffy-spoon/substitute --save-dev
```

This README describes version 2. Until 2.0.1, `npm install` installed 1.208.0 (the `latest` tag). If you depend on version 1, pin it with `npm install @fluffy-spoon/substitute@1 --save-dev`; its README is at the [v1.208.0 tag](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/tree/v1.208.0#readme).

# Requirements
* Node.js 10 or newer for CommonJS (`require`).
* For the ES module entry point (`import`): Node.js 12.17 or newer on 12.x, 13.7 or newer on 13.x, or 14 or newer. Node.js 10.x, 12.0 to 12.16 and 13.0 to 13.1 have no ES modules without a flag, and 13.2 to 13.6 do not pick the package's ES module entry, so named imports fail there; use `require` on those versions.
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

The ES module entry point wraps the CommonJS build, so both share one copy of the library. Bundlers give the same exports: on every change, the package is bundled with Rollup and `@rollup/plugin-commonjs`, webpack, esbuild and a Vite SSR build with `ssr.noExternal`, and run in vitest with `server.deps.inline`. For esbuild's ES module output for Node.js (`format: 'esm'`, `platform: 'node'`), add the usual banner `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`, because the library loads Node.js' `util` module with `require`. If a tool cannot hand the CommonJS exports to the ES module entry, `import` throws right away with an error that says so; use `require()` with that tool.

Everything is exported from the package root: `Substitute`, `Arg`, `SubstituteException`, the type `SubstituteOf<T>`, and the symbols `received`, `didNotReceive`, `clearReceivedCalls`, `mimick`, `configure`, `returns`, `throws`, `resolves`, `rejects` and `mimicks`. Paths inside the package (`@fluffy-spoon/substitute/dist/...`) are not public API and can change in any release.

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

The function is called with the `this` of the call, like a method: the substitute for `calculator.add(2, 3)`, the first argument of `.call()` and `.apply()`, and `undefined` for a property read or a call through a destructured reference. If the implementation needs `this` to be something else, for example the real instance of a method you pass in, pass an arrow function or a bound method (`realCalculator.add.bind(realCalculator)`).

## Members used as a property and as a method
A member can be configured both as a method and as a property, for example a member of a callable interface. Calls are answered by the method setups and reads by the property setup. Configure the method first. Once the property answers with a value, `stats.size(...)` is a call of that value, so configure the method through [`configure`](#re-configuring-a-call-configure) then: `stats[configure]().size(Arg.any()).returns(10)`.

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const stats = Substitute.for()
stats.size(Arg.any()).returns(10)
stats.size.returns(3)

console.log(stats.size('files')) // prints 10
console.log(stats.size.toFixed(1)) // prints 3.0
console.log(stats.size.valueOf() + 1) // prints 4
console.log(stats.size === 3) // prints false
```

Because such a member must stay callable, reading it gives a function that stands in for the configured value. Reading a member of it reads that member of the value, and methods read from it run on the value, like `stats.size.toFixed(1)`. If the value is a substitute, it records and answers its own calls. The stand-in itself is not the value, so compare or compute with it through its members, for example `valueOf()`.

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
  log(message: string, ...details: string[]): void
}

const logger = Substitute.for<Logger>()
logger.log('saved')
logger.log('saved', 'id 42', 'extra')
logger.log('deleted', 'id 7')

logger.received(2).log('saved', Arg.all())
logger.received(1).log('deleted', Arg.all())
logger.received(3).log(Arg.all())
```

## Matchers inside objects and arrays
Matchers also work inside plain objects and arrays, at any depth. An object with a matcher matches an argument with the same keys (in any order), and an array with a matcher matches an array of the same length. Each nested matcher matches by its own rule, and every other value must be [equal](#how-arguments-are-compared). Like any call with a matcher, such a call is a setup or a check, never a received call, and in the [match order](#match-order) it ranks with the other matcher setups.

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface User {
  id: number
  name: string
  roles: string[]
}

interface Repository {
  save(user: User): string
}

const repository = Substitute.for<Repository>()
repository.save({ id: Arg.any(), name: 'bob', roles: [Arg.is(role => role.startsWith('admin'))] }).returns('saved')

console.log(repository.save({ id: 1, name: 'bob', roles: ['admin:all'] })) // prints saved
console.log(repository.save({ name: 'bob', roles: ['admin:read'], id: 2 })) // prints saved
// another name, or a second role, does not match
repository.save({ id: 3, name: 'ann', roles: ['admin:all'] })
repository.save({ id: 4, name: 'bob', roles: ['admin:all', 'user'] })

repository.received(2).save({ id: Arg.any(), name: 'bob', roles: [Arg.any()] })
repository.received(4).save(Arg.all())
repository.didNotReceive().save({ id: Arg.any(), name: 'bob', roles: [] })
```

* `Arg.all()` as the last item of an array matches the remaining items, also none: `['level', Arg.all()]` matches `['level']` and `['level', 1, 2]`. Anywhere else in an array it is a `SubstituteException`. As the value of a key, `Arg.all()` matches any value, but the key must be there. (In TypeScript, `Arg.all()` inside an object or array does not type-check; use `Arg.any()` for a single value.)
* Only plain objects (created with `{ }` or `Object.create(null)`) and arrays are searched for matchers, and an object with matchers only matches an argument with the same prototype: `{ id: Arg.any() }` does not match a class instance. A matcher inside a class instance, a `Map` or a `Set` is not looked for: it is compared as a value, so such a setup never matches, and the call is an ordinary call. Matchers behind getters are not looked for either. Use `Arg.is()` for the whole argument in these cases.
* `String(sub)` shows nested matchers, for example `save({ id: Arg.any{any}, name: 'bob' }) => returns('saved')`.

## How arguments are compared
Arguments that are not matchers are compared with deep strict equality, the rule of `assert.deepStrictEqual` (`util.isDeepStrictEqual`). Objects and arrays are equal when they have the same prototype and their own enumerable properties (with string or symbol keys) are equal. `NaN` equals `NaN`, but `0` and `-0` are different, and an invalid `Date` equals nothing, not even another invalid `Date`. Substitutes are compared by identity and never member by member.

Deep strict equality cannot see `#private` fields or other internal state. So all instances of a class that keeps its state only in `#private` fields are equal to each other. For such classes, pass the same instance, or match with `Arg.is()`:

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

class Money {
  #cents: number
  constructor(cents: number) { this.#cents = cents }
  get cents() { return this.#cents }
}

interface Bank {
  pay(amount: Money): string
}

const bank = Substitute.for<Bank>()
bank.pay(new Money(100)).returns('paid')
// all Money instances are equal to each other
console.log(bank.pay(new Money(5))) // prints paid

const checkedBank = Substitute.for<Bank>()
checkedBank.pay(Arg.is(amount => amount.cents === 100)).returns('paid')
console.log(checkedBank.pay(new Money(5)) === 'paid') // prints false
console.log(checkedBank.pay(new Money(100))) // prints paid
```

Changing an object after you used it as an argument of a setup is not supported. The setup still matches when the code under test passes that same object again, but not a new object that equals it, before or after the change:

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const repository = Substitute.for()
const user = { name: 'ann' }
repository.save(user).returns('saved')
user.name = 'bob'

console.log(repository.save(user)) // prints saved
console.log(repository.save({ name: 'bob' }) === 'saved') // prints false
console.log(repository.save({ name: 'ann' }) === 'saved') // prints false
```

Received calls keep the argument objects themselves, so a check compares an argument as it is at the time of the check. If the code under test changes an object after passing it, check its new value.

## Match order
When several setups match a call, the most specific one wins:

1. a setup whose arguments are all literal values,
2. then a setup with at least one `Arg.any()` / `Arg.is()` matcher, also inside an object or array (or literals followed by `Arg.all()`),
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
Outside of a setup, a call whose literal arguments match an existing setup is a real call: it returns the configured value. So writing the call out again does not configure it again, and what `.returns()` does then depends on the configured value:

* A primitive like `10`, a plain object or an array has no `.returns()`, so you get a `TypeError`.
* A substitute that you created with `Substitute.for()` has a member called `returns`, like every other name. `.returns(x)` is recorded as a call of that member, and nothing is configured. Nothing fails, and TypeScript does not catch it either.
* An auto-substitute (an unconfigured member of a substitute) is configured itself: `.returns(x)` configures that member, not the call.

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

A setup in the `configure` view can go through a member or a call that already answers with a value. If that value is a substitute, the setup goes to that substitute, which keeps its other setups. If it is a real value (a plain object, an array, a primitive), or the member is configured with `throws()`, `resolves()`, `rejects()` or `mimicks()`, its members cannot be configured, and the setup throws a `SubstituteException` that says so. Nothing is replaced in that case. Members and calls that do not answer with a value yet are configured as usual.

```js
const { Substitute, configure } = require('@fluffy-spoon/substitute')

const repository = Substitute.for()
repository.find(2).returns('two')

const container = Substitute.for()
container.getRepository().returns(repository)

// getRepository() answers with a substitute, so the setup goes to that substitute
container[configure]().getRepository().find(1).returns('one')
console.log(container.getRepository() === repository) // prints true
console.log(repository.find(1)) // prints one
console.log(repository.find(2)) // prints two

container.settings.returns({ port: 80 })
container[configure]().settings.port.returns(1) // throws SubstituteException: settings returns { port: 80 }, which is not a substitute
```

For a call without matchers, the setup that answers the call counts, also a matcher setup: after `lookup.get(Arg.any()).returns(repository)`, `lookup[configure]().get(5).find(3).returns('three')` configures `repository.find(3)`.

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

`sub[mimick](instance)` hands everything that is not configured to a real instance: property reads return the instance's values, method calls run the instance's methods (with `this` being the instance, unless you pass another one with `.call()` or `.apply()`), and assignments write to the instance. If the instance is a function, calling the substitute calls it, with the `this` of the call. Members that the instance does not have read as `undefined`. Setups still win, and every call is recorded, so you can verify it. Because real calls are passed on to the instance, configure a mimicked substitute through [`[configure]()`](#re-configuring-a-call-configure).

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

In the `configure` view, a setup through a member of the instance whose value is a substitute goes to that substitute, and from then on the member reads as that substitute. The members of a real value of the instance cannot be configured: with `sub[mimick]({ settings: { port: 80 } })`, `sub[configure]().settings.port.returns(1)` throws a `SubstituteException`. Configure the whole member instead: `sub[configure]().settings.returns({ port: 1 })`. A setup through a method of the instance, like `sub[configure]().load().size.returns(1)`, does not run the real method. It creates a setup for `load()`, which from then on answers that call instead of the instance.

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

Setups and calls never leak between members: `app.add(1, 2).returns(99)` does not configure `app.getCalculator().add(1, 2)`, and the other way round.

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

## Which calls lead to a setup or a check
The reads and calls that lead up to a setup or a check in the same expression, like `app.getCalculator()` in `app.getCalculator().add(1, 2).returns(99)`, are part of that setup or check, so they are not recorded as received calls. A value that the code under test got from a substitute keeps the call that returned it, though, so you can configure or check that value and still verify how the code under test got it:

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// the code under test
function openConnection(driver) {
  return driver.connect('db://test')
}

const driver = Substitute.for()
const connection = openConnection(driver)
connection.isOpen.returns(true)

console.log(connection.isOpen) // prints true
driver.received(1).connect('db://test')
driver.didNotReceive().connect('db://test') // throws SubstituteException
```

The library tells the two apart by where they happen: the reads and calls before a setup or a check are left out only when they were made in the same file and the same function as the setup or check. (It compares the first stack frame outside the library: the position of the enclosing function, or on Node.js before 14.18 its name.) So:

* A chain written over several lines, or in a helper function of your own, is one setup or check.
* A handle that you store and use in the same function is part of the setup: after `const logger = app.logger` and `logger.level.returns(3)`, the read of `app.logger` is not recorded.
* A handle that you get in one function and use in another one keeps the reads that produced it. For example, after `const click = app.handlers.click` in a test, `t.notThrows(() => click.received(1).fire())` runs the check in a callback, so the reads of `handlers` and `click` stay recorded, and `app.didNotReceive().handlers` would fail.
* Calls that the code under test makes in its own functions are kept.
* Without stack frames (`Error.stackTraceLimit = 0`), only position decides: a setup or check right after the call that returned its value, with no other use of a substitute in between, leaves that call out.

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

When the member was never used at all, the check fails as soon as it reads the member, before the arguments are known, so the message cannot name them: `Expected to receive 1 or more property reads or method calls matching add, but received none.` Once the method has been called, the message names the expected arguments, as above.

A method that was read but never called fails a method check right away with the reads listed, and a hint:

<!-- docs-check: uses=calculator -->
```typescript
// the code under test registers a handler, which never fires
const handler = calculator.subtract
calculator.received(2).subtract(5, 1) // throws SubstituteException
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute.subtract:
Expected to receive 2 property reads or method calls matching subtract, but received 1 property read and no method calls.
All property or method calls to @Substitute.subtract received so far:
› ✘ @Substitute.subtract
    called at Object.<anonymous> (test/calculator.test.ts:2:28)
@Substitute.subtract was read 1 time without being called; reading a method does not count as calling it.
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

In TypeScript, assigning a property on the substitute itself (`calculator.isEnabled = true`) does not compile, see [Typing limitations](#typing-limitations). The code under test assigns through its own type, like `toggle` above. In a check, read-only properties can be assigned, and optional properties accept `undefined` (`form.received().note = undefined`).

## What counts as a call
* Every invocation is a call of its own, also through a stored or destructured reference or a callback.
* `.call()`, `.apply()` and `.bind()` work on a method, a function substitute and every other substitute value as on a function: `calculator.subtract.call(undefined, 5, 1)` returns what `calculator.subtract(5, 1)` is configured to return, and counts as a call `subtract(5, 1)`. It counts as a call of a member called `call` as well; see [`call`, `apply` and `bind`](#call-apply-and-bind).
* Reading a method without calling it, for example to register it as an event handler that never fires, is not a call. Method checks (`received().subtract(...)`, also with `Arg.all()`) only count invocations.
* A call with an argument matcher (`Arg.any()`, `Arg.is()`, `Arg.all()`, also with `.not`, also [inside an object or array](#matchers-inside-objects-and-arrays)) is a setup or a check, never a received call. It does not run an existing setup either.
* The reads and calls that lead up to a setup or a check in the same expression are not recorded; see [Which calls lead to a setup or a check](#which-calls-lead-to-a-setup-or-a-check).
* Checks never run setups or mimicked implementations, and are never recorded themselves. Checking a property configured with `throws()` does not throw, and checking a property configured with a sequence does not use up a value.

<!-- docs-check: uses=calculator -->
```typescript
const { add } = calculator
for (const n of [1, 2, 3]) add(n, n)
calculator.received(3).add(Arg.all())

const handler = calculator.subtract
calculator.received().subtract(Arg.all()) // throws SubstituteException

calculator.subtract(5, 1).returns(4)
console.log(calculator.subtract.call(undefined, 5, 1)) // prints 4
calculator.received(1).subtract(5, 1)

calculator.divide(Arg.any(), 2) // a setup without a value, not a call
calculator.didNotReceive().divide(Arg.all())
```

**Known issue in 2.0.1:** `didNotReceive().subtract(...)` (or `received(0)`) on a method that has been read but never called fails, because the library decides at `.subtract` whether you check a property read or a method call. If the code under test registers a method without calling it, clear the received calls after that (see below) before you check that it was not called.

## Clearing received calls
`sub[clearReceivedCalls]()` forgets the received calls of a substitute and of its auto-substitutes. Setups are kept, including the position in a sequence of return values, and so are the auto-substitutes (`app.logger` stays the same object). To start over completely, create a new substitute.

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
Checks throw right away, with one exception: a property-style check, `sub.received(count).member` or `sub.didNotReceive().member` that is not followed by a call, on a member that has been called as a method. The library cannot know yet whether you are about to call it (`sub.received(2).member(...)`), so it reports the failure on `process.nextTick`, and cancels the report if you call the member. There are two cases:

* The property check fails, as in `calculator.received(2).add` below.
* `didNotReceive().member` or `received(0).member` on a member that was only called, never read: it would pass as a property check, but the parentheses were probably forgotten. The report says so: `Expected to receive 0 property reads or method calls matching add, but received 1 method call. add was called 1 time as a method; to assert calls, invoke it: sub.didNotReceive().add(...)`.

Such a failure escapes `try`/`catch` and `t.throws()`. Test runners report it as an uncaught exception in the running test.

<!-- docs-check: uses=calculator uncaught=SubstituteException -->
```typescript
calculator.add(1, 2)
calculator.add(1, 2)
calculator.add(3, 4)

// not followed by a call, so the library cannot decide yet:
// the SubstituteException is thrown later, on process.nextTick
calculator.received(2).add
```

<!-- docs-check: uses=calculator uncaught=SubstituteException -->
```typescript
calculator.add(1, 2)

// the parentheses are missing: reported later, on process.nextTick
calculator.didNotReceive().add
```

To avoid this, check methods with a call (`calculator.received(2).add(1, 2)`, or `.add(Arg.all())`). Those are decided right away.

The report is scheduled with the `process.nextTick` that the library found when it was loaded, so fake timers that are installed later, such as `jest.useFakeTimers()` in a test or `@sinonjs/fake-timers` faking `nextTick`, do not hold it back. Fake timers that replace `process.nextTick` before the library is loaded, for example jest's `fakeTimers: { enableGlobally: true }` configuration or a setup file that installs them before the library is imported, can delay the report until the fake clock runs.

# Names that conflict with the library
A substituted type may have members with the same names as the library's methods: `received`, `didNotReceive`, `returns`, `throws`, `resolves`, `rejects` or `mimicks`. Each of them has a symbol (exported from the package) that always means the library method. Members called `call`, `apply` or `bind` need care too, because every function has them; see [`call`, `apply` and `bind`](#call-apply-and-bind).

## In TypeScript
If the substituted type has a member with one of these names, `sub.received()` and `sub.didNotReceive()` are not offered, because they would be ambiguous. Use the symbols `sub[received]()` and `sub[didNotReceive]()`; they are always available.

In generic code, the type parameter's constraint decides. A type parameter without a constraint gets the string forms: `sub.received()` and `sub.didNotReceive()` are offered on `SubstituteOf<T>`, and the setup methods on calls that return `T`. For `T extends Account`, where `Account` has a member called `returns`, only the symbols are offered, as for `Account` itself.

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

At runtime, `.returns`, `.throws`, `.resolves`, `.rejects` and `.mimicks` on a member or call that is *not* configured always mean the setup methods. So if the code under test uses a member with one of these names on a value it gets from a substitute, configure that value first, as `shop.find('1')` above.

<!-- docs-check: name=generic-helpers -->
```typescript
import { Substitute, SubstituteOf, Arg } from '@fluffy-spoon/substitute'

interface Repository<T> {
  get(id: string): T
}

function stubGet<T>(repository: SubstituteOf<Repository<T>>, value: T) {
  repository.get(Arg.any()).returns(value)
}

function receivedOnce<T>(sub: SubstituteOf<T>) {
  return sub.received(1)
}
```

<!-- docs-check: uses=generic-helpers -->
```typescript
const users = Substitute.for<Repository<string>>()
stubGet(users, 'ann')
console.log(users.get('1')) // prints ann
receivedOnce(users).get('1')
```

`clearReceivedCalls`, `mimick` and `configure` exist only as symbols, so members with those names never conflict.

## In JavaScript
Without types, the library decides by how a name is used:

* `sub.received(...)` and `sub.didNotReceive()` are checks when they are called and followed by a member, like `sub.received(2).add(1, 2)`. Followed by `.returns()`, `.throws()`, `.resolves()`, `.rejects()` or `.mimicks()`, they configure a member of your own called `received` or `didNotReceive`.
* `sub.received` that is not called is an ordinary member, so the code under test can read a property called `received`.
* `sub.received(count)` or `sub.didNotReceive()` followed directly by a call checks a call of the substitute itself: `listener.received(1)('saved')` checks that the function substitute `listener` was called with `'saved'`. On a member, `sub.method.received(1)(5)` checks the calls `sub.method(5)`.
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

## call, apply and bind
Every function has `call`, `apply` and `bind`, and a substituted object can have members with these names of its own, like the `call(method, ...args)` of an RPC client or the `bind(port)` of a socket. On every substitute value that can be called (a substitute, a member like `sub.method`, the result of a call, a nested auto-substitute), `x.call`, `x.apply` and `x.bind` therefore give a helper that handles both meanings:

* If a setup for a member called `call`, `apply` or `bind` matches the arguments as they are, it answers. Such a setup comes from `x.call('getUser', 1).returns(user)`, from the `configure` view, or from a mimicked instance with such a member.
* Otherwise the helper works like the function's own `call`, `apply` and `bind`: it returns what `x(...arguments)` is configured to return, and a mimicked function or a `mimicks()` function gets the first argument as `this`.

Either way, the invocation is recorded once and counts in both meanings: as a call of the member (`x.received().call('getUser', 1)`) and as a direct call of `x` (`x[received]()(1)`, or `sub.received().method(1)` when `x` is `sub.method`). `String(sub)` and failure messages show it once, for example `rpc(1) via .call('getUser', 1)`. A setup written through `call`, `apply` or `bind` only configures the member: `client.rpc.call('getUser', 1).returns(user)` does not answer `client.rpc.call('deleteUser', 1)` or `client.rpc(1)`.

```js
const { Substitute, received } = require('@fluffy-spoon/substitute')

// an RPC client with a member called call
const client = Substitute.for()
client.rpc.call('getUser', 1).returns({ name: 'ann' })
console.log(client.rpc.call('getUser', 1)) // prints { name: 'ann' }
client.rpc.received(1).call('getUser', 1)
// the same invocation, read as rpc(1) with 'getUser' as this
client.received(1).rpc(1)

// a function substitute that a helper calls through apply()
const once = fn => {
  let done = false
  return function (...args) {
    if (!done) {
      done = true
      return fn.apply(this, args)
    }
  }
}
const listener = Substitute.for()
listener('saved').returns('ack')
console.log(once(listener)('saved')) // prints ack
listener[received](1)('saved')
```

* `x.bind(thisArg, ...arguments)` itself only counts as a call of a member called `bind`. Calling the function it returns is a direct call of `x`, with the bound arguments first. `.returns()` on the result of `x.bind(...)` configures the member `bind`.
* `x.apply(thisArg, value)` with a primitive `value` only has the member meaning, because a function's `apply` would throw.
* A member `call`, `apply` or `bind` configured as a property (`sub[configure]().call.returns(value)`) reads as that value. A substitute that mimicks an object without such a member reads it as `undefined`, like the object.
* In the `configure` view, `call`, `apply` and `bind` are ordinary members.

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

JavaScript, Node.js and test libraries read some members to find out what a value is. Unless you configure them, these read as `undefined` on every substitute and auto-substitute, and the reads are not recorded:

* `Symbol.iterator`, `Symbol.asyncIterator`, `Symbol.hasInstance`, `Symbol.isConcatSpreadable`, `Symbol.match`, `Symbol.matchAll`, `Symbol.replace`, `Symbol.search`, `Symbol.split`, `Symbol.species`, `Symbol.toStringTag` and `Symbol.unscopables`,
* `util.promisify.custom` (`Symbol.for('nodejs.util.promisify.custom')`),
* `asymmetricMatch`, which jest reads to find asymmetric matchers.

So `[].concat(sub)` keeps the substitute as one element, `value instanceof sub.SomeClass` is `false`, `'text'.startsWith(sub.prefix)` works, `util.promisify(sub.readFile)` calls the substitute (so a `mimicks()` setup that calls the callback works), `Object.prototype.toString.call(sub)` is `'[object Function]'`, and jest's `toEqual(sub)` and `toHaveBeenCalledWith(sub)` compare a substitute by identity, like any other function. A substitute is not iterable: `[...sub]`, `for...of`, `for await...of` and `Promise.all(sub)` throw a `TypeError`.

Unlike `then`, these members can be configured, through the `configure` view or by mimicking an instance that has them. The plain `sub[Symbol.iterator]().returns(...)` does not work, because the read gives `undefined`.

```js
const { Substitute, configure, mimick } = require('@fluffy-spoon/substitute')

const empty = Substitute.for()
console.log([].concat(empty).length) // prints 1
const spread = () => [...empty]
spread() // throws TypeError

const numbers = Substitute.for()
numbers[configure]()[Symbol.iterator]().mimicks(() => [1, 2][Symbol.iterator]())
console.log([...numbers]) // prints [ 1, 2 ]

const letters = Substitute.for()
letters[mimick](['a', 'b'])
console.log([...letters]) // prints [ 'a', 'b' ]

const tagged = Substitute.for()
tagged[configure]()[Symbol.toStringTag].returns('Tagged')
console.log(Object.prototype.toString.call(tagged)) // prints [object Tagged]
```

# Typing limitations
TypeScript cannot express a few things about substitutes:

* **Assigning a property on the substitute** (`calculator.isEnabled = true`) does not compile, because the property's type also carries the setup API (`.returns()` and so on). Assign through the interface type, as the code under test does, and check with `calculator.received().isEnabled = true`.
* **`null` and `undefined`** are not part of the type of a call or property under `strictNullChecks`, although `.returns(null)` is accepted. Assign the value to the declared type, or give explicit type arguments (`t.is<string | null>(repository.find(1), null)`).
* **A generic method called with explicit type arguments** (`store.get<number>('answer')`) has no setup API. Call it without type arguments.
* **Overloads whose parameters have literal types** (`on(event: 'data', ...)`) resolve to the interface's own declaration when you call them directly. Configure them with `sub[configure]().on('data', ...)`.
* **More than 8 overloads:** only the last 8 have the setup API.
* **A property typed `never`** cannot be configured. On a method that returns `never`, `.returns()` only accepts `never`; use `.throws()`.
* **Members typed only `null` or `undefined`** (`error?: undefined`, `ownerDocument: null`) keep their plain type and have no setup API. Configure them through `sub[configure]()`.
* **Generic code:** a property whose type is the type parameter itself (`current: T`, also `current?: T` or `T | undefined`) has no setup API; configure it with `sub[configure]().current.returns(value)`. Properties of types like `T[]` or `Promise<T>`, and calls that return `T`, are fine. The result of a call on the substitute (`box.get('a')`) is not assignable to `T` in generic code; read it through the plain interface type, or cast it.
* **A union of object types whose variants declare each other's members as `?: undefined`**, like `{ ok: true, data: string, error?: undefined } | { ok: false, data?: undefined, error: Error }`, turns `Substitute.for<...>()` into `never`. Substitute one variant (`Substitute.for<Ok>()`) instead. Other unions, such as `Cat | Dog`, work.
* **`Arg.all()` after other arguments** type-checks after up to 6 of them. It does not type-check with arguments after it (which is an error at runtime, too), after the last parameter of a fixed parameter list (`add(1, 2, Arg.all())`), or inside an object or array. Editors show the signatures that accept it with parameters named `arg0`, `arg1`, and so on.
* **`Arg.any('object')`** is typed `any`, like `Arg.any()`, so the compiler does not check it against the parameter. `Arg.any('function')` is typed as any function or class.
* **Optional properties of a type with a string index signature** do not accept `undefined` in a check (`sub.received().note = undefined`). Without an index signature, they do.
* **Nested auto-substitutes** are not typed as substitutes, see [Auto-substitutes](#auto-substitutes-and-nested-members).

<!-- docs-check: uses=calculator -->
```typescript
import { configure, SubstituteOf } from '@fluffy-spoon/substitute'

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

interface Box<T> {
  current: T
  items: T[]
  get(key: string): T
}
function stubBox<T>(box: SubstituteOf<Box<T>>, value: T) {
  box.get(Arg.any()).returns(value)
  box.items.returns([value])
  // @ts-expect-error a property typed as the type parameter itself has no setup API
  box.current.returns(value)
  box[configure]().current.returns(value)
}
const box = Substitute.for<Box<number>>()
stubBox(box, 7)
console.log(box.current) // prints 7
```

# Test runners
Checks throw a `SubstituteException`, so they work with any test runner: a failed check fails the test, and you can expect one with your runner's `throws` assertion. ava, jest, mocha, node:test and vitest (also with the package inlined through `server.deps.inline`) are tested on every change, including a check that [fails later](#assertions-that-fail-later), which each of them reports as a failure. Fake timers that a test installs do not hold back such a report; see [Assertions that fail later](#assertions-that-fail-later) for fake timers that are installed before the library is loaded.

Substitutes can be passed to your runner's own assertions: jest's `toEqual(sub)`, `toContainEqual(sub)` and `toHaveBeenCalledWith(sub)` compare substitutes by identity: a substitute only equals itself (see [Special members](#special-members)).

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

# Performance
Finding the setup and the auto-substitute for a call does not scan earlier calls, and takes about the same time whatever the shape of the arguments: nested objects, long arrays, `Buffer`s and typed arrays, long strings, `Map`s, `Set`s or `Date`s. Measured on Node.js 22, 10,000 calls with nested-object arguments take about 0.1 to 0.2 seconds, and so do 4,000 setups with object arguments plus 4,000 matching calls.

Each received call is kept until [`[clearReceivedCalls]()`](#clearing-received-calls), at about 300 bytes per call (measured on Node.js 22, 64-bit). A distinct unconfigured call also keeps its auto-substitute, about 200 bytes more, for as long as the substitute lives, so that the same call always returns the same auto-substitute; `[clearReceivedCalls]()` keeps those. Symbols passed as arguments are not kept alive by the library once the substitute is gone.

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
