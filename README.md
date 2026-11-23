<div align="center">

# 🥄 substitute.js

**Strongly typed, fluent mocking for TypeScript and JavaScript, inspired by [NSubstitute](https://nsubstitute.github.io).**

[![npm version](https://img.shields.io/npm/v/@fluffy-spoon/substitute.svg)](https://www.npmjs.com/package/@fluffy-spoon/substitute)
[![npm downloads](https://img.shields.io/npm/dm/@fluffy-spoon/substitute.svg)](https://www.npmjs.com/package/@fluffy-spoon/substitute)
[![CI](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/actions/workflows/nodejs.yml/badge.svg)](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/actions/workflows/nodejs.yml)
[![license: MIT](https://img.shields.io/npm/l/@fluffy-spoon/substitute.svg)](LICENSE)
[![Financial Contributors on Open Collective](https://opencollective.com/substitute-js/all/badge.svg?label=financial+contributors)](https://opencollective.com/substitute-js#section-contribute)

[Quick start](#quick-start) · [Cheat sheet](#cheat-sheet) · [Full guide](docs/GUIDE.md) · [Migrating from 1.x](MIGRATION.md) · [Changelog](CHANGELOG.md)

</div>

---

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Mailer {
  send(to: string, subject: string): boolean
}

const mailer = Substitute.for<Mailer>()
mailer.send(Arg.any(), 'Welcome!').returns(true)

console.log(mailer.send('ann@example.com', 'Welcome!')) // prints true

mailer.received(1).send('ann@example.com', Arg.any())
mailer.didNotReceive().send('bob@example.com', Arg.any())
```

No `jest.fn()` per method, no `as any`, no real instance needed: you write the call you expect, exactly as the code under test makes it, and the compiler checks it.

## Why substitute.js?

- **Reads like the code it fakes.** Configure with `sub.method(args).returns(value)` and verify with `sub.received().method(args)`. No stringly-typed method names.
- **Strongly typed.** Argument types, return values and matcher predicates are all inferred from your interface or class, and `strict` mode is fully supported.
- **Fakes from nothing.** Create a substitute for any interface, class, function or constructor type. Every member is faked, so nothing real runs by accident.
- **Partial mocks when you want them.** Hand some or all calls to a real implementation with `mimicks()` or `[mimick]()`.
- **Clear failure messages.** A failed check tells you what was expected, what was received, and where.
- **Works with any test runner.** ava, jest, mocha, `node:test` and vitest are tested on every change. CommonJS, ES modules and the major bundlers are supported.
- **No runtime dependencies.**

## Installing

```sh
npm install @fluffy-spoon/substitute --save-dev
```

You need Node.js 10 or newer (12.17+ for `import`) and, if you use TypeScript, TypeScript 3.6 or newer. Still on version 1? Pin it with `@fluffy-spoon/substitute@1` and see the [migration guide](MIGRATION.md) for upgrading.

## Quick start

Say you want to test a service that depends on a repository and a logger:

<!-- docs-check: name=readme-quick-start -->
```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface User { id: number; name: string }

interface UserRepository {
  find(id: number): Promise<User | undefined>
  save(user: User): Promise<void>
}

interface Logger {
  warn(message: string): void
}

// the code under test
class UserService {
  constructor(private readonly users: UserRepository, private readonly logger: Logger) { }

  async rename(id: number, name: string) {
    const user = await this.users.find(id)
    if (!user) {
      this.logger.warn(`user ${id} not found`)
      return false
    }
    await this.users.save({ ...user, name })
    return true
  }
}

// 1. create substitutes
const users = Substitute.for<UserRepository>()
const logger = Substitute.for<Logger>()

// 2. configure what they answer
users.find(1).resolves({ id: 1, name: 'ann' })
users.find(Arg.is(id => id > 100)).resolves(undefined)

const service = new UserService(users, logger)
```

Then run the code under test and check what it did:

<!-- docs-check: uses=readme-quick-start -->
```typescript
async function test() {
  // 3. exercise the code under test
  console.log(await service.rename(1, 'anna')) // prints true
  console.log(await service.rename(404, 'nobody')) // prints false

  // 4. verify the calls it made
  users.received(1).save({ id: 1, name: 'anna' })
  logger.received(1).warn('user 404 not found')
  logger.didNotReceive().warn('user 1 not found')
}
test()
```

A failed check throws a `SubstituteException`, so it fails the test in whatever runner you use.

## Cheat sheet

The examples below use this interface:

<!-- docs-check: name=readme-calculator -->
```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Calculator {
  add(a: number, b: number): number
  divide(a: number, b: number): number
  heavyOperation(...numbers: number[]): Promise<number>
  isEnabled: boolean
}

const calculator = Substitute.for<Calculator>()
```

### Return values

<!-- docs-check: uses=readme-calculator -->
```typescript
calculator.add(1, 2).returns(3)                // every add(1, 2) returns 3
calculator.add(2, 2).returns(4, 5)             // 4, then 5 from then on
calculator.isEnabled.returns(true)             // properties work the same way
calculator.heavyOperation(1).resolves(42)      // a resolved promise
calculator.heavyOperation(0).rejects(new Error('too light'))
calculator.divide(Arg.any(), 0).throws(new Error('cannot divide by 0'))
calculator.add(10, Arg.any()).mimicks((a, b) => a * b) // run your own implementation

console.log(calculator.add(1, 2)) // prints 3
console.log(calculator.add(2, 2), calculator.add(2, 2), calculator.add(2, 2)) // prints 4 5 5
console.log(calculator.isEnabled) // prints true
console.log(calculator.add(10, 5)) // prints 50
calculator.divide(1, 0) // throws Error: cannot divide by 0
calculator.heavyOperation(1).then(result => console.log(result)) // prints 42
```

### Argument matchers

| Matcher | Matches |
|---|---|
| `Arg.any()` | any value, including `undefined` and `null` |
| `Arg.any('string')` | values of a type: `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'`, `'function'`, ... |
| `Arg.is(x => x > 0)` | values for which the predicate is truthy (the parameter type is inferred) |
| `Arg.is.not(...)`, `Arg.any.not(...)` | the inverse of the matcher |
| `Arg.all()` | any number of remaining arguments, including none |
| `{ id: Arg.any(), name: 'bob' }` | matchers also work inside plain objects and arrays |
| `expect.any(String)`, `sinon.match(...)` | the asymmetric matchers of jest, vitest and sinon work too |

<!-- docs-check: uses=readme-calculator -->
```typescript
calculator.add(1, 2).returns(3)
calculator.add(Arg.is(a => a > 100), Arg.any('number')).returns(100)
calculator.add(Arg.all()).returns(0)

// the most specific setup wins: literals, then matchers, then Arg.all()
console.log(calculator.add(1, 2)) // prints 3
console.log(calculator.add(200, 1)) // prints 100
console.log(calculator.add(5, 5)) // prints 0
```

### Verifying calls

<!-- docs-check: uses=readme-calculator -->
```typescript
import { clearReceivedCalls } from '@fluffy-spoon/substitute'

// the code under test
const disable = (c: Calculator) => { c.isEnabled = false }

calculator.add(1, 2)
calculator.add(1, 2)
disable(calculator)

calculator.received().add(1, 2)          // at least once
calculator.received(2).add(1, 2)         // exactly twice
calculator.received(2).add(Arg.all())    // matchers work in checks, too
calculator.didNotReceive().add(3, 4)     // never
calculator.received().isEnabled = false  // property assignments can be checked

calculator.received(1).add(1, 2) // throws SubstituteException

calculator[clearReceivedCalls]()         // forget received calls, keep setups
calculator.didNotReceive().add(1, 2)
```

### Partial mocks

Use real behaviour for some calls with `mimicks()`, or for everything you have not configured with `[mimick]()`:

<!-- docs-check: uses=readme-calculator -->
```typescript
import { mimick } from '@fluffy-spoon/substitute'

class RealCalculator implements Calculator {
  isEnabled = true
  add(a: number, b: number) { return a + b }
  divide(a: number, b: number) { return a / b }
  async heavyOperation(...numbers: number[]) { return numbers.reduce((total, n) => total + n, 0) }
}

calculator[mimick](new RealCalculator())
calculator.divide(Arg.any(), 0).returns(NaN) // setups still win over the real instance

console.log(calculator.add(2, 3)) // prints 5
console.log(calculator.divide(1, 0)) // prints NaN
calculator.received().add(2, 3) // and calls are still recorded
```

### Nested members

Anything you have not configured returns an *auto-substitute*, so code under test can reach through nested members without crashing:

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const app = Substitute.for()
app.getCalculator().add(1, 2).returns(99)
console.log(app.getCalculator().add(1, 2)) // prints 99

app.logger.info('started')
app.logger.received().info('started')
```

In TypeScript, nested members are typed as their real types, so configure them by returning substitutes of your own: `app.logger.returns(logger)`. See [auto-substitutes](docs/GUIDE.md#auto-substitutes-and-nested-members).

### Re-configuring a call

Once a call is configured, writing it again *calls* it. To change an existing setup, use `[configure]()`:

<!-- docs-check: uses=readme-calculator -->
```typescript
import { configure } from '@fluffy-spoon/substitute'

calculator.add(Arg.all()).returns(10)
calculator[configure]().add(1, 3).returns(1337)

console.log(calculator.add(1, 3)) // prints 1337
console.log(calculator.add(5, 2)) // prints 10
```

### When your type has a member called `received`, `returns`, ...

Every method of the library is also exported as a symbol, which never clashes with your own members: `received`, `didNotReceive`, `returns`, `throws`, `resolves`, `rejects`, `mimicks`, `mimick`, `configure` and `clearReceivedCalls`.

```typescript
import { Substitute, received } from '@fluffy-spoon/substitute'

interface Inbox {
  received(): string[]
}

const inbox = Substitute.for<Inbox>()
inbox.received().returns(['hello'])
console.log(inbox.received()) // prints [ 'hello' ]
inbox[received](1).received()
```

## Using it with your test runner

There is nothing to set up: checks throw, and runners report what throws. For example, with `node:test`:

<!-- docs-check: compile-only -->
```typescript
import test from 'node:test'
import { Substitute } from '@fluffy-spoon/substitute'

interface Clock { now(): number }

test('reads the clock once', () => {
  const clock = Substitute.for<Clock>()
  clock.now().returns(1000)

  const elapsed = (c: Clock, start: number) => c.now() - start
  if (elapsed(clock, 400) !== 600) throw new Error('wrong elapsed time')

  clock.received(1).now()
})
```

Verify substitutes with `received()` and `didNotReceive()`, not with spy assertions like jest's `toHaveBeenCalledWith()` or sinon's `assert.called()`: a substitute is not a spy. The guide has [a translation table](docs/GUIDE.md#test-runners), plus recipes for [mocking a whole module](docs/GUIDE.md#mocking-a-whole-module) with jest and vitest.

## Importing

The named import works with every module system, bundler and loader:

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'
```

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')
```

A default import (`import Substitute from ...`) works too, except in a few bundler setups described in [Importing](docs/GUIDE.md#importing).

## Documentation

The [**complete guide**](docs/GUIDE.md) covers every feature in depth, and every example in it is type-checked and run on every change:

- [Creating substitutes](docs/GUIDE.md#creating-a-substitute) for interfaces, classes, functions and constructors
- [Return values](docs/GUIDE.md#setting-return-values), [promises](docs/GUIDE.md#working-with-promises), [exceptions](docs/GUIDE.md#throwing-exceptions) and [mimicking](docs/GUIDE.md#mimicking-an-implementation)
- [Argument matchers](docs/GUIDE.md#argument-matchers), [how arguments are compared](docs/GUIDE.md#how-arguments-are-compared) and [match order](docs/GUIDE.md#match-order)
- [Partial mocks](docs/GUIDE.md#partial-mocks), [auto-substitutes](docs/GUIDE.md#auto-substitutes-and-nested-members) and [fluent interfaces](docs/GUIDE.md#fluent-interfaces)
- [Verifying calls](docs/GUIDE.md#verifying-calls) and [assertions that fail later](docs/GUIDE.md#assertions-that-fail-later)
- [Typing limitations](docs/GUIDE.md#typing-limitations) and [test runners](docs/GUIDE.md#test-runners)

Upgrading? Read the [migration guide](MIGRATION.md) and the [changelog](CHANGELOG.md). For a comparison with other mocking libraries, see [this article](https://medium.com/@mathiaslykkegaardlorenzen/with-typescript-3-and-substitute-js-you-are-already-missing-out-when-mocking-or-faking-a3b3240c4607) (written for version 1; the ideas still apply).

## Contributing

PRs are very welcome! [CONTRIBUTING.md](CONTRIBUTING.md) explains how the repository is laid out, how to run the tests and how releases work.

### Code contributors

This project exists thanks to all the people who contribute.

<a href="https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/graphs/contributors"><img src="https://opencollective.com/substitute-js/contributors.svg?width=890&button=false" alt="Code contributors" /></a>

### Financial contributors

Become a financial contributor and help us sustain the project. [[Contribute](https://opencollective.com/substitute-js/contribute)]

<a href="https://opencollective.com/substitute-js"><img src="https://opencollective.com/substitute-js/individuals.svg?width=890" alt="Individual contributors" /></a>

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

## License

[MIT](LICENSE) © Mathias Lykkegaard Lorenzen
