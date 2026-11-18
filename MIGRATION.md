# Migration guide
This guide covers upgrading to 2.0.1 from 1.x (1.208.0 and older) and from the 2.0.0 betas (2.0.0-beta.0 to 2.0.0-beta.4). 2.0.1 is the first stable release of version 2; there was no 2.0.0 release. The [README](README.md) describes the 2.x API, and the [changelog](CHANGELOG.md) lists every change.

Each section says which versions it applies to. Code marked "Before" is for the old version and is not valid 2.x code.

- [Installing: `latest` is now 2.x](#installing-latest-is-now-2x)
- [Requirements](#requirements)
- [Removed APIs](#removed-apis): [`Substitute.disableFor`](#substitutedisablefor), [`clearSubstitute` and `ClearType`](#clearsubstitute-and-cleartype), [string `mimick(instance)`](#the-string-mimickinstance)
- [Names that conflict with the library: the symbol API](#names-that-conflict-with-the-library-the-symbol-api)
- [Behaviour changes](#behaviour-changes): [sequences](#sequences-repeat-the-last-value), [auto-substitutes](#auto-substitutes-and-nested-checks), [matcher calls](#calls-with-argument-matchers-are-setups), [match order](#match-order), [re-configuring](#re-configuring-a-call), [what counts as a call](#what-counts-as-a-call), [`new`](#new-is-a-call), [checks](#checks-never-run-setups), [`received(count)`](#receivedcount-is-validated), [checks that fail later](#checks-that-fail-later), [matchers](#matchers), [argument comparison](#how-arguments-are-compared), [omitted arguments](#omitted-arguments), [`this` in `mimicks()`](#this-in-mimicks), [protocol members](#protocol-members-read-as-undefined), [freezing and `in`](#freezing-defined-properties-and-in), [messages](#messages), [printing](#printing)
- [Spy assertions of jest and sinon-chai](#spy-assertions-of-jest-and-sinon-chai) (also for tests that move from `jest.fn()` or sinon spies to substitutes)
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

* Node.js 10 or newer for CommonJS (`require`).
* For the native ES module entry point (`import`): Node.js 12.17 or newer on 12.x, 13.7 or newer on 13.x, or 14 or newer. On 13.2 to 13.6, `import` gets the CommonJS entry and named imports fail; use `require` there.
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
* `.returns()`, `.throws()`, `.mimicks()`, `.resolves()` and `.rejects()` are not offered on a value that has its own member with that name. Use `[returns]` and so on there.
* **In JavaScript, a string check of a member called `returns`, `throws`, `resolves`, `rejects` or `mimicks` is now a setup, and passes silently.** In 1.x and the betas, `sub.received(1).returns(5)` was a check of a member called `returns`. Now `sub.received(1)` followed by `.returns(...)` configures a member of your own called `received` (see [Names that conflict with the library](README.md#in-javascript)). Search your tests for `received(...).returns(`, `.throws(`, `.resolves(`, `.rejects(` and `.mimicks(`, and use the symbol: `sub[received](1).returns(5)`.
* In generic code, the type parameter's constraint decides: an unconstrained `SubstituteOf<T>` offers `sub.received()` and `sub.didNotReceive()`, as in 2.0.0-beta.4, while for `T extends Account`, where `Account` has a member with one of these names, only the symbols are offered.

<!-- docs-check: uses=migration-calculator -->
```typescript
import { received, didNotReceive, returns } from '@fluffy-spoon/substitute'

calculator.add(1, 2)[returns](3)
console.log(calculator.add(1, 2)) // prints 3
calculator[received](1).add(1, 2)
calculator[didNotReceive]().subtract(Arg.all())
```

`call`, `apply` and `bind` on a substitute value now mean both the function's own method and a member of your own with that name; see [What counts as a call](#what-counts-as-a-call).

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

This also holds for matchers inside plain objects and arrays, which are new: `repository.save({ id: Arg.any(), name: 'bob' }).returns('saved')` is a setup, and it matches `save({ id: 1, name: 'bob' })`. Before, a matcher inside an object was compared as a value, so such a call was a received call and never matched anything. Matchers inside class instances, `Map`s and `Set`s are still compared as values, and so are matchers beyond the limits that keep large arguments fast (for example in an array or object with more than 1,024 items or keys, more than 32 levels deep, or after the first 32,768 items and keys of an argument), and matchers put into an array or object with more than 256 items or keys after it was first passed. See [Matchers inside objects and arrays](README.md#matchers-inside-objects-and-arrays).

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

A call whose literal arguments match an existing setup returns the configured value, so `calculator.add(1, 2).returns(5)` after `calculator.add(1, 2).returns(4)` fails (a number has no `.returns`). If the configured value is a substitute, `.returns(5)` is silently recorded as a call of that substitute's member `returns`, and nothing is configured. Use the new `sub[configure]()` view, in which every call is a setup:

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
* `.call()`, `.apply()` and `.bind()` on a method, a function substitute, the result of a call or a nested member return the configured value and count as a direct call, and a mimicked function or a `mimicks()` function gets their first argument as `this`. Before, they returned a proxy (in 1.x, `.bind()` on a method already worked). They also count as a call of a member called `call`, `apply` or `bind`, and a setup such as `client.rpc.call('getUser', 1).returns(user)` configures that member. See [`call`, `apply` and `bind`](README.md#call-apply-and-bind).
* Every call through a stored or destructured reference, or a callback, is recorded. In the betas, each such call overwrote the previous one (1.x was not affected).
* The reads and calls that lead up to a setup or a check in the same expression, like `app.getCalculator()` in `app.getCalculator().add(1, 2).returns(99)`, are not recorded, also when `getCalculator()` is configured to return a substitute (but not when it returns the substitute it is called on, as a fluent `return this` does). Before, they were received calls, so `app.didNotReceive().getCalculator()` failed after that setup. Calls that the code under test made are kept, also calls through a method that the test handed to it (`new UserService(api.getUser)`, also when the code under test invokes it with the substitute as `this`, as in `Reflect.apply(fetch, api, [id])`) and calls from a promise job (`Promise.resolve(id).then(getUser)`): see [Which calls lead to a setup or a check](README.md#which-calls-lead-to-a-setup-or-a-check) for how the library tells them apart.

<!-- docs-check: uses=migration-calculator -->
```typescript
const { add } = calculator
add(1, 1)
add(2, 2)
calculator.received(2).add(Arg.all())

const handler = calculator.subtract
calculator.received().subtract(Arg.all()) // throws SubstituteException
```

### `new` is a call
*Applies to: 1.x and the betas.*

`new` on a substitute or on a member of it (`new sdk.Client('https://api')`, also through `Reflect.construct()`) is a call. It is recorded, setups written as calls answer it (`sdk.Client(Arg.any()).returns(client)`), and checks written as calls count it (`sdk.received(1).Client('https://api')`). Without a setup, or with a setup that returns a primitive, `new` returns the auto-substitute of that call. In 1.x, `new` on a substitute threw a `TypeError` (a proxy invariant about `prototype`). In the betas, it returned an object made from the library's internal function, whatever was configured, and only the read of the member was recorded. In TypeScript, setups and checks written as calls compile for constructor types and members, as in `Client('https://api').returns(client)` for `Substitute.for<new (baseUrl: string) => ApiClient>()`; see [Creating a substitute](README.md#creating-a-substitute).

A class can extend a substitute or a member of it (`class Plugin extends sdk.Base`): `new Plugin()` is recorded as a call `new Base()`, and gives an instance of `Plugin` with its methods. A class given to `mimicks()` or `[mimick]()` constructs it, with `Plugin` as `new.target`, and assignments in the constructor (`this.ready = true`) create real properties. In the betas, such an instance had `Plugin`'s methods, but the mimicked class did not run, and the assignments were not kept: `this.ready` read as a proxy (in 1.x, `new` threw). Such instances, and other objects whose prototype chain leads to a substitute, are ordinary objects: passed to a substitute, they are recorded and compared like other objects, and `JSON.stringify()`, `util.inspect()` and the printing of jest and vitest show their own fields. See [Classes that extend a substitute](README.md#classes-that-extend-a-substitute).

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

// the code under test
const connect = sdk => new sdk.Client({ baseUrl: 'https://api' })

const sdk = Substitute.for()
const client = { name: 'client' }
sdk.Client(Arg.any()).returns(client)
console.log(connect(sdk) === client) // prints true
sdk.received(1).Client({ baseUrl: 'https://api' })
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

### Checks that fail later
*Applies to: 1.x and the betas.*

`sub.didNotReceive().member` or `sub.received(0).member` without parentheses, on a member that was called as a method, passed silently before. Now its failure is reported later, from a microtask, because the parentheses were probably forgotten: `Expected to receive 0 property reads or method calls matching add, but received 1 method call. add was called 1 time as a method; to assert calls, invoke it: sub.didNotReceive().add(...)`. Add the call: `sub.didNotReceive().add(1, 2)`, or `.add(Arg.all())`. See [Assertions that fail later](README.md#assertions-that-fail-later), which also lists how each test runner reports such a failure.

**A check that nothing follows is reported, too.** `next.didNotReceive()`, `res.received(2)` or `sub[didNotReceive]()` as a statement checks nothing; before, it passed silently. Now it is reported later, from a microtask, as `@Substitute.received(2) checked nothing: it was not followed by a call or a member. Complete the check: ...`. Complete it with a call or a member: `next.didNotReceive()(Arg.all())` checks the calls of the function substitute `next` itself, `res.received(2).send(Arg.all())` the calls of a member. A string-form call that is most likely a member of your own (configured, answered by a mimicked instance, or with arguments that a check cannot have) is not reported; see [received and didNotReceive](README.md#received-and-didnotreceive) and [Names that conflict with the library](README.md#in-javascript). Each such check is reported, also when the same check is made again and completed later in the same synchronous code, and a matcher that throws its `TypeError` for invalid use in the check's own call (`listener.received(1)(Arg.any('String'))`) leaves only that `TypeError`.

<!-- docs-check: uncaught=SubstituteException -->
```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

// a middleware that should not call next()
const next = Substitute.for()
next.didNotReceive()(Arg.all()) // complete: checks the calls of next itself
next.didNotReceive() // checks nothing: reported later, from a microtask
```

Checks that fail later (these two, and a property-style `sub.received(2).member` on a member that was called as a method) are reported with the `queueMicrotask` that the library found when it was loaded (`process.nextTick` on Node.js 10), so fake timers installed later in a test do not hold them back. 2.0.0-beta.4 reported a failing property-style check on `process.nextTick`, and an exception thrown from `process.nextTick` crashes jest instead of failing the test. Now jest reports it as the failure of the running test (jest 30 on Node.js 22: as a failure of the test file). mocha and ava cannot tie such a failure to the test: mocha stops the run after that test, so the tests after it do not run, and ava ends the worker of that test file, so its unfinished tests are not reported. Every runner fails the run, though.

### Matchers
*Applies to: 1.x and the betas.*

* `Arg.all()` after other arguments matches the rest of the arguments, and the arguments before it must match. Before, it made the whole call match anything. Arguments after `Arg.all()` throw a `SubstituteException`.
* `Arg.any('object')` no longer matches `null`, and now matches substitutes. `Arg.any('function')` matches substitutes, and `Arg.any('array')` uses `Array.isArray`.
* `Arg.is()` with something other than a function throws a `TypeError` right away. A predicate that throws counts as a non-match instead of crashing the code under test.
* Substitutes passed as arguments are compared by identity, and are never compared or printed member by member. In the betas, a failed check overflowed the stack when substitutes referred to each other through their arguments.
* **JavaScript:** `Arg.any(type)` and `Arg.any.not(type)` throw a `TypeError` right away for a type name that they do not know, such as a typo (`'strnig'`) or another case (`'String'`). Before, `Arg.any('strnig')` silently matched nothing, and `Arg.any.not('strnig')` matched every value. `'bigint'` is a documented type name now (it already matched `bigint` values).
* **JavaScript:** a matcher function passed without calling it, as a direct argument of a setup or a check (`repo.find(Arg.any).returns(user)`, `repo.didNotReceive().delete(Arg.any)`), throws a `SubstituteException`: `Arg.any was passed as an argument without calling it, so it would only match the function Arg.any itself. Did you mean Arg.any()?` (and likewise for `Arg.any.not`, `Arg.is`, `Arg.is.not` and `Arg.all`). Before, such a setup never answered, and such a `didNotReceive()` check always passed.
* An `Arg.is()` predicate that returns a promise or another thenable (an `async` predicate) throws a `TypeError` where it is evaluated, and its promise is handled. Before, the promise counted as a match, whatever it resolved to.
* **JavaScript:** `mimicks()` with something other than a function (or with nothing) throws a `TypeError` at the setup, and the message names the member. Before, the setup was accepted, and the call failed later, in the code under test (`TypeError: substitutionValue is not a function`; in 1.x, `mockValue.apply is not a function`).

### How arguments are compared
*Applies to: 1.x and the betas.*

Literal arguments are compared with deep strict equality (`util.isDeepStrictEqual`), as before: own enumerable properties and prototypes. `#private` fields and other internal state are invisible to it, so all instances of a class that keeps its state only in `#private` fields are equal to each other. Use the same instance, or `Arg.is()`, for such classes (see [How arguments are compared](README.md#how-arguments-are-compared)).

What changed: an argument object that you change after using it in a setup only matches that setup when the same object is passed again. Before, a new object equal to the changed one matched as well. Create the setup with the object as the code under test will pass it, or with a matcher. Objects that change after they were passed in a call that is not a setup are not affected: the library remembers the hash of a large object (with more than 256 keys or entries) from the first time it is passed, but that does not change which setup it matches, so such an object still matches a setup made with an equal object, before or after the change (see [How arguments are compared](README.md#how-arguments-are-compared)). Whether a new array or object around an argument object that changed after the setup matches the setup is not specified.

<!-- docs-check: uses=migration-calculator -->
```typescript
interface Repository {
  save(user: { name: string }): string
}

const repository = Substitute.for<Repository>()
const user = { name: 'ann' }
repository.save(user).returns('saved')
user.name = 'bob'

console.log(repository.save(user)) // prints saved
console.log(repository.save({ name: 'bob' }) === 'saved') // prints false
```

### Omitted arguments
*Applies to: the betas. 1.x compared omitted arguments in the same way.*

An argument that a call leaves out at the end counts as `undefined`: it matches a literal `undefined` and matchers that accept `undefined`, such as `Arg.any()` and `Arg.any('undefined')`, and `f(1)` and `f(1, undefined)` are the same call. In the betas, an omitted argument matched nothing, so `f(1)` and `f(1, undefined)` were different calls. See [How arguments are compared](README.md#how-arguments-are-compared). So:

* `users.find(Arg.any('undefined')).returns(...)` and `users.find(Arg.any()).returns(...)` now answer `users.find()`, and `received(1).find(Arg.any())` counts it.
* **`didNotReceive().f(Arg.any())` now fails after `f()`**, and `received(count).log(Arg.any(), Arg.all())` counts `log()` as well.
* A matcher setup that accepts `undefined` now answers calls with fewer arguments, and it is more specific than `Arg.all()`: after `add(Arg.any(), Arg.any()).returns('p')` and `add(Arg.all()).returns('w')`, `add(5)` returns `'p'`.
* **A literal setup after a matcher setup that already answers it needs `configure` now:** after `calculator.multiply(1, Arg.any()).returns(10)`, `calculator.multiply(1).returns(1)` throws `TypeError: calculator.multiply(...).returns is not a function`, because `multiply(1)` returns 10. Write `calculator[configure]().multiply(1).returns(1)`, or make the literal setup first. In the same way, `f(undefined).returns(a)` followed by `f().returns(b)` configures one call twice.
* Only the arguments themselves count: inside arrays and objects, deep strict equality still applies, so `[1]` and `[1, undefined]` are different.

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const logger = Substitute.for()
logger.log('started')

logger.received(1).log('started', undefined)
logger.received(1).log('started', Arg.any())
logger.didNotReceive().log('started', Arg.any()) // throws SubstituteException
```

### `this` in `mimicks()`
*Applies to: 1.x and the betas.*

A `mimicks()` function is called with the `this` of the call, like a method: the substitute for `sub.method(...)`, the first argument of `.call()` and `.apply()`, and `undefined` for a property read. Before, it was `undefined` (in 2.0.0-beta.4) or the library's own proxy (in 1.x). An implementation that relied on that, or that needs a `this` of its own, should be an arrow function or a bound method.

### Protocol members read as `undefined`
*Applies to: 1.x and the betas.*

`Symbol.iterator`, `Symbol.asyncIterator`, `Symbol.hasInstance`, `Symbol.isConcatSpreadable`, `Symbol.match`, `Symbol.matchAll`, `Symbol.replace`, `Symbol.search`, `Symbol.split`, `Symbol.species`, `Symbol.toStringTag`, `Symbol.unscopables`, `util.promisify.custom`, `asymmetricMatch`, `_isMockFunction`, `calledWithExactly` and `handleEvent` read as `undefined` on a substitute unless they are configured, and the reads are not recorded (see [Special members](README.md#special-members)). Before, they returned auto-substitutes. So:

* `[].concat(sub)` keeps the substitute as one element (it was dropped), `value instanceof sub.SomeClass` is `false` (it was `true`), `'text'.startsWith(sub.prefix)` no longer throws, and `util.promisify(sub.readFile)` calls the substitute, on every supported Node.js version (the running Node.js' own `util.promisify.custom` is handled too; on Node.js 10.0 to 12.16.1 and 13.0 to 13.11 it is not `Symbol.for('nodejs.util.promisify.custom')`).
* jest and vitest no longer take a substitute for a mock function when they print it. Before, jest snapshots showed a substitute as a mock function, such as `[MockFunction method<getMockName>: ()]` (2.0.0-beta.4) or `[MockFunction [class SubstituteJS] -> getMockName]` (1.x). Now they show `[Function]`, so snapshots written before need updating. See [Printing a substitute](README.md#printing-a-substitute).
* happy-dom calls a function substitute added with `addEventListener()` itself, as Node.js and jsdom do, so the events are recorded as calls of the substitute (`onClick.received(1)(Arg.any())`). Before, happy-dom called its auto-substitute `handleEvent` instead. Code under test that calls `handleEvent` of a substitute itself now needs it configured or mimicked; see [Substitutes are functions](README.md#substitutes-are-functions).
* sinon-chai no longer takes a substitute for a sinon spy: its assertions throw `TypeError: [Function @Substitute.name] is not a spy or a call to a spy!` for a substitute. Before, `expect(next).to.have.been.called`, `.calledOnce` and `.calledWith('x')` passed on a substitute that was never called. See [Spy assertions of jest and sinon-chai](#spy-assertions-of-jest-and-sinon-chai).
* jest no longer takes a substitute for an asymmetric matcher. Before, `expect(fn).toHaveBeenCalledWith(sub)` and `expect(list).toContainEqual(sub)` passed whatever the arguments or items were, and a failing `expect(value).toEqual(sub)` threw jest's internal "Unexpected return from a matcher function" error. Now they compare the substitute by identity, so tests that passed only because of this fail.
* **A substitute is not iterable.** `[...sub]`, `for...of`, `for await...of` and `Promise.all(sub)` on a substitute that is not configured throw a `TypeError`. In the betas they treated it as empty; in 1.x they threw a different `TypeError`. Configure the iterator, or mimick an array:

```js
const { Substitute, configure, mimick } = require('@fluffy-spoon/substitute')

const items = Substitute.for()
items[configure]()[Symbol.iterator]().mimicks(() => ['a', 'b'][Symbol.iterator]())
console.log([...items]) // prints [ 'a', 'b' ]

const list = Substitute.for()
list[mimick](['a', 'b'])
console.log(list.length) // prints 2
```

`__esModule` is not among these members: it reads as an auto-substitute, as before. So a substitute that stands in for a whole module, for example one that a `jest.mock()` factory returns, still counts as an ES module for code compiled by TypeScript or Babel. Namespace and named imports reach its members, and the default import (`import mailer from './mailer'`) is the auto-substitute `mailer.default`, as with 2.0.0-beta.4. To make the default import the substitute itself, return it as the default export of a plain object: `jest.mock('./mailer', () => ({ __esModule: true, default: Substitute.for() }))`.

A substitute is a function without the own keys of a module, in every version, so it cannot stand in for a module where a tool copies the module's own keys or wants an object: a module that a barrel re-exports (`export * from './mailer'`), vitest's `vi.mock()`, node:test's `mock.module()`, jest's `unstable_mockModule()` for native ES modules, and code compiled by esbuild. Return a plain object of the substitute's members there, with the substitute as the default export: `{ __esModule: true, default: mailer, send: mailer.send }`. Calls through these members are calls of the substitute's members, so `mailer.send('ann').returns('ok')` and `mailer.received(1).send('ann')` work on them. See [Mocking a whole module](README.md#mocking-a-whole-module) for each runner.

### Freezing, defined properties and `in`
*Applies to: 1.x and the betas.*

* `Object.freeze()`, `Object.seal()` and `Object.preventExtensions()` work on a substitute and on an auto-substitute, and it keeps working afterwards. In the betas, the reads and setups after them threw a `TypeError` ("Cannot add property _child, object is not extensible"). In 1.x, reads, setups and checks kept working, except that reading `length` or `name` afterwards threw a `TypeError` (a proxy invariant error), as reading `prototype` always did.
* `Object.defineProperty(sub, key, descriptor)` defines a real property, which reads return without recording them. Before, it threw a `TypeError`.
* `Object.setPrototypeOf(sub, EventEmitter.prototype)`, for code under test that checks `instanceof`, keeps the substitute working: reads, calls, assignments, setups, checks, the symbols, `String()` and `JSON.stringify()` work as before. Only `util.inspect()` shows it as `[Function: bound substitute] EventEmitter` then, also where it is an argument in a failure message. In 2.0.0-beta.4, checks, assignments and `String(sub)` threw a `TypeError` afterwards, such as `target.isSpecialProperty is not a function`. On a frozen, sealed or non-extensible substitute, `Object.setPrototypeOf()` with another prototype throws a `TypeError` that names the substitute, `@Substitute is not extensible: its prototype cannot be changed after Object.freeze(), Object.seal() or Object.preventExtensions()` (2.0.0-beta.4: `function anonymous(...) is not extensible`), and so does `Reflect.setPrototypeOf()`, which returned `false` in 2.0.0-beta.4.
* A substitute has no enumerable own properties: `Object.keys(sub)` is empty, and `Reflect.ownKeys(sub)` is `[ 'length', 'name' ]`, the non-enumerable properties that every function has (`length` is `0`, and `name` is the member's name for a member, such as `'getKey'` for `keys.getKey`, and `''` for a substitute itself), unless it mimicks an object: then `Object.keys()`, `Object.entries()`, spread, `Object.assign()` and `for...in` see the instance's enumerable own keys, and `JSON.stringify(sub)` gives what `JSON.stringify(instance)` gives (see [Partial mocks](README.md#partial-mocks)). In the betas, `Object.keys(sub)` listed internal fields such as `_key` and `_recorder`, and in 1.x and the betas, `Reflect.ownKeys(sub)` listed `length`, `name` and `prototype` of the library's internal function, with its internal name. Reading `sub.name` or `sub.length` is a member read, as before. `util.callbackify(sub.method)` works, except for a substitute that was frozen, sealed or made non-extensible, which lists no `length` and `name`: wrap such a substitute in a function (`util.callbackify((...args) => frozen(...args))`). See [Freezing, defined properties and `in`](README.md#freezing-defined-properties-and-in).
* `key in sub` is `true` for a key with a setup, a key of a mimicked instance and a property defined with `Object.defineProperty()`, and `false` otherwise. Before, it answered for the library's internal function: `true` for `call`, `length` and the other members of functions, and `false` for configured members. Code under test that checks for an optional member with `in` now takes the branch that the test configured.

See [Freezing, defined properties and `in`](README.md#freezing-defined-properties-and-in).

### Messages
*Applies to: 1.x and the betas.*

The wording of `SubstituteException` messages changed, for example "Expected to receive 2 method calls matching add(1, 2), but received 1.", followed by the calls that were received (at most 50, and no more once the listed calls take 20,000 characters; a list that leaves some out ends with `› … and N more`). Each value in a message is printed within bounds, as described under [Printing](#printing). When the expected call and a received one that it does not match print alike because they differ deeper than two levels, as filters of an ORM often do, the message prints both deeper, up to four levels. A matcher in the expected call does not count as a difference there: it prints by its label, such as `Arg.any{string}` for a generated id, where the received call shows the value that it was given. Nor does an order of keys that differs, as in an object built as `{ ...input, id }`. Differences inside `Map`s, `Set`s and among the other keys of an array (such as the `total` of an array of rows) are found as well. Matchers in the expected call are shown by their own label at any depth (`save({ user: { profile: { name: Arg.is{name => name === 'bob'} } } })`). When the expected call and a received one print alike because the code under test passed another substitute, the message numbers the substitutes (`@Substitute#1`, `@Substitute#2`, ...), also those of another copy of the package, and says so in its last line. Tests that compare message texts need updating. When the kind of call is not known, messages say "property reads or method calls" instead of "property calls". A check of a member that was never used at all fails when it reads the member, so its message cannot name the expected arguments ("... matching add, but received none."); once the method has been called, the message names them. Messages contain ANSI colours only when the output is a terminal (`NO_COLOR`, `NODE_DISABLE_COLORS`, `TERM=dumb` and `FORCE_COLOR` are honoured). In the betas, messages always contained them; 1.x messages had no colours.

`SubstituteException` is now exported from the package root: `import { SubstituteException } from '@fluffy-spoon/substitute'`.

### Printing
*Applies to: 1.x and the betas.*

`String()`, template strings, `util.inspect()`, `console.log()` and `JSON.stringify()` of an auto-substitute give its path, such as `@Substitute.someProperty` or `@Substitute.getUser(1)`, followed by its received calls and setups, if it has any. Before, they gave a label such as `property<someProperty>: ` or `method<getUser>: (1)` (in 1.x, `[class SubstituteJS] -> someProperty`). The printout of a substitute now also lists the calls and setups of its auto-substitutes, under their paths (at most 50 calls and 50 setups of them). Errors show as `[Name: message]` without their stack, also inside objects and arrays, followed by their own properties and their cause (`[HttpError: not found] { status: 404 }`). Each value is printed within bounds: two levels deep, as `util.inspect()` shows it by default and as the betas printed it (`{ a: { b: { c: { d: 1 } } } }` prints as `{ a: { b: { c: [Object] } } }`), with the first 20 items of arrays, `Map`s and `Set`s and the first 20 keys of objects, and at most 1,000 characters; values that fit print as `util.inspect(value)` prints them, so small values print as in the betas. Like `util.inspect()`, the printout puts a value that is longer than 80 characters, or that holds more than three levels of objects, on several lines, also where it is the configured value of a setup (`findById('o1') => resolves({` followed by a line for each key). A substitute that configures or mimicks `toString()` or `valueOf()` gives their result when it is converted to a string, and a substitute that mimicks an object gives that object's JSON in `JSON.stringify()`; `util.inspect()` still shows the printout. Tests that compare such texts need updating, and so do names derived from them, such as the `jit_@Substitute.__anonymousType` that Angular's TestBed makes for a substitute (it was `jit_property<__anonymousType>: `). See [Printing a substitute](README.md#printing-a-substitute).

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const app = Substitute.for()
console.log(`${app.someProperty}`) // prints @Substitute.someProperty
console.log(JSON.stringify({ user: app.getUser(1) })) // prints {"user":"@Substitute.getUser(1)"}
```

## Spy assertions of jest and sinon-chai
*Applies to: everyone, and to tests that move from `jest.fn()`, `jest.spyOn()` or sinon spies to substitutes.*

**Check the calls of a substitute with `received()` and `didNotReceive()`, never with the spy assertions of jest or sinon-chai.** A substitute is neither a jest mock nor a sinon spy:

* jest takes every substitute for a Jasmine-style spy, because its `calls.all` and `calls.count` read as auto-substitutes, which are functions, and then reads the number of calls from `calls.count()`, which gives no number. So `expect(next).not.toHaveBeenCalled()`, `.not.toHaveBeenCalledTimes(1)`, `.not.toHaveBeenLastCalledWith(...)` and `.not.toHaveBeenNthCalledWith(...)` pass whatever `next` received, the forms without `.not` fail with messages such as `Received number of calls: [Function @Substitute.calls.count().name]`, and `toHaveBeenCalledWith()` fails with "Unexpected return from a matcher function". This is as with 2.0.0-beta.4, and it cannot change without breaking types with a member called `calls`. `jest.spyOn(sub, 'save')` gives the auto-substitute `sub.save`, which is no spy either, and `toHaveReturned()` and the other matchers for return values throw `received value must be a mock function`.
* sinon-chai's assertions (`.called`, `.calledOnce`, `.calledWith(...)`, also with `.not`) throw `TypeError: [Function @Substitute.name] is not a spy or a call to a spy!`, because `calledWithExactly` reads as `undefined` now (see [Protocol members read as `undefined`](#protocol-members-read-as-undefined)). With 2.0.0-beta.4, `expect(next).to.have.been.called`, `.calledOnce` and `.calledWith('x')` passed on a substitute that was never called, so tests that passed only because of this fail now.
* vitest's spy assertions throw the same `TypeError`.

| jest, or sinon-chai | Check |
|---|---|
| `expect(next).toHaveBeenCalled()`, `expect(next).to.have.been.called` | `next.received()(Arg.all())` |
| `expect(next).not.toHaveBeenCalled()`, `expect(next).not.to.have.been.called` | `next.didNotReceive()(Arg.all())` |
| `expect(next).toHaveBeenCalledTimes(2)`, `expect(next).to.have.been.calledTwice` | `next.received(2)(Arg.all())` |
| `expect(next).toHaveBeenCalledWith('a', 1)`, `expect(next).to.have.been.calledWithExactly('a', 1)` | `next.received()('a', 1)` |
| `expect(next).to.have.been.calledWith('a')` (the first arguments) | `next.received()('a', Arg.all())` |
| `expect(repository.save).toHaveBeenCalledWith(user)` | `repository.received().save(user)` |

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const next = Substitute.for()
// the code under test
next(new Error('boom'))

// Before: expect(next).toHaveBeenCalledWith(expect.any(Error)), or expect(next).to.have.been.calledWith(...)
next.received(1)(Arg.is(error => error instanceof Error && error.message === 'boom'))
// Before: expect(next).not.toHaveBeenCalled(), which passes on a substitute whatever it received
next.didNotReceive()(Arg.all()) // throws SubstituteException
```

See [Test runners](README.md#test-runners).

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

Bundles with CommonJS output that keep the package external are an exception: they `require()` the CommonJS entry, so their default import is the exports object, and `Substitute.for` is not a function. This applies to Rollup with `output.format: 'cjs'` and to the SSR builds of Vite 5 to 7 with CommonJS output, for any source, and to esbuild, webpack, Rolldown and Vite 8 with CommonJS output, for `.mjs` sources and sources in a `"type": "module"` package. Use the named import `import { Substitute, Arg } from '@fluffy-spoon/substitute'` there, which works everywhere. With Rollup, and Vite 5 to 7, `output.interop: 'auto'` also makes the default import work. The second exception is ts-node's ESM loader (`node --loader ts-node/esm`) with `module` and `moduleResolution` set to `node16` or `nodenext`: it type-checks the default import against the CommonJS typings and rejects `Substitute.for()`, so use the named import, tsx, or ts-node's `transpileOnly` there. See [Importing](README.md#importing).

**Bundled CommonJS `require()` with the package external.** 2.0.0-beta.4 and older had only a CommonJS entry. Now there is also an ES module entry, whose default export is the `Substitute` class. CommonJS code that `require()`s the package, bundled with Rollup's `@rollup/plugin-commonjs` while the package stays external (Vite 7 and older do this in SSR builds, which keep dependencies external by default), now gets that class from `require()`, so `Substitute`, `Arg` and the other named exports are `undefined`. Nothing throws at that point; the first use fails, for example with `TypeError: Cannot read properties of undefined (reading 'for')`. Set `commonjs({ esmExternals: true })` or `commonjs({ esmExternals: ['@fluffy-spoon/substitute'] })`, or bundle the package (in Vite: `ssr: { noExternal: ['@fluffy-spoon/substitute'] }`). Vite 8 and newer, and code that `import`s the package, are not affected by this. See [Importing](README.md#importing).

**Deep imports moved.** package.json now has an `exports` map. The public entry point is the package root; import everything from there. 1.x had its files under `dist/src/`, the betas directly under `dist/`:

| Before | After |
|---|---|
| `@fluffy-spoon/substitute/dist/src/Substitute` (1.x), `.../dist/Substitute` (betas): `Substitute`, `SubstituteOf` | `@fluffy-spoon/substitute` |
| `@fluffy-spoon/substitute/dist/src/Arguments` (1.x), `.../dist/Arguments` (betas): `Arg` | `@fluffy-spoon/substitute` |
| `@fluffy-spoon/substitute/dist/src/SubstituteBase` (1.x), `.../dist/SubstituteException` (betas): `SubstituteException` | `import { SubstituteException } from '@fluffy-spoon/substitute'` |
| `@fluffy-spoon/substitute/dist/src/Transformations` (1.x), `.../dist/Transformations` (betas): `ObjectSubstitute`, ... | `SubstituteOf<T>` from `@fluffy-spoon/substitute` |

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

The other files were internals and are gone without a replacement: in 1.x `dist/src/Context`, `dist/src/Utilities` and `dist/src/states/...`; in the betas `dist/SubstituteNode`, `dist/SubstituteNodeBase`, `dist/Recorder`, `dist/RecordsSet`, `dist/RecordedArguments`, `dist/Types` and `dist/Utilities` (`dist/utilities/...` in 2.0.0-beta.4). Development builds made from the repository after 2.0.0-beta.4 had them under `dist/internals/` (`dist/internals/SubstituteNode`, `dist/internals/Recorder`, `dist/internals/RecordsSet`, ...); those are gone, too.

The compiled files of 2.0.1 live under `dist/api`, `dist/internals` and `dist/shared`. They are not public API and can change in any release. They can be imported as `@fluffy-spoon/substitute/dist/<path>`, with or without `.js`, on Node.js 14.19 or newer on 14.x, 16.9 or newer on 16.x, any later version, and versions older than 12.17 (which ignore `exports`). On 12.17 to 12.19, 13.x and 14.0 to 14.12, deep imports fail; on 12.20 to 12.22, 14.13 to 14.18 and 16.0 to 16.8, only the form without `.js` works. Directory imports such as `@fluffy-spoon/substitute/dist/api` no longer resolve on Node.js versions that read `exports`.

**`require` works on every Node.js version from 10 on, and `import` needs 12.17 or newer on 12.x, 13.7 or newer on 13.x, or 14 or newer** (see [Requirements](#requirements)).

## TypeScript
*Applies to: 1.x and the betas.*

The typings were reworked. Most code compiles unchanged, but:

* The [symbol rules](#names-that-conflict-with-the-library-the-symbol-api) above: string checks are not offered on types with conflicting member names, and `mimick(instance)` is symbol only.
* The symbol API is available on every substitute, also on `SubstituteOf<T>` for a generic `T`. In generic code, the string forms `sub.received()` and `sub.didNotReceive()` are offered for a type parameter without a constraint, as in the betas. With a constraint, the constraint decides: if it has a member called `received`, `didNotReceive`, `returns`, `throws`, `resolves`, `rejects` or `mimicks`, only the symbols are offered. Calls and properties that return the type parameter keep `.returns()` and the other setup methods.
* With a constrained type parameter (`function stub<T extends Calculator>(sub: SubstituteOf<T>)`, or a fixture class `Fixture<T extends Calculator>` with `sub = Substitute.for<T>()`), setups, checks and the `configure` view work through the constraint: `sub.total.returns(1)`, `sub.add(1, 2).returns(3)`, `sub.received().total = 1` and `sub[configure]().add(1, 2).returns(3)` compile, and the values are checked against the constraint's member types. With 2.0.0-beta.4, only property setups and checks of calls compiled there. Keys that exist only through the constraint's string index signature (`T extends { [key: string]: number; port: number }`, `sub.timeout.returns(5)`) can be configured, too, with values of the index signature's type. The exceptions (see [Typing limitations](README.md#typing-limitations)):
  * On older TypeScript versions only: on 3.6 to 4.7, calls of optional methods (and of members typed `fn | undefined`) have no setup API in such code; on 3.6 to 3.8, members whose type includes `null` or `undefined` have none either, and neither do `maybe?: T` or `orNull: T | null` of any type parameter, constrained or not, in an interface such as `Box<T>`. Configure them through `sub[configure]()`, which works on every version.
  * A union constraint whose variants' methods return different types (`T extends Cat | Dog`, with `speak(): 'meow'` and `speak(): 'woof'`): `.returns()` takes `never` there. Cast to the constraint: `(pet as SubstituteOf<Cat | Dog>).speak().returns('meow')`.
  * On TypeScript 5.4 and newer, a method that the variants of a union constraint declare with different parameter lists (`T extends LogA | LogB`, with `log(message: string): void` and `log(message: string, level?: number): void`) has no setup API, even when every variant returns the same type. Use the `configure` view (`sub[configure]().log('x').returns()`) or cast to the constraint. Checks work.
  * A set of a key that exists only through the index signature cannot be checked (`sub.received().timeout = 5`). Write `(sub.received() as Settings).timeout = 5`.
  * A promise-typed property of the constraint (`name: Promise<string>` with `T extends Repo`) has no `.resolves()` or `.rejects()` (string form, symbol form or `configure` view), while promise-returning methods have them. Write `repo.name.returns(Promise.resolve(value))`, or `.returns(Promise.reject(error))`, which work on every supported version. Concrete types are not affected.
* A member whose type is a union of function types with different return types (`onResult: ((r: string) => number) | ((r: string) => string)`), and a method whose return type differs between the variants of a union (`Substitute.for<Cat | Dog>()` with `load(): Promise<number>` and `load(): Promise<string>`, or methods that return `this`), have the setup API with the union of the return types: `listeners.onResult('a').returns(1)` and `.returns('x')`, `pet.load().resolves(1)` and `.resolves('x')`, `.mimicks()` and the `configure` view. With 2.0.0-beta.4, `.resolves()` on such methods, and `.returns()` on methods that return `this` and on union-typed callback members, took `never`, and calls of a substitute of a union of function types (`Substitute.for<((e: string) => number) | ((e: string) => string)>()`) had no setup API.
* The same holds for a method that the variants of a union declare with different parameter lists (an extra optional parameter, other parameter types, other overloads): `client.fetch('/a').resolves('ok')` for `fetch(url)` and `fetch(url, options?)` in `Substitute.for<ClientV1 | ClientV2>()`, and `reader.read('p').returns('text')` and `.returns(new Uint8Array())` for `read(path): string` and `read(path, encoding?): Uint8Array`. `.returns()` takes the return types of the variants that the call can reach, which depends on the number of arguments that the call passes. Each call is checked against one variant's parameter list as a whole, so arguments that no variant accepts together (`move('a', 'b')` for `move(x: string, y: number)` and `move(x: number, y: string)`) do not compile, and a callback without parameter types gets them from that list. A callback that annotates `this` with the type of a variant (`function (this: Button, x: number) { }`) compiles and takes that variant's return type; with 2.0.0-beta.4, such calls did not compile. [Typing limitations](README.md#typing-limitations) has the exact rule, and the cases that need a cast to one variant (such as `Arg.any()` where the variants' parameter types differ). With 2.0.0-beta.4, `.returns()` on such methods was missing or took `never` when the return types differ, and on TypeScript 5.4 and newer it was missing even when they are the same. Unions whose variants have a string index signature (`{ kind: 'a'; [key: string]: unknown; speak(): 'meow' } | ...`) take the union of the return types as well; with 2.0.0-beta.4, `.returns()` was missing there.
* Substitutes of constructor types and members that are classes support the setups and checks written as calls that [`new`](#new-is-a-call) needs: `Client('https://api').returns(client)` and `Client.received(1)('https://api')` for `Substitute.for<new (baseUrl: string) => ApiClient>()`, and `sdk.Client(Arg.any()).returns(client)` and `sdk.received(1).Client('https://api')` for a member `Client: typeof ApiClient`. `new Client('https://api')` keeps the constructor's parameter and instance types. A constructor type with several construct signatures has the call syntax for each of them.
* `.resolves()` and `.rejects()` configure a native promise, and are offered on every member that a native promise of the value fits: `Promise<T>` and its subtypes without members of their own (such as Prisma's `PrismaPromise<T>`, which only narrows `[Symbol.toStringTag]`), `PromiseLike<T>`, and unions such as `void | Promise<void>` or `string | Promise<string>`. With 2.0.0-beta.4, they were offered only when the return type is a promise. They are not offered for a thenable with members of its own, such as a query builder (`interface Query extends PromiseLike<Row[]> { where(...): Query }`), nor for a subtype of `Promise` with members of its own, such as ky's `ResponsePromise` (`json()`, `text()`), knex's `QueryBuilder` (`where()`), execa's result (`kill()`) or a `CancellablePromise` with `cancel()`: a native promise has no such members. **2.0.0-beta.4 offered them for such `Promise` subtypes**, and the code under test then failed with "... is not a function" when it called one of those members. Configure such a member with `.returns()`: a substitute of the type for code under test that calls its members, or a native promise with the members added (`Object.assign(Promise.resolve(1), { cancel: () => { } })`) for code under test that awaits it. See [Working with promises](README.md#working-with-promises).
* `.returns()` and `.resolves()` (also `[returns]()`, `[resolves]()` and the `configure` view) can be called without a value whenever `undefined` is a valid value: for `any`, `unknown`, `void`, `undefined` and `T | undefined`, as in Koa's `next().resolves()` or `repo.findById('42').resolves()` for `Promise<User | undefined>`. With 2.0.0-beta.4, only a `void` value could be left out.
* Generic methods (`get<K extends keyof Config>(key: K): Config[K]`) have the setup API with their type parameters replaced by their constraints, and the configured value is checked against what the method returns for them, also for arguments that fit only the constraints (`same(1, 'x')` for `same<T extends string | number>(a: T, b: T): T` takes `string | number`). On Node.js' `EventEmitter<Events>`, `Arg.all()` after the leading arguments of `emit()` (`orders.received(1).emit('paid', Arg.all())`) compiles, with the leading arguments checked against `emit()`'s own signature. An `Arg.is()` predicate in the arguments of a typed emitter's `emit()` needs a parameter type (`Arg.is((orderId: string) => ...)`), and a type parameter's default is not used, so pino's `logger.child(...)` takes a `Logger<string>` in `.returns()`. A call with too many or too few arguments is rejected, except for Node.js' `EventEmitter<Events>.emit`, and, on TypeScript 3.6 to 3.9, for generic methods whose rest parameter is typed by an indexed access (`send<K extends keyof Events>(event: K, ...args: Events[K])`), which take any number of arguments on a substitute there. A method whose return type is conditional on a type parameter (`convert<T>(value: T): T extends string ? number : boolean`) has the setup API, too, and `.returns()` takes any value there; with 2.0.0-beta.4, it took only the type of one branch (`boolean`). See [Typing limitations](README.md#typing-limitations).
* `Arg.any('bigint')` is typed `bigint`.
* `Arg.any('string')` is typed `string`, as with 2.0.0-beta.4 (and `Arg.any('number')` `number`, and so on), so overloads such as Node.js' `on(event: 'close', ...)` next to `on(event: string, ...)`, or lib.dom's `querySelector()`, take the overload for any string. It does not fit a parameter typed with a union of string literals (`'EUR' | 'USD'`), a string enum, a branded string (`string & { __brand: 'OrderId' }`), a union of number literals (`80 | 443`) or the encoding of Node.js' `fs.readFile()`. Write `Arg.is((currency: Currency) => true)` or `Arg.any('string') as Currency` there (`as unknown as OrderId` for a branded type). See [Matching by type](README.md#matching-by-type).
* Overloaded generic methods whose parameter types depend on a type parameter through a conditional type, such as `@types/pg`'s `Pool.query` and `ClientBase.query`, have no setup API for a call that passes values (`pool.query(sql, [1]).resolves(result)`), as with 2.0.0-beta.4. Pass the values `as never` (`pool.query(sql, [1] as never).resolves(result)`, the same call at runtime), or match the SQL with any values (`pool.query(sql, Arg.all())`). See [Typing limitations](README.md#typing-limitations).
* A member called `then` is typed `never`: substitutes are never thenables.
* Members typed only `null` or `undefined` (`error?: undefined`, `ownerDocument: null`) keep their plain type and no longer have `.returns()` and the other setup methods. Configure them through `sub[configure]()`. In a union, a member that is only `null` or `undefined` in some variants (`{ data: string[]; error: null } | { data: null; error: Error }`, or `{ ok: true; value: string; error?: undefined } | { ok: false; value?: undefined; error: Error }`) has the setup API with the type the variants have in common (`result.data.returns(null)`). With 1.x and the betas, the `: null` form turned the substitute into `never` (on TypeScript 3.9 and newer); the `?: undefined` form compiled with 2.0.0-beta.4.
* Substitutes of function types and of interfaces with call signatures are typed: `Substitute.for<(event: string) => string>()` supports `listener('saved').returns('ack')`, `listener.received(1)('saved')`, `listener[received](1)('saved')` and `listener[configure]()('saved').returns('ack')`. With 2.0.0-beta.4, the setup and the checks of such calls did not compile.
* `Arg.any('function')` is typed as any function or class, so it fits typed callback parameters. `Arg.any('object')` is typed `any`, like `Arg.any()` (it was `object`).
* `Arg.any('undefined')` only fits parameters and properties that accept `undefined`, such as an optional parameter, `number | undefined` or `unknown`. It was typed `never`, which fit every parameter, so code like `calculator.add(Arg.any('undefined'), 2)` no longer compiles. `Arg.any.not('undefined')` fits any parameter.
* Now supported: optional members (also `sub.received().optionalProperty = undefined`, for optional properties that are not functions), named members next to an index signature, overloads without parameters, up to 8 overloads, `(...args: unknown[])` methods, `.throws()` on methods that return `never`, `Arg.all()` after other arguments (after up to 6 of them), and types with very large unions of string literals, such as lib.dom's `HTMLInputElement`.
* An optional function-typed property (`onChange?: (value: string) => void`) does not accept `undefined` in a check. Write `(widget.received() as Widget).onChange = undefined`, or `widget.received().onChange = Arg.any.not('function')`.
* See [Typing limitations](README.md#typing-limitations) for what TypeScript cannot express.
