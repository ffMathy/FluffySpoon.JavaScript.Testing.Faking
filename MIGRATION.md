# Migration guide
This guide covers upgrading to 2.0.1 from 1.x (1.208.0 and older) and from the 2.0.0 betas (2.0.0-beta.0 to 2.0.0-beta.4). 2.0.1 is the first stable release of version 2; there was no 2.0.0 release. The [README](README.md) describes the 2.x API, and the [changelog](CHANGELOG.md) lists every change.

Each section says which versions it applies to. Code marked "Before" is for the old version and is not valid 2.x code.

- [Installing: `latest` is now 2.x](#installing-latest-is-now-2x)
- [Requirements](#requirements)
- [Removed APIs](#removed-apis): [`Substitute.disableFor`](#substitutedisablefor), [`clearSubstitute` and `ClearType`](#clearsubstitute-and-cleartype), [string `mimick(instance)`](#the-string-mimickinstance)
- [Names that conflict with the library: the symbol API](#names-that-conflict-with-the-library-the-symbol-api)
- [Behaviour changes](#behaviour-changes): [sequences](#sequences-repeat-the-last-value), [auto-substitutes](#auto-substitutes-and-nested-checks), [matcher calls](#calls-with-argument-matchers-are-setups), [match order](#match-order), [re-configuring](#re-configuring-a-call), [what counts as a call](#what-counts-as-a-call), [checks](#checks-never-run-setups), [`received(count)`](#receivedcount-is-validated), [matchers](#matchers), [messages](#messages)
- [Imports and packaging](#imports-and-packaging)
- [TypeScript](#typescript)

The examples use this interface:

<!-- docs-check: name=migration-calculator -->
```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Calculator {
  add(a: number, b: number): number
  subtract(a: number, b: number): number
  isEnabled: boolean
}

const calculator = Substitute.for<Calculator>()
```

## Installing: `latest` is now 2.x
*Applies to: everyone.*

Up to 2.0.1, the npm `latest` tag pointed at 1.208.0, and the betas were published under `beta`. From 2.0.1 on, `latest` is version 2, so a plain `npm install @fluffy-spoon/substitute` (or a `"latest"` / `"*"` version range) now installs 2.x with the breaking changes below. A `^1` range in package.json (like `^1.208.0`) keeps you on 1.x. To stay on version 1 explicitly:

```sh
npm install @fluffy-spoon/substitute@1 --save-dev
```

Prereleases are still published under the `beta` tag.

## Requirements
*Applies to: everyone.*

* Node.js 10 or newer for CommonJS, and 12.17 or newer for the native ES module entry point.
* TypeScript 3.6 or newer. The 1.x README said TypeScript 3.0; 2.0.0-beta.4 needed 3.8.
* `strict` mode, including `strictNullChecks`, is supported. The 1.x README told you to turn `strictNullChecks` off; that is no longer needed.

## Removed APIs
### `Substitute.disableFor`
*Applies to: 1.x and the betas.*

`Substitute.disableFor(sub)` returned a view of the substitute in which `received`, `didNotReceive` and `mimick` were not the library's methods. It was used to call a member of your own with one of these names, for example in a test that wants to record such a call before checking it. It is gone, because it is no longer needed:

* A member of your own called `received` or `didNotReceive` is called as usual: `fake.received(1337)`.
* The library's checks have symbols that never conflict: `fake[received]()`, `fake[didNotReceive]()`.
* `mimick` is never the library's method any more (see below), so a member called `mimick` is an ordinary member.

Before:

<!-- docs-check: skip 1.x and 2.0.0-beta code -->
```typescript
const fake = Substitute.for<Example>()
Substitute.disableFor(fake).received(1337)
fake.received().received(1337)
```

After:

```typescript
import { Substitute, received } from '@fluffy-spoon/substitute'

class Example {
  received(someNumber: number) {
    return someNumber
  }
}

const fake = Substitute.for<Example>()
fake.received(1337) // the class' own method, like the code under test would call it
fake[received]().received(1337)

// configuring the member works, too
fake.received(1).returns(2)
console.log(fake.received(1)) // prints 2
```

In TypeScript, `fake.received()` is the class' own method here, so the string check is not offered for this type at all. In JavaScript, the library decides by how the name is used; see [Names that conflict with the library](README.md#names-that-conflict-with-the-library). If the code under test reads a member of what its own `received(...)` returns, configure that call with `.returns(...)`, so it returns your value instead of a substitute.

### `clearSubstitute` and `ClearType`
*Applies to: the betas.*

`sub.clearSubstitute(clearType?)` and the `ClearType` export were removed. What replaces them:

| Before | After |
|---|---|
| `sub.clearSubstitute(ClearType.receivedCalls)` or `sub.clearSubstitute('receivedCalls')` | `sub[clearReceivedCalls]()` |
| `sub.clearSubstitute(ClearType.substituteValues)` or `sub.clearSubstitute('substituteValues')` | create a new substitute |
| `sub.clearSubstitute()` / `sub.clearSubstitute(ClearType.all)` | create a new substitute |

`[clearReceivedCalls]()` forgets the received calls of the substitute and its auto-substitutes, and keeps every setup. There is no way to remove setups from a substitute: create the substitute in each test (for example in a `beforeEach` hook) instead of clearing a shared one.

Before:

<!-- docs-check: skip 2.0.0-beta code -->
```typescript
import { Substitute, ClearType } from '@fluffy-spoon/substitute'

calculator.add(1, 2)
calculator.clearSubstitute(ClearType.receivedCalls)
calculator.didNotReceive().add(1, 2)
```

After:

<!-- docs-check: uses=migration-calculator -->
```typescript
import { clearReceivedCalls } from '@fluffy-spoon/substitute'

calculator.add(1, 2).returns(3)
calculator.add(1, 2)
calculator[clearReceivedCalls]()
calculator.didNotReceive().add(1, 2)
console.log(calculator.add(1, 2)) // prints 3
```

TypeScript reports the old calls as errors. **In JavaScript they fail silently:** `sub.clearSubstitute()` and `sub.clearReceivedCalls()` are now ordinary member calls that clear nothing, and `ClearType` is `undefined`. Search your tests for `clearSubstitute`, `clearReceivedCalls(` and `ClearType`.

### The string `mimick(instance)`
*Applies to: 1.x and the betas.*

`sub.mimick(instance)` was typed, but did nothing in 1.x and threw "Mimick is not implemented yet" in 2.0.0-beta.4. It is replaced by the symbol `sub[mimick](instance)`, which works: everything that is not configured is handed to the instance, and the calls are still recorded. The string `mimick` is now an ordinary member.

Before:

<!-- docs-check: skip 1.x and 2.0.0-beta code -->
```typescript
calculator.mimick(new RealCalculator())
```

After:

<!-- docs-check: uses=migration-calculator -->
```typescript
import { mimick } from '@fluffy-spoon/substitute'

class RealCalculator implements Calculator {
  isEnabled = true
  add(a: number, b: number) { return a + b }
  subtract(a: number, b: number) { return a - b }
}

calculator[mimick](new RealCalculator())
console.log(calculator.add(2, 3)) // prints 5
calculator.received().add(2, 3)
```

To configure members of a mimicked substitute, use [`sub[configure]()`](README.md#re-configuring-a-call-configure).

## Names that conflict with the library: the symbol API
*Applies to: 1.x and the betas (the symbols are new in 2.0.1).*

The package exports symbols for its methods: `received`, `didNotReceive`, `clearReceivedCalls`, `mimick`, `configure`, `returns`, `throws`, `resolves`, `rejects` and `mimicks`. They always mean the library's method, so they are the way to handle members with the same names as the library's methods.

* `clearReceivedCalls`, `mimick` and `configure` exist **only** as symbols.
* In TypeScript, if a type has a member called `received`, `didNotReceive`, `returns`, `throws`, `resolves`, `rejects` or `mimicks`, its substitute offers only `sub[received]()` and `sub[didNotReceive]()`. Code that used the string forms on such a type no longer compiles.
* `.returns()`, `.throws()`, `.mimicks()`, `.resolves()` and `.rejects()` are not offered on a value that has its own member with that name. Use `[returns]` and so on there. (In 2.0.0-beta.4, a member called `returns` on the substituted interface removed `.returns()` from all of its properties; that is fixed.)

<!-- docs-check: uses=migration-calculator -->
```typescript
import { received, didNotReceive, returns } from '@fluffy-spoon/substitute'

calculator.add(1, 2)[returns](3)
console.log(calculator.add(1, 2)) // prints 3
calculator[received](1).add(1, 2)
calculator[didNotReceive]().subtract(Arg.all())
```

## Behaviour changes
### Sequences repeat the last value
*Applies to: 1.x.*

`returns(a, b, c)` returns `a`, `b` and `c`, and then keeps returning `c`. In 1.x, the calls after the sequence returned `undefined`. The same applies to `throws`, `resolves`, `rejects` and `mimicks` with several values.

<!-- docs-check: uses=migration-calculator -->
```typescript
calculator.add(1, 2).returns(3, 7, 9)
console.log(calculator.add(1, 2)) // prints 3
console.log(calculator.add(1, 2)) // prints 7
console.log(calculator.add(1, 2)) // prints 9
console.log(calculator.add(1, 2)) // prints 9
```

If a test relied on `undefined` after the sequence, add it to the sequence where the type allows it (`returns(3, 7, 9, undefined)`).

### Auto-substitutes and nested checks
*Applies to: 1.x and the betas.*

A member or call that is not configured returns an auto-substitute. (The 1.x README said such calls return `undefined`; they returned a proxy in every version.) What is new:

* The same member, or the same method with equal arguments, always returns the same auto-substitute, so nested setups work: `app.getCalculator().add(1, 2).returns(99)`.
* **Nested checks really check.** In 1.x and the betas, `app.logger.received().info('hi')` passed whatever had been called. Now it fails when `info('hi')` was not called on `app.logger`. Tests that passed only because of this now fail.
* Setups and calls on the substitute never leak into nested members with the same name, or the other way round.

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const app = Substitute.for()
app.logger.info('hi')

app.logger.received().info('hi')
app.logger.received().info('bye') // throws SubstituteException
```

In TypeScript, nested auto-substitutes are not typed as substitutes; see the [README](README.md#auto-substitutes-and-nested-members) for the typed alternative.

### Calls with argument matchers are setups
*Applies to: 1.x and the betas.*

A call with an `Arg.any()`, `Arg.is()` or `Arg.all()` matcher (or their `.not` forms) is always a setup or a check. It is never recorded as a received call, and it never runs an existing setup. Before, `calculator.add(Arg.all()).returns(10)` after `calculator.add(1, 3).returns(1337)` ran the first setup, and failed with `TypeError: ... returns is not a function`. A bare `calculator.add(Arg.any(), 2)` statement was counted as a call.

<!-- docs-check: uses=migration-calculator -->
```typescript
calculator.add(1, 3).returns(1337)
calculator.add(Arg.all()).returns(10)
console.log(calculator.add(1, 3)) // prints 1337
console.log(calculator.add(5, 2)) // prints 10

calculator.subtract(Arg.any(), 2)
calculator.didNotReceive().subtract(Arg.all())
```

### Match order
*Applies to: 1.x and the betas.*

The README used to say that the first matching setup wins. Now the most specific setup wins: literal arguments, then matchers, then `Arg.all()` alone. Among setups of the same kind, the most recent one wins, so configuring the same call again overrides it. See [Match order](README.md#match-order).

<!-- docs-check: uses=migration-calculator -->
```typescript
calculator.add(Arg.any(), Arg.any()).returns(1)
calculator.add(Arg.is(a => a > 10), Arg.any()).returns(2)
console.log(calculator.add(20, 0)) // prints 2
console.log(calculator.add(5, 0)) // prints 1
```

### Re-configuring a call
*Applies to: 1.x and the betas.*

A call whose literal arguments match an existing setup returns the configured value, so `calculator.add(1, 2).returns(5)` after `calculator.add(1, 2).returns(4)` fails (a number has no `.returns`). Use the new `sub[configure]()` view, in which every call is a setup:

<!-- docs-check: uses=migration-calculator -->
```typescript
import { configure } from '@fluffy-spoon/substitute'

calculator.add(1, 2).returns(4)
calculator[configure]().add(1, 2).returns(5)
console.log(calculator.add(1, 2)) // prints 5

calculator.add(Arg.all()).returns(10)
calculator[configure]().add(1, 3).returns(1337)
console.log(calculator.add(1, 3)) // prints 1337
```

### What counts as a call
*Applies to: 1.x and the betas.*

* Reading a method without calling it is not a call. Before, merely reading a method (for example to register it as an event handler) satisfied `received().method(...)`.
* `.call()`, `.apply()` and `.bind()` on a method return the configured value and are recorded like a direct call. Before, `.call()` and `.apply()` returned a proxy.
* Every call through a stored or destructured reference, or a callback, is recorded. In the betas, each such call overwrote the previous one (1.x was not affected).

<!-- docs-check: uses=migration-calculator -->
```typescript
const { add } = calculator
add(1, 1)
add(2, 2)
calculator.received(2).add(Arg.all())

const handler = calculator.subtract
calculator.received().subtract(Arg.all()) // throws SubstituteException
```

### Checks never run setups
*Applies to: the betas.*

`received()` and `didNotReceive()` never run setups or mimicked implementations, and are never recorded. In the betas, checking a property ran its setup: it threw the configured error, used up a value of a `returns()` sequence, ran the `mimicks()` function again, or left an unhandled rejection behind.

<!-- docs-check: uses=migration-calculator -->
```typescript
calculator.isEnabled.returns(true, false)
console.log(calculator.isEnabled) // prints true
calculator.received(1).isEnabled
console.log(calculator.isEnabled) // prints false
```

### `received(count)` is validated
*Applies to: 1.x and the betas.*

The count must be a non-negative integer, or left out for "1 or more". Anything else throws a `SubstituteException` that says so. Invalid counts failed before, too, but with a different error: a plain `Error` in 2.0.0-beta.4, a call count mismatch in 1.x. `received(0)` is the same as `didNotReceive()`.

<!-- docs-check: uses=migration-calculator -->
```typescript
calculator.received(0).add(1, 2)
calculator.received(1.5).add(1, 2) // throws SubstituteException: Expected count has to be a non-negative integer
```

### Matchers
*Applies to: 1.x and the betas.*

* `Arg.all()` after other arguments matches the rest of the arguments, and the arguments before it must match. Before, it made the whole call match anything. Arguments after `Arg.all()` throw a `SubstituteException`.
* `Arg.any('object')` no longer matches `null`, and now matches substitutes. `Arg.any('function')` matches substitutes, and `Arg.any('array')` uses `Array.isArray`.
* `Arg.is()` with something other than a function throws a `TypeError` right away. A predicate that throws counts as a non-match instead of crashing the code under test.
* Substitutes passed as arguments are compared by identity, and are never compared or printed member by member. In the betas, a failed check overflowed the stack when substitutes referred to each other through their arguments.

### Messages
*Applies to: 1.x and the betas.*

The wording of `SubstituteException` messages changed, for example "Expected to receive 2 method calls matching add(1, 2), but received 1.", followed by the calls that were received (at most 50). Tests that compare message texts need updating. Messages contain ANSI colours only when the output is a terminal (`NO_COLOR`, `NODE_DISABLE_COLORS`, `TERM=dumb` and `FORCE_COLOR` are honoured). In the betas, messages always contained them; 1.x messages had no colours.

`SubstituteException` is now exported from the package root: `import { SubstituteException } from '@fluffy-spoon/substitute'`.

## Imports and packaging
*Applies to: 1.x and the betas.*

**The ES module default import works.** Under native ES modules, `import Substitute from '@fluffy-spoon/substitute'` used to give the CommonJS module object, so `Substitute.for` was not a function. It is now the `Substitute` class. Named imports work as before, and ES modules and CommonJS share one copy of the library.

<!-- docs-check: esm -->
```js
import Substitute, { Arg } from '@fluffy-spoon/substitute'

const calculator = Substitute.for()
calculator.add(Arg.any(), 2).returns(3)
console.log(calculator.add(1, 2)) // prints 3
```

**Deep imports moved.** package.json now has an `exports` map. The public entry point is the package root; import everything from there:

| Before | After |
|---|---|
| `@fluffy-spoon/substitute/dist/Substitute` (`Substitute`, `SubstituteOf`) | `@fluffy-spoon/substitute` |
| `@fluffy-spoon/substitute/dist/Arguments` (`Arg`) | `@fluffy-spoon/substitute` |
| `@fluffy-spoon/substitute/dist/SubstituteException` (betas), `.../dist/SubstituteBase` (1.x) | `import { SubstituteException } from '@fluffy-spoon/substitute'` |
| `@fluffy-spoon/substitute/dist/Transformations` (`ObjectSubstitute`, ...) | `SubstituteOf<T>` from `@fluffy-spoon/substitute` |

<!-- docs-check: uses=migration-calculator -->
```typescript
import { SubstituteOf, SubstituteException } from '@fluffy-spoon/substitute'

const asSubstitute: SubstituteOf<Calculator> = calculator
try {
  asSubstitute.received().add(1, 2)
} catch (error) {
  console.log(error instanceof SubstituteException) // prints true
}
```

The compiled files now live under `dist/api`, `dist/internals` and `dist/shared`. They can still be imported as `@fluffy-spoon/substitute/dist/<path>` (with or without `.js`), but they are not public API and can change in any release. Directory imports such as `@fluffy-spoon/substitute/dist/api` no longer resolve on Node.js versions that read `exports`.

## TypeScript
*Applies to: 1.x and the betas.*

The typings were reworked. Most code compiles unchanged, but:

* The [symbol rules](#names-that-conflict-with-the-library-the-symbol-api) above: string checks are not offered on types with conflicting member names, and `mimick(instance)` is symbol only.
* The symbol API is available on every substitute, also on `SubstituteOf<T>` for a generic `T` (in the betas, generic helpers could not call `received()`).
* A member called `then` is typed `never`: substitutes are never thenables.
* Now supported: `mimicks()` on methods that return a union (including `boolean`), optional members, named members next to an index signature, overloads without parameters, up to 8 overloads, `(...args: unknown[])` methods, and `.throws()` on methods that return `never`.
* See [Typing limitations](README.md#typing-limitations) for what TypeScript cannot express.
