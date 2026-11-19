<a href="https://opencollective.com/substitute-js#section-contribute"><img src="https://opencollective.com/substitute-js/all/badge.svg?label=financial+contributors" alt="Financial Contributors on Open Collective" /></a>

# What is this?
[`@fluffy-spoon/substitute`](https://www.npmjs.com/package/@fluffy-spoon/substitute) is a TypeScript port of [NSubstitute](http://nsubstitute.github.io), which aims to provide a much more fluent mocking opportunity for strong-typed languages.

*You can read an in-depth comparison of `substitute.js` versus other popular TypeScript mocking frameworks here: https://medium.com/@mathiaslykkegaardlorenzen/with-typescript-3-and-substitute-js-you-are-already-missing-out-when-mocking-or-faking-a3b3240c4607 (written for version 1; the ideas still apply).*

**PRs are very welcome! Help is much appreciated.**

> Upgrading from 1.x or from a 2.0.0 beta? Read the [migration guide](MIGRATION.md). What changed in each version is in the [changelog](CHANGELOG.md).

# Table of contents
- [Installing](#installing) · [Requirements](#requirements) · [Importing](#importing)
- [Usage](#usage): [creating a substitute](#creating-a-substitute), [return values](#setting-return-values), [promises](#working-with-promises), [exceptions](#throwing-exceptions), [mimicking](#mimicking-an-implementation), [members that are a property and a method](#members-used-as-a-property-and-as-a-method), [classes that extend a substitute](#classes-that-extend-a-substitute)
- [Argument matchers](#argument-matchers), [inside objects and arrays](#matchers-inside-objects-and-arrays), [the matchers of test runners](#matchers-of-test-runners), [how arguments are compared](#how-arguments-are-compared) and [match order](#match-order)
- [Re-configuring a call](#re-configuring-a-call-configure) · [Partial mocks](#partial-mocks) · [Auto-substitutes](#auto-substitutes-and-nested-members) and [which calls lead to a setup](#which-calls-lead-to-a-setup-or-a-check)
- [Verifying calls](#verifying-calls): [counts](#received-and-didnotreceive), [properties](#properties), [what counts as a call](#what-counts-as-a-call), [clearing](#clearing-received-calls), [SubstituteException](#substituteexception), [deferred failures](#assertions-that-fail-later)
- [Names that conflict with the library](#names-that-conflict-with-the-library), [`call`, `apply` and `bind`](#call-apply-and-bind) and [the symbol API](#the-symbol-api)
- [Special members](#special-members): [substitutes are functions](#substitutes-are-functions), [printing](#printing-a-substitute), [freezing and `in`](#freezing-defined-properties-and-in) · [Typing limitations](#typing-limitations) · [Test runners](#test-runners), [mocking a whole module](#mocking-a-whole-module) and [debuggers](#debuggers) · [Performance](#performance)

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
Prefer the named import, `import { Substitute, Arg } from '@fluffy-spoon/substitute'`: it works with every module system, bundler and loader.

TypeScript, or code compiled by a bundler:

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'
// or: import Substitute, { Arg } from '@fluffy-spoon/substitute'
// (but not in CommonJS bundles that keep the package external, or with ts-node's ESM loader; see below)
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

The ES module entry point wraps the CommonJS build, so both share one copy of the library. Bundlers that include the package in the bundle, or that emit ES modules, give the same exports: on every change, the package is bundled with Rollup and `@rollup/plugin-commonjs`, webpack, esbuild and a Vite SSR build with `ssr.noExternal`, and run in vitest with `server.deps.inline`, with and without `deps.interopDefault: false`. For esbuild's ES module output for Node.js (`format: 'esm'`, `platform: 'node'`), add the usual banner `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`, because the library loads Node.js' `util` module with `require`. If a tool cannot hand the CommonJS exports to the ES module entry, `import` throws right away with an error that says so; use `require()` with that tool.

Three setups need care.

**CommonJS code that `require()`s the package, bundled with the package external.** This concerns CommonJS code bundled with Rollup's `@rollup/plugin-commonjs` while the package stays external, which Vite 7 and older do in SSR builds, because they keep dependencies external by default. With default options, the plugin turns that `require()` into a default import, which Node.js resolves to the ES module entry, so `require()` returns the `Substitute` class instead of the exports object. Nothing fails at that point, but `Substitute`, `Arg` and the other named exports are `undefined`, so `const { Substitute } = require('@fluffy-spoon/substitute')` followed by `Substitute.for()` throws `TypeError: Cannot read properties of undefined (reading 'for')`. Pass `commonjs({ esmExternals: true })` or `commonjs({ esmExternals: ['@fluffy-spoon/substitute'] })`, or bundle the package instead of keeping it external (in Vite: `ssr: { noExternal: ['@fluffy-spoon/substitute'] }`). In Vite 5 to 7, the plugin's option can also be passed as `build: { commonjsOptions: { esmExternals: ['@fluffy-spoon/substitute'] } }`. Vite 8 and newer are not affected by this, and neither is code that `import`s the package (but see the next paragraph for bundles with CommonJS output). On every change, the compatibility checks bundle such code with Rollup and each of the `commonjs()` settings above, with the package bundled, and with Vite's `ssr.noExternal`.

**CommonJS output with the package external.** When a bundler compiles ES module code (or TypeScript) into CommonJS output and keeps the package external, the bundle loads the package with `require()`, and the default import follows Node.js' CommonJS interop: it is the exports object, not the `Substitute` class. The first use then throws, for example `TypeError: Substitute.for is not a function` (Rollup, Vite 7), `import_substitute.default.for is not a function` (esbuild), `_fluffy_spoon_substitute__WEBPACK_IMPORTED_MODULE_0__.for is not a function` (webpack) or `_fluffy_spoon_substitute.default.for is not a function` (Rolldown, Vite 8). This happens for every source file with Rollup and `output.format: 'cjs'`, and with the SSR builds of Vite 5 to 7 with `build.rollupOptions.output.format: 'cjs'`. It also happens for `.mjs` files, and for `.js` and `.ts` files in a package with `"type": "module"`, with esbuild (`format: 'cjs'` with the package external, for example `packages: 'external'`), with webpack (`target: 'node'` with a `commonjs` external, for example `externals: { '@fluffy-spoon/substitute': 'commonjs @fluffy-spoon/substitute' }`), with Rolldown (`format: 'cjs'`) and with the SSR builds of Vite 8 with `build.rolldownOptions.output.format: 'cjs'`. Use the named import there, which works in every setup: `import { Substitute, Arg } from '@fluffy-spoon/substitute'`. With Rollup, and Vite 5 to 7, `output.interop: 'auto'` (in Vite: `build.rollupOptions.output.interop: 'auto'`) also makes the default import work. ES module output, and bundles that include the package, are not affected. On every change, the compatibility checks bundle the named import into CommonJS output with Rollup, esbuild, webpack and a Vite SSR build, and check Rollup's `output.interop: 'auto'`.

**ts-node's ESM loader.** With ts-node's ESM loader (`node --loader ts-node/esm`, also `mocha --loader=ts-node/esm`) and `module` and `moduleResolution` set to `node16` or `nodenext`, the default import does not type-check in `.mts` files and in `.ts` files of a package with `"type": "module"`. ts-node checks such a file against the package's CommonJS typings, so `import Substitute from '@fluffy-spoon/substitute'` followed by `Substitute.for()` is rejected with `error TS2339: Property 'for' does not exist on type 'typeof import(".../node_modules/@fluffy-spoon/substitute/dist/index")'`. ts-node does not show that message: the process exits with only `[Object: null prototype] { [Symbol(nodejs.util.inspect.custom)]: [Function: [nodejs.util.inspect.custom]] }` and the Node.js version. `tsc` accepts the same file. Use the named import, run the file with tsx (`node --import tsx`), or turn on ts-node's `transpileOnly` (`TS_NODE_TRANSPILE_ONLY=1`).

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

A function type, or an interface with call signatures, works the same way: a call of the substitute has the setup methods, and the checks are called like the function.

```typescript
import { Substitute, Arg, received } from '@fluffy-spoon/substitute'

type Listener = (event: string) => string

const listener = Substitute.for<Listener>()
listener('saved').returns('ack')
listener(Arg.is(event => event.startsWith('delete'))).returns('nack')
console.log(listener('saved')) // prints ack
console.log(listener('deleted')) // prints nack

listener.received(1)('saved')
listener[received](1)('deleted')
listener.didNotReceive()('created')
```

A class, or any other type that can be constructed, works the same way: `new` on a substitute, or on a member of it, is a call. It is recorded, and setups and checks written as calls apply to it: `sdk.Client(Arg.any()).returns(client)` answers `new sdk.Client('https://api')`, and `sdk.received(1).Client('https://api')` checks it. `new` returns the configured value when that is an object or a function (a setup with `throws()` throws), and otherwise the [auto-substitute](#auto-substitutes-and-nested-members) of that call, the same one that the call `sdk.Client('https://api')` returns. This holds for `new` on the substitute itself (`Substitute.for<new (baseUrl: string) => ApiClient>()`, configured as `Client('https://api').returns(client)` and checked as `Client.received(1)('https://api')`), and for `Reflect.construct()` and `new` on a function made with `bind()`, too. In TypeScript, a constructor type with several construct signatures has the call syntax for each of them. `String()` and failure messages show such a call as `new Client('https://api')`. A class can also extend a substitute; see [Classes that extend a substitute](#classes-that-extend-a-substitute).

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface ApiClient { get(path: string): Promise<string> }
interface Sdk { Client: new (baseUrl: string) => ApiClient }

// the code under test
class UserService {
  private readonly client: ApiClient
  constructor(sdk: Sdk) { this.client = new sdk.Client('https://api') }
  name(id: number) { return this.client.get(`/users/${id}/name`) }
}

const sdk = Substitute.for<Sdk>()
const client = Substitute.for<ApiClient>()
sdk.Client(Arg.any()).returns(client)
client.get('/users/1/name').resolves('ann')

new UserService(sdk).name(1).then(name => console.log(name)) // prints ann
sdk.received(1).Client('https://api')
sdk.didNotReceive().Client('https://staging')

const Client = Substitute.for<new (baseUrl: string) => ApiClient>()
Client('https://api').returns(client)
console.log(new Client('https://api') === client) // prints true
Client.received(1)('https://api')
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

To make a member return `undefined`, call `.returns()` without a value. In TypeScript, that compiles whenever `undefined` is a valid value of the member: for `void`, `undefined`, `any`, `unknown` and `T | undefined`. The same goes for `.resolves()` (see [Working with promises](#working-with-promises)). Where `undefined` is not a valid value, as for a `number`, TypeScript asks for one. `.throws()`, `.rejects()` and `.mimicks()` always need an argument.

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface Session {
  reset(): void
  currentUser(): string | undefined
  timeout(): number
}

const session = Substitute.for<Session>()
session.reset().returns()
session.currentUser().returns()
console.log(session.currentUser()) // prints undefined
// @ts-expect-error a number is needed
session.timeout().returns()
```

## Working with promises
For members that return a promise, `resolves()` and `rejects()` are shortcuts for returning a resolved or rejected promise. They work on methods and on promise-typed properties. They configure a native promise, so in TypeScript they are offered on every member that a native promise of the value fits: `Promise<T>` and its subtypes without members of their own (such as Prisma's `PrismaPromise<T>`, which only narrows `[Symbol.toStringTag]`, or subtypes whose own members are all optional), `PromiseLike<T>`, and unions such as `void | Promise<void>` (a hook that may be `async`), `string | Promise<string>` or `Promise<T> | undefined`. They take what the promise resolves to, and `resolves()` can be called without a value when `undefined` is a valid one (`Promise<void>`, `Promise<any>`, `Promise<User | undefined>`, Koa's `next: () => Promise<any>`).

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

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface Plugin {
  onInit(): void | Promise<void>
  load(name: string): string | Promise<string>
}

const plugin = Substitute.for<Plugin>()
plugin.onInit().resolves()
plugin.load('config').resolves('{}')

async function start(p: Plugin) {
  await p.onInit()
  console.log(await p.load('config')) // prints {}
}
start(plugin)
```

A thenable with members of its own, such as a query builder (`interface Query extends PromiseLike<Row[]> { where(...): Query }`), is not a promise, so `resolves()` and `rejects()` are not offered for it: a native promise has no `where()`. Neither are they for a subtype of `Promise` with members of its own, such as ky's `ResponsePromise` (`json()`, `text()`), knex's `QueryBuilder` (`where()`), execa's result (`kill()`) or a `CancellablePromise` with `cancel()`: the code under test would call these members on a native promise, which has none, and fail with "... is not a function". Configure such a member with `.returns()` and a substitute of the thenable, for code under test that calls its members:

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface Row { id: number }
interface Query extends PromiseLike<Row[]> {
  where(column: string, value: unknown): Query
}
interface Database {
  query(table: string): Query
}

// @ts-expect-error a native promise has no where()
Substitute.for<Database>().query('users').resolves([])

const database = Substitute.for<Database>()
const query = Substitute.for<Query>()
database.query('users').returns(query)
query.where('id', 1).returns(query)
console.log(database.query('users').where('id', 1) === query) // prints true
```

A substitute is never a thenable (see [Special members](#special-members)), so for code under test that `await`s such a value, return a native promise with the members added:

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface CancellablePromise<T> extends Promise<T> {
  cancel(): void
}
interface Jobs {
  run(name: string): CancellablePromise<number>
}
// a subtype without members of its own, like Prisma's
interface PrismaPromise<T> extends Promise<T> {
  readonly [Symbol.toStringTag]: 'PrismaPromise'
}
interface Users {
  count(): PrismaPromise<number>
}

Substitute.for<Users>().count().resolves(3)

const jobs = Substitute.for<Jobs>()
// @ts-expect-error a native promise has no cancel()
jobs.run('cleanup').resolves(1)

// the code under test awaits the result
jobs.run('backup').returns(Object.assign(Promise.resolve(1), { cancel: () => { } }))
jobs.run('backup').then(count => console.log(count)) // prints 1

// the code under test calls cancel()
const job = Substitute.for<CancellablePromise<number>>()
jobs.run('report').returns(job)
jobs.run('report').cancel()
job.received(1).cancel()
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

`mimicks()` must be given functions. Anything else, or nothing, throws a `TypeError` right away, at the setup, and the message names the member. When the code under test calls the member with [`new`](#creating-a-substitute), the function is called with `new` if it can be: a class, an ordinary `function` or a substitute. Other functions, such as arrow functions and methods, are called as usual.

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const repository = Substitute.for()
repository.find(Arg.any()).mimicks({ id: 1 }) // throws TypeError: mimicks() expects a function to call for @Substitute.find(Arg.any{any}), but received { id: 1 }.

class User {
  constructor(name) { this.name = name }
}
const models = Substitute.for()
models.User(Arg.any()).mimicks(User)
const ann = new models.User('ann')
console.log(ann instanceof User, ann.name) // prints true ann
```

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

## Classes that extend a substitute
The code under test can extend a substitute, or a member of one, as it would extend a base class from a library: `class Plugin extends sdk.Base { ... }`. `new Plugin(...)` is then recorded as a call `new Base(...)` of the substitute (check it with `sdk.received(1).Base(...)`), and it gives an instance of `Plugin`, with `Plugin`'s methods, as in JavaScript:

* Without a setup, each `new Plugin()` gives a new object made from `Plugin.prototype`.
* With `sdk.Base(Arg.all()).mimicks(RealBase)`, or for `class Plugin extends Base` where `Base` is a substitute after `Base[mimick](RealBase)`, `RealBase` constructs the instance, with `Plugin` as `new.target`.
* With a setup that returns an object (`sdk.Base(Arg.any()).returns(base)`), `super()` returns that object, and so `new Plugin()` gives that object, as a base class constructor that returns an object does.

Assignments in the constructor (`this.ready = true`) and static fields create real properties of the instance and of the class, and are not recorded. A class that extends `Base` after `Base[mimick](RealBase)` also inherits the methods of `RealBase`, because `Base.prototype` reads `RealBase.prototype`. A class that extends a member such as `sdk.Base` does not: `sdk.Base.prototype` is an [auto-substitute](#auto-substitutes-and-nested-members), whose members are auto-substitutes, too. Likewise, `Reflect.construct(sdk.Model, [1], Other)` gives an instance of `Other`, and a function made with `bind()` from a class (`Connection.bind(null, 'db')`) can be given to `mimicks()` and `[mimick]()`: `new` constructs it. A class that extends a substitute has the `call`, `apply` and `bind` of every function (`Plugin.bind === Function.prototype.bind`), so `new (Plugin.bind(null, 'audit'))()` constructs a `Plugin`, which is recorded as `new Base('audit')`, and `Plugin.call(null, 'audit')` throws the `TypeError` of calling a class without `new`, as in JavaScript. Reading them records nothing. Only when the substitute configures a member of that name (`sdk.Base[configure]().bind(Arg.all()).returns(value)`), or mimicks an instance that has one of its own, does that setup or instance answer instead.

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

class RealBase {
  constructor(name) { this.name = name }
}

// the code under test extends a base class of an SDK
const definePlugin = sdk => class Plugin extends sdk.Base {
  constructor(name) {
    super(name)
    this.ready = true
  }
  describe() { return `plugin ${this.name}` }
}

const sdk = Substitute.for()
sdk.Base(Arg.all()).mimicks(RealBase)
const Plugin = definePlugin(sdk)

const plugin = new Plugin('audit')
console.log(plugin instanceof Plugin, plugin.ready, plugin.describe()) // prints true true plugin audit
sdk.received(1).Base('audit')

// a constructor bound with the class' own bind(), as a registry of plugins makes them
const AuditPlugin = Plugin.bind(null, 'audit')
console.log(new AuditPlugin().describe()) // prints plugin audit
sdk.received(2).Base('audit')

// the code under test hands the instance to another substitute
const host = Substitute.for()
host.register(plugin)
host.received(1).register(plugin)
host.received(1).register(Arg.any('object'))
console.log(JSON.stringify(plugin)) // prints {"name":"audit","ready":true}
console.log(plugin) // prints Plugin { name: 'audit', ready: true }
// a symbol that is not registered with Symbol.for() reads as undefined through the instance
console.log(plugin[Symbol('internal')]) // prints undefined

// without a setup, every `new` gives a new instance
const Unconfigured = definePlugin(Substitute.for())
console.log(new Unconfigured('a') !== new Unconfigured('a'), new Unconfigured('b') instanceof Unconfigured) // prints true true
```

Instances of such a class, and any other object whose prototype chain leads to a substitute (`Object.create(sub)`, or objects made from such instances), are ordinary objects, to the library and to the code that looks at them:

* Passed to a substitute, they are recorded, checked and matched like other objects: by [deep strict equality](#how-arguments-are-compared) of their own fields and their prototype, and `Arg.any('object')` matches them.
* `JSON.stringify(plugin)` gives their own fields. `util.inspect()`, `console.log()`, failure messages, and the messages and snapshots of jest and vitest show them with their class, as `Plugin { name: 'audit', ready: true }`. `String(plugin)`, template strings and `plugin + ''` give `[object Object]`, as with an empty base class.
* Through such an object, the substitute answers `then`, `toJSON`, `Symbol.toPrimitive`, `util.inspect.custom`, the library's own symbols and every other symbol that is not registered with `Symbol.for()` (such as `Symbol('id')`, or the private symbols that Node.js' own checks look for) with `undefined`, without recording these reads, and `toString` and `valueOf` with those of `Object.prototype` (with `Function.prototype.toString` for the class itself), unless the substitute configures or mimicks them.
* A class that extends a substitute is not a substitute itself: `Arg.any('object')` does not match it (`Arg.any('function')` does), and it has no `[received]()`.

Other members that neither the instance nor its class has, symbols registered with `Symbol.for()` among them, are still read from the `prototype` of the substitute, which is an auto-substitute, and these reads are recorded there. The library itself reads nothing from the substitute through such an object, when it compares it with the arguments of setups and checks or prints it, also when the substitute belongs to another copy of the package than the one that compares or prints (see [The symbol API](#the-symbol-api)). Other code may: `util.inspect()` on Node.js 20.20 and newer reads `href` of every object it prints, so calling it on such an instance, in the test or in the code under test, records a read of `Base.prototype.href` on `sdk`, and on Node.js 20.20, `util.isDeepStrictEqual()` called by your own code on such instances reads their `href`, `protocol` and `auth`, recorded as `Base.prototype.href` and so on (on Node.js 18, 22 and newer, it reads nothing there). On Node.js 20 only, `String(plugin)` is `[object Function]`: V8 there takes every object whose prototype is a proxy of a function for a function, with or without the library.

# Argument matchers
There are several ways of matching arguments. They work the same when you set up calls and when you verify them, and they also work for property assignments (`calculator.received().isEnabled = Arg.any()`).

## Matching specific arguments
`Arg.any()` matches any value. `Arg.is(predicate)` matches the values for which the predicate returns a truthy value (`Arg.is(user => user.name)` matches `{ name: 'ann' }`). When `Arg.is` replaces an argument, the type of the predicate's parameter is inferred from that argument. That holds for generic methods, too, with the method's type parameters replaced by their constraints, also when they appear only in the return type, as in a database client's `query<T>(sql: string): Promise<T[]>` (see the second example). It does not hold for a rest parameter whose type depends on a type parameter, such as the event arguments of a typed event emitter's `emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>)` or of Node.js' `EventEmitter<Events>`: there, a predicate without a parameter type gets the parameter types of all events together, or `unknown` with Node.js' `EventEmitter<Events>`, and the call does not compile. (With `@types/node` 25 and newer, it gets `any` on `EventEmitter<Events>`, so nothing checks it.) Annotate the parameter there: `emitter.emit('saved', Arg.is((id: string) => id.startsWith('o')))` (see [Typing limitations](#typing-limitations)).

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

```typescript
import { Substitute, Arg, configure } from '@fluffy-spoon/substitute'

interface Database {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>
}
interface Cache {
  get: <T>(key: string) => Promise<T | undefined>
}

const database = Substitute.for<Database>()
// sql is inferred as a string
database.query(Arg.is(sql => sql.startsWith('SELECT'))).resolves([])
database[configure]().query('DELETE FROM users', Arg.is(params => params !== undefined && params.length === 1)).resolves([])
database.query('SELECT 1').then(rows => console.log(rows)) // prints []
database.received(1).query(Arg.is(sql => sql.startsWith('SELECT')))

const cache = Substitute.for<Cache>()
cache.get(Arg.is(key => key.startsWith('user:'))).resolves(undefined)
```

Outside of an argument position, for example in a variable, there is nothing to infer the type from, so annotate the parameter:

<!-- docs-check: uses=calculator -->
```typescript
const negative = Arg.is((x: number) => x < 0)
calculator.divide(negative, negative).returns(1)
console.log(calculator.divide(-4, -2)) // prints 1
```

`Arg.is()` with something other than a function throws a `TypeError` right away. A predicate that throws, for example because it reads a property of `null`, counts as a non-match: the code under test is not affected, and a failed assertion says that the predicate threw.

A predicate must decide synchronously. One that returns a promise or another thenable, such as an `async` function, throws a `TypeError` where it is used: in the check, or in the call of the code under test that a setup with it is compared with. Its promise is handled, so no unhandled rejection follows. Await what the predicate needs before the setup or the check:

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const repository = Substitute.for()
repository.save({ name: 'ann' })
repository.received(1).save(Arg.is(user => user.name)) // a truthy value matches
repository.received(1).save(Arg.is(async user => user.name === 'ann')) // throws TypeError: Arg.is{async user => user.name === 'ann'} returned a promise (or another thenable), but an Arg.is predicate must return whether the value matches synchronously
```

The matchers must be called. In JavaScript, a matcher function passed as it is, such as `Arg.any` instead of `Arg.any()`, would only match that function itself, so a setup with it would never answer and a `didNotReceive()` check with it would always pass. As a direct argument of a setup or a check, `Arg.any`, `Arg.any.not`, `Arg.is`, `Arg.is.not` and `Arg.all` therefore throw a `SubstituteException` that suggests the call. (TypeScript rejects them, unless the parameter takes functions, `any` or `unknown`.) Inside an object or array, they are compared as values, and the code under test can pass them in its own calls, which are recorded as usual.

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const repository = Substitute.for()
repository.find(Arg.any).returns('ann') // throws SubstituteException: Arg.any was passed as an argument without calling it, so it would only match the function Arg.any itself. Did you mean Arg.any()?
repository.didNotReceive().delete(Arg.is) // throws SubstituteException: Did you mean Arg.is(predicate)?
```

## Matching by type
`Arg.any(type)` matches values of a type:

| `type` | Matches |
|---|---|
| `'any'` (the default) | any value, including `undefined` and `null` |
| `'string'`, `'number'`, `'boolean'`, `'symbol'`, `'bigint'`, `'undefined'` | values with that `typeof` |
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

Any other type name, for example a typo or another case such as `'String'`, throws a `TypeError` right away, in `Arg.any()` and in `Arg.any.not()` (TypeScript does not compile it in the first place): `Arg.any expects one of 'any', 'string', 'number', 'boolean', 'symbol', 'undefined', 'object', 'function', 'array', 'bigint' (or no argument for 'any'), but received 'strnig'.`

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const printer = Substitute.for()
printer.print(Arg.any('bigint')).returns('a bigint')
console.log(printer.print(10n)) // prints a bigint

Arg.any.not('strnig') // throws TypeError: Arg.any.not expects one of
```

In TypeScript, a type matcher must fit the parameter. `Arg.any('string')` is typed `string`, `Arg.any('number')` `number`, and so on for `'boolean'`, `'symbol'` and `'bigint'`, wherever the matcher is written. So it fits a parameter that accepts every value of its type, and an overloaded method takes the overload that a `string` (or `number`, ...) would take: `stream.on(Arg.any('string'), Arg.any())`, `document.querySelector(Arg.any('string'))`, and `get(Arg.any('string'))` for a getter that declares `get(key: 'retries'): number` before `get(key: string): string | undefined` have the setup API of the overload for any string. A type matcher does not fit a parameter that takes only some values of its type: a union of string literals (`'EUR' | 'USD'`), a string enum, a branded string (`string & { __brand: 'OrderId' }`), a union of number literals (`80 | 443`), a branded number, or `true`. TypeScript reports, for example, `Argument of type 'ReturnArg<string>' is not assignable to parameter of type 'Currency'`. (A numeric enum accepts `Arg.any('number')`, as it accepts any number.) There, give an `Arg.is()` predicate the parameter's type, `Arg.is((currency: Currency) => true)`, which matches every value, or cast the type matcher, `Arg.any('string') as Currency`, which still matches every string; a branded type needs the cast through `unknown` (`Arg.any('string') as unknown as OrderId`), as TypeScript rejects `Arg.any('string') as OrderId`. Nor does a type matcher fit a parameter that takes no value of its type, such as `Arg.any('string')` for a number. `Arg.any('undefined')` only fits a parameter that accepts `undefined`, such as `string | undefined`, an optional parameter or `unknown`. `Arg.any()` and `Arg.any('object')` fit any parameter (see [Typing limitations](#typing-limitations)). `Arg.any('undefined')` also matches an argument that the call leaves out (see [How arguments are compared](#how-arguments-are-compared)).

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Users {
  find(name?: string): string
  count(limit: number): number
}

const users = Substitute.for<Users>()
users.find(Arg.any('undefined')).returns('all users')
console.log(users.find(undefined)) // prints all users
console.log(users.find()) // prints all users

// @ts-expect-error a number parameter does not accept undefined
users.count(Arg.any('undefined'))
```

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

type Currency = 'EUR' | 'USD'
enum Status { Open = 'open', Paid = 'paid' }
enum Priority { Low, High }
type OrderId = string & { readonly __brand: 'OrderId' }

interface Payments {
  charge(currency: Currency, cents: number): string
  setStatus(id: OrderId, status: Status): void
  setPriority(id: OrderId, priority: Priority): void
}

const payments = Substitute.for<Payments>()
payments.charge(Arg.is((currency: Currency) => true), Arg.any('number')).returns('charged')
payments.setStatus(Arg.is((id: OrderId) => true), Arg.any('string') as Status).returns()
// a numeric enum accepts Arg.any('number')
payments.setPriority(Arg.any('string') as unknown as OrderId, Arg.any('number')).returns()
console.log(payments.charge('EUR', 100)) // prints charged
payments.received(1).charge(Arg.any('string') as Currency, 100)

// @ts-expect-error Arg.any('string') is typed string, which is not a Currency
payments.charge(Arg.any('string'), 100)
// @ts-expect-error a string matcher does not fit a number parameter
payments.charge('EUR', Arg.any('string'))
// @ts-expect-error a branded type needs the cast through unknown
payments.setPriority(Arg.any('string') as OrderId, Priority.High)

// overloads: Arg.any('string') takes the overload for any string
interface Settings {
  get(key: 'retries'): number
  get(key: string): string | undefined
}
const settings = Substitute.for<Settings>()
settings.get(Arg.any('string')).returns('dark')
console.log(settings.get('theme')) // prints dark
```

The encoding of Node.js' `fs.readFile(path, options)` is such a parameter: every overload types it as a union of string literals (`BufferEncoding`) or an options object, so `fs.readFile(Arg.any(), Arg.any('string'))` does not compile, in a setup or in a check. Pass the encoding itself, cast the matcher to `BufferEncoding`, or give an `Arg.is()` predicate that type. A check can also take `Arg.any()` for it. In a setup, `fs.readFile(Arg.any(), Arg.any())` and `fs.readFile(Arg.all())` take the first overload, which gives a `Buffer`, so `.resolves()` does not take a string there: use the encoding or the cast for a string result.

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

const fs = Substitute.for<Pick<typeof import('fs/promises'), 'readFile'>>()
fs.readFile('config.json', 'utf8').resolves('{}')
fs.readFile(Arg.any(), Arg.any('string') as BufferEncoding).resolves('')
fs.readFile(Arg.any(), Arg.any()).resolves(Buffer.from('binary'))

// @ts-expect-error every overload types the encoding as a union of string literals
fs.readFile(Arg.any(), Arg.any('string')).resolves('')
// @ts-expect-error Arg.any() for the options takes the first overload, which gives a Buffer
fs.readFile(Arg.any(), Arg.any()).resolves('')

// the code under test
fs.readFile('config.json', 'utf8').then(text => console.log(text)) // prints {}
fs.received(1).readFile('config.json', Arg.is((encoding: BufferEncoding) => encoding === 'utf8'))
fs.received(1).readFile(Arg.any(), Arg.any())
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

`Arg.any()` stands for one argument, and `Arg.all()` for any arguments. TypeScript accepts a lone `Arg.any()` for a method with more parameters, because `Arg.any()` is typed `any` and so also fits the signature that takes `Arg.all()`. But such a setup or check only matches calls with one argument (the other positions count as `undefined`, see [How arguments are compared](#how-arguments-are-compared)): after `calculator.add(1, 2)`, `calculator.didNotReceive().add(Arg.any())` passes, and `calculator.add(Arg.any()).returns(3)` does not answer `calculator.add(1, 2)`. Write `add(Arg.all())`, or `add(Arg.any(), Arg.any())`. Typed matchers, such as `Arg.any('number')` and `Arg.is((x: number) => x > 0)`, are checked against the number of parameters.

<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2)

// a lone Arg.any() only matches calls with one argument
calculator.didNotReceive().add(Arg.any())
calculator.received(1).add(Arg.all())
calculator.received(1).add(Arg.any(), Arg.any())
// @ts-expect-error add() takes two arguments
calculator.didNotReceive().add(Arg.any('number'))
```

## Matchers inside objects and arrays
Matchers also work inside plain objects and arrays, also nested ones (up to the limits below). An object with a matcher matches an argument with the same keys (in any order), and an array with a matcher matches an array of the same length. Each nested matcher matches by its own rule, and every other value must be [equal](#how-arguments-are-compared). Like any call with a matcher, such a call is a setup or a check, never a received call, and in the [match order](#match-order) it ranks with the other matcher setups.

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
* An array that holds a matcher is compared by its items only. Its other keys, such as the `total` of an array of rows, are not compared then: `Object.assign([Arg.any(), 2], { total: 5 })` matches `[1, 2]` and `Object.assign([1, 2], { total: 9 })`, too. An array without a matcher is compared in full, other keys included. Use `Arg.is()` for the whole array to check its other keys along with a matcher.
* The search for matchers is bounded, so that large arguments stay fast. An array with more than 1,024 items and an object with more than 1,024 keys are not searched, and neither are arrays and objects more than 32 levels below the argument. Each argument also has a budget of 1,024 arrays and objects, which each of them shares evenly among its items: in an array of 1,000 objects, each object is searched, but the objects inside them are not. An item of a searched array or object that is itself a matcher is always found. An array or object that several values of one argument refer to is searched once, and an argument looks at 32,768 items and keys in all at most: a matcher in an array or object beyond that is not found. An array or object with more than 256 items or keys that holds no matcher within these limits is remembered (weakly, so this keeps nothing alive), and so is an object with more than 1,024 keys, whose keys are not listed again. If the search looked at everything inside it, it is not searched again. If the limits left arrays or objects inside it out, the second time it is passed it is searched within the limits again, and then once more without the budget (but still at most 32 levels deep and 32,768 items and keys): if that finds no matcher either, it is not searched again, and otherwise it is searched within the limits every time. So a lookup table passed to every call costs nothing after the first two calls, and a new batch of records passed to each call is searched once, within the limits. A matcher put into such an array or object after it is no longer searched is not found, even if items or keys were deleted (see [How arguments are compared](#how-arguments-are-compared)). A matcher that is not found is compared as a value, as above. Setups like `save({ user: { id: Arg.any(), roles: [Arg.any('string'), 'admin'] } })`, or an object with a few hundred keys and a matcher, are far from these limits.
* `String(sub)` shows nested matchers, for example `save({ id: Arg.any{any}, name: 'bob' }) => returns('saved')`.

## Matchers of test runners
The asymmetric matchers of jest and vitest work as argument matchers, in setups and in checks: `expect.any()`, `expect.anything()`, `expect.stringContaining()`, `expect.stringMatching()`, `expect.objectContaining()`, `expect.arrayContaining()`, `expect.closeTo()`, their `expect.not` forms, and the matchers that `expect.extend()` adds. So do sinon's matchers: `sinon.match(...)`, `sinon.match.has('err')`, `sinon.match.string` and the others. A jest or vitest matcher matches a value when its `asymmetricMatch(value)` returns a truthy value, and a sinon matcher when its `test(value)` does. They work at the top level and inside plain objects and arrays, within the limits of [matchers inside objects and arrays](#matchers-inside-objects-and-arrays), and otherwise behave like `Arg` matchers, too:

* A call with one is a setup or a check, never a received call, and it runs no setup (see [What counts as a call](#what-counts-as-a-call)).
* In the [match order](#match-order), a setup with one ranks with the other matcher setups. A setup with an equal matcher (`expect.any(String)` again) replaces it.
* Inside a class instance, a `Map` or a `Set`, such a matcher is a value, and so is one that the code under test assigns to a property: `form.email = expect.any(String)` is recorded with that object as the value.
* A matcher that throws counts as a non-match. The failure message says so in the words it uses for `Arg.is()`: `(an Arg.is predicate threw while matching this call: ...)`.
* Failure messages and printouts show them as the runner does, such as `Any<String>`, `Anything`, `StringContaining '@'`, `StringNotContaining 'x'`, `ObjectContaining { customer: 'cus_1' }`, `ArrayContaining [ 'vip' ]` and `NumberCloseTo 0.3 (5 digits)`, and sinon's by their message, such as `has("err")` or `typeOf("string")`.

With vitest (the [compatibility checks](#test-runners) run these checks with vitest and with jest on every change):

<!-- docs-check: skip runs only under vitest; compatibility-checks/test-runners/vitest-matchers runs these checks -->
```typescript
import { expect, test } from 'vitest'
import { Substitute } from '@fluffy-spoon/substitute'

interface Mailer {
  send(to: string, template: 'welcome' | 'dunning', vars?: Record<string, string | number>): Promise<{ messageId: string }>
}

test('sends the welcome mail', async () => {
  const mailer = Substitute.for<Mailer>()
  mailer.send(expect.any(String), 'dunning').resolves({ messageId: 'm1' })

  // the code under test
  await mailer.send('ann@example.com', 'welcome', { customer: 'cus_1' })

  mailer.received(1).send(expect.stringContaining('@'), 'welcome', expect.objectContaining({ customer: 'cus_1' }))
  // SubstituteException: Expected to receive 0 method calls matching send(Any<String>, 'welcome', Anything), but received 1.
  expect(() => mailer.didNotReceive().send(expect.any(String), 'welcome', expect.anything())).toThrow('but received 1')
  await expect(mailer.send('bob@example.com', 'dunning')).resolves.toEqual({ messageId: 'm1' })
})
```

The library recognises them by their shape. A jest or vitest matcher is an object with an own `$$typeof` property equal to `Symbol.for('jest.asymmetricMatcher')` and an `asymmetricMatch` method, and a sinon matcher is an object that is not a plain object, with an own `test` method and an own `message` string, and with `and` and `or` methods. A matcher of another library in one of these shapes works as well, and so does one made by hand:

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// an asymmetric matcher in the shape that jest and vitest give them
const even = {
  $$typeof: Symbol.for('jest.asymmetricMatcher'),
  asymmetricMatch: value => value % 2 === 0,
  toAsymmetricMatcher: () => 'Even'
}

const counter = Substitute.for()
counter.add(even).returns('even')
console.log(counter.add(4)) // prints even
counter.add(3)
counter.received(1).add(even)
counter.received(2).add(even) // throws SubstituteException: Expected to receive 2 method calls matching add(Even), but received 1.
```

In TypeScript, vitest types its matchers `any`, and so does `@types/jest` for jest's global `expect`, so they fit every parameter, also where they can never match (`expect.any(Number)` for a string). With `@jest/globals`, they are typed `AsymmetricMatcher`, which only parameters such as `unknown` or `object` take. Cast them for other parameters: `expect.any(String) as never` (`as string` does not compile). `@types/sinon` types sinon's matchers as `SinonMatcher`: `sinon.match.has('err')` fits an object parameter, and `sinon.match.string` needs the same cast for a string parameter. `Arg` matchers are typed for the parameter that they replace, and do not depend on a test runner, so prefer them where you write new tests: `Arg.any('string')`, `Arg.is(vars => vars.customer === 'cus_1')`.

## How arguments are compared
Arguments that are not matchers are compared with deep strict equality, the rule of `assert.deepStrictEqual` (`util.isDeepStrictEqual`). Objects and arrays are equal when they have the same prototype and their own enumerable properties (with string or symbol keys) are equal. `NaN` equals `NaN`, but `0` and `-0` are different. Where Node.js changed the rule, the library follows the running version: two invalid `Date`s are different up to Node.js 22 and equal from Node.js 24 on, and two cyclic objects whose cycles have a different shape are equal up to Node.js 22 and different from Node.js 24 on. Substitutes are compared by identity and never member by member.

Arguments are compared position by position, up to the longer of the two argument lists. An argument that one side leaves out at the end counts as `undefined` there: it matches only a literal `undefined` or a matcher that accepts `undefined`, such as `Arg.any()`, `Arg.any('undefined')`, `Arg.is(value => value === undefined)` or `Arg.any.not('number')`. A predicate that throws for `undefined` (`Arg.is(name => name.length > 0)`) does not match, as always. So `f(1)` and `f(1, undefined)` are the same call: they match the same setups and checks, return the same [auto-substitute](#auto-substitutes-and-nested-members), and are one setup in the [`configure`](#re-configuring-a-call-configure) view, where a setup of one replaces a setup of the other. Arguments with values still count: `f(1)` and `f(1, 2)` are different calls, either way round. This applies to the arguments themselves only. Inside an array or an object, deep strict equality decides, so `[1]` and `[1, undefined]` are different, and so are `{ id: 1 }` and `{ id: 1, name: undefined }`. Failure messages show each call as it was made.

```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Cache {
  get(key: string, options?: { fresh: boolean }): string
}

const cache = Substitute.for<Cache>()
cache.get('a', Arg.any()).returns('any options')
cache.get('b', undefined).returns('no options')
cache.get('c', Arg.any('object')).returns('with options')

// the code under test leaves the options out
console.log(cache.get('a')) // prints any options
console.log(cache.get('b')) // prints no options
// Arg.any('object') does not accept undefined
console.log(cache.get('c') === 'with options') // prints false

cache.received(1).get('b', undefined)
cache.received(3).get(Arg.any(), Arg.any())
cache.didNotReceive().get(Arg.any(), Arg.any('object'))
```

So a check like `didNotReceive().get('a', Arg.any())` fails after `get('a')`, and a matcher setup that accepts `undefined` answers calls that leave the argument out, which matters when you [re-configure such a call](#re-configuring-a-call-configure).

Errors follow Node.js' rule, too. An object that inherits from `Error.prototype` and has the `Symbol.toStringTag` `'Error'` is compared like an error (its `name` and `message` count), so it can be equal to a native error with the same message. Objects that `Object.prototype.toString` shows as `[object Object]` are compared by their keys alone: error-like objects without that tag, and native errors whose `Symbol.toStringTag` is `'Object'`. On Node.js 24 and newer, Node.js still compares a native error with that tag as an error when it is the first argument of `isDeepStrictEqual`, so there the result can depend on the order. The library then passes the value of the setup or the check first, and for [auto-substitutes](#auto-substitutes-and-nested-members) the value of the earlier call.

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const handler = Substitute.for()
handler.handle(new Error('timeout')).returns('retry')

// not a native error, but deep strictly equal to the error above
const errorLike = Object.create(Error.prototype, {
  message: { value: 'timeout' },
  [Symbol.toStringTag]: { value: 'Error' }
})
console.log(handler.handle(errorLike)) // prints retry
```

Deep strict equality cannot see `#private` fields or other internal state. So all instances of a class that keeps its state only in `#private` fields are equal to each other. The same goes for some built-in objects, depending on the Node.js version: any two `Blob`s are equal, any two `Headers` and any two `URLSearchParams` from Node.js 20 on, and any two `FormData`, fetch `Request`s and `Response`s from Node.js 24 on (two URLs, though, are equal only when their addresses are, on every version). For such values, pass the same instance, or match with `Arg.is()`:

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

A value that cannot be read, such as an object with a getter that throws or a revoked proxy, is equal only to itself: Node.js' deep equality throws when it has to read such a value, which counts as unequal, and it does not read a value that it compares with itself. So the same value matches, and so does a new array or object that holds that same value, but another such value never does. This is decided again for each call, setup and check: once the value can be read, it is compared by its contents, like any other value, so it matches a setup made with an equal object. (A setup made while the value could not be read keeps matching that value itself, like a setup whose argument changed afterwards; see below.) A call or a setup reads such a value at most once, and so do a call and the setup method chained to it together, such as `repository.load(value).returns(1)`. A check reads it at most about once for each received call that it compares it with (Node.js' deep equality stops at the first getter that throws).

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// a record whose getter throws until it is loaded
const unloaded = () => Object.defineProperty({}, 'name', { enumerable: true, get() { throw new Error('not loaded') } })

const cache = Substitute.for()
const user = unloaded()
cache.store([user]).returns('stored')

console.log(cache.store([user])) // prints stored
console.log(cache.store([unloaded()]) === 'stored') // prints false

// once the record can be read, it is compared by its contents
let loaded = false
const record = Object.defineProperty({}, 'name', { enumerable: true, get() { if (loaded) return 'ann'; throw new Error('not loaded') } })
cache.load(record) // the code under test passes the record before it is loaded
loaded = true
cache.load({ name: 'ann' }).returns('loaded')
console.log(cache.load(record)) // prints loaded
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

Whether a later call matches when the changed object is inside a new array or object (such as `{ settings }` around the changed `settings`) is not specified: currently it does when the changed object has more than 256 keys or entries, and does not when it has 256 or fewer. A copy of the changed object never matches. Checks such as `received()` compare the arguments as they are when the check runs.

The library remembers the hash of an object with more than 256 keys, and of a `Map` or `Set` with more than 256 entries, from the first time that it is passed to any substitute (weakly, with the object), so that later calls with it need not list it again. This does not change which setup a call matches, except as described above for objects that changed after they were used in a setup. When such an object has changed since, a call with it still matches a setup made with an equal object, whether the setup was made before or after the change. Which auto-substitute it gets is not specified: currently a call with that same object gets the one from the earlier call with it, and an equal copy gets a new one. So a setup arranged before the code under test runs works for an object that the code under test builds, also when it passes the object to another substitute on the way:

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// the code under test builds an index, and logs it on the way
function buildIndex(words, logger, search) {
  const index = {}
  for (const word of words) {
    index[word] = true
    if (Object.keys(index).length === 300) logger.debug('index', index)
  }
  return search.load(index)
}

const words = Array.from({ length: 500 }, (_, i) => `word${i}`)
const logger = Substitute.for()
const search = Substitute.for()
search.load(Object.fromEntries(words.map(word => [word, true]))).returns(42)

console.log(buildIndex(words, logger, search)) // prints 42

// a setup made after a wide table changed is matched by copies of it, too
const translations = {}
for (let i = 0; i < 300; i++) translations[`key${i}`] = `text ${i}`

const i18n = Substitute.for()
i18n.load(translations) // the code under test passes the table
translations.key0 = 'changed'
i18n.load(translations).returns('loaded')

console.log(i18n.load(translations)) // prints loaded
console.log(i18n.load({ ...translations }) === 'loaded') // prints true
```

What stays unsupported is changing an argument after the call or setup that it was passed to, as above. That also holds for the auto-substitute that a call returned: once its argument has changed, which auto-substitute a later call gets is not specified. Currently, a call with the same object gets the auto-substitute of the earlier call, a copy of the object gets a new one, and a new array or object around the changed object gets the earlier one when the changed object has more than 256 keys or entries, and a new one otherwise. And a [matcher](#matchers-inside-objects-and-arrays) that you put into an object or array with more than 256 keys or items after it was first passed is not recognised once the search for matchers has remembered it (see [Matchers inside objects and arrays](#matchers-inside-objects-and-arrays)). Passing the same object again always finds what was recorded for it.

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

This also happens when a matcher setup answers a call that leaves out an argument that the matcher accepts as `undefined` (see [How arguments are compared](#how-arguments-are-compared)): after `calculator.multiply(1, Arg.any()).returns(10)`, `calculator.multiply(1)` returns 10, so `calculator.multiply(1).returns(1)` throws a `TypeError`. Likewise, `f()` is the call `f(undefined)`, so `f(undefined).returns(a)` followed by `f().returns(b)` is one call written twice. Make the literal setup first, or use `configure`.

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

```js
const { Substitute, Arg, configure } = require('@fluffy-spoon/substitute')

const calculator = Substitute.for()
calculator.multiply(1, Arg.any()).returns(10)
// multiply(1) leaves out the second argument, which Arg.any() accepts
calculator.multiply(1).returns(1) // throws TypeError: calculator.multiply(...).returns is not a function

calculator[configure]().multiply(1).returns(1)
console.log(calculator.multiply(1)) // prints 1
console.log(calculator.multiply(1, 5)) // prints 10
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

A method of the instance that returns the instance itself, as fluent APIs do (a builder's `return this`, an `EventEmitter`'s `on()` and `once()`, a stream's `setEncoding()`), answers with the substitute instead, and so does a getter or a property of the instance whose value is the instance. So a chain such as `socket.setEncoding('utf8').on('data', onData)` stays on the substitute: each of its calls is recorded, can be checked, and can be configured. The method still runs with the instance as `this`, so the instance changes as it would without the substitute. Only the instance itself is replaced: a promise that resolves to it (an `async` method that returns `this`) and other objects that hold it are returned as they are, and a method called with another `this` (`.call(other)`) returns what it returns.

```js
const { PassThrough } = require('stream')
const { Substitute, Arg, mimick } = require('@fluffy-spoon/substitute')

// the code under test sets up a socket in one chain
const wire = (socket, onData) => socket.setEncoding('utf8').on('data', onData).on('end', () => socket.end())

const real = new PassThrough()
const socket = Substitute.for()
socket[mimick](real)

console.log(wire(socket, () => { }) === socket) // prints true
socket.received(1).setEncoding('utf8')
socket.received(1).on('end', Arg.any())
// the real stream did the work
console.log(real.listenerCount('data')) // prints 1
```

In TypeScript, `[mimick]()` takes a partial instance of an object type, so `client[mimick]({ baseUrl: '' })` compiles for a `Client` that has other members, too. The members of an object literal get their types from the substituted type (`calculator[mimick]({ add: (a, b) => a + b })` types `a` and `b` as numbers), and members that the type does not have, or of another type, are rejected. Function types and other types with call or construct signatures, arrays, tuples and primitives take a whole instance. In generic code, the instance is a `T`: in `function delegate<T>(sub: SubstituteOf<T>, instance: T)`, `sub[mimick](instance)` compiles, and a `Partial<T>` needs a cast to `T`. TypeScript does not accept an object literal for a type that declares a member of `Object.prototype` with another type, such as `Date` with its `valueOf(): number`: `date[mimick]({ getTime: () => 0 })` does not compile, so pass a real instance (`date[mimick](new Date(0))`) or cast.

<!-- docs-check: uses=calculator -->
```typescript
import { mimick } from '@fluffy-spoon/substitute'

interface Client {
  baseUrl: string
  timeout?: number
  get(path: string): Promise<string>
}

const client = Substitute.for<Client>()
client[mimick]({ get: async path => `GET ${path}` })
client.get('/users').then(response => console.log(response)) // prints GET /users

calculator[mimick]({ add: (a, b) => a + b })
console.log(calculator.add(2, 3)) // prints 5

// @ts-expect-error a Client has no member called baseURL
Substitute.for<Client>()[mimick]({ baseURL: '' })
// @ts-expect-error baseUrl is a string
Substitute.for<Client>()[mimick]({ baseUrl: 1 })
```

A substitute that mimicks an object enumerates like it. `Object.keys(sub)`, `Object.entries(sub)`, spread (`{ ...sub }`), `Object.assign({}, sub)` and `for...in` see the instance's enumerable own keys, strings and symbols; its non-enumerable keys are not listed. `Reflect.ownKeys(sub)` lists them, too, followed by `length` and `name`, which are not enumerable and which every substitute has (see [Freezing, defined properties and `in`](#freezing-defined-properties-and-in)); for an instance with an enumerable own `name` or `length`, that key is listed once, with the instance's descriptor. Reading their values goes through the substitute, so setups come first, and the reads are recorded. `Object.getOwnPropertyDescriptor(sub, key)` gives the instance's descriptor (with the value on the instance), with `configurable: true`. `JSON.stringify(sub)` gives what `JSON.stringify(instance)` gives: the result of the instance's own `toJSON()`, or the instance's fields as they are on the instance, without setups and without recording reads. A substitute that mimicks a function lists the function's enumerable own keys as well (its own `length` and `name` stay `0` and `''`), but `JSON.stringify()` gives its printout. Without a mimicked object, a substitute has no enumerable own keys.

```js
const { Substitute, configure, mimick } = require('@fluffy-spoon/substitute')

const config = Substitute.for()
config[mimick]({ port: 80, host: 'localhost' })
config[configure]().host.returns('example.org')

console.log(Object.keys(config)) // prints [ 'port', 'host' ]
console.log(Reflect.ownKeys(config)) // prints [ 'port', 'host', 'length', 'name' ]
console.log({ ...config }) // prints { port: 80, host: 'example.org' }
console.log(JSON.stringify(config)) // prints {"port":80,"host":"localhost"}
config.received(1).port
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

Setups and calls never leak between members: `app.add(1, 2).returns(99)` does not configure `app.getCalculator().add(1, 2)`, and the other way round. `String(app.logger)` and `console.log(app.logger)` show the path of an auto-substitute, `@Substitute.logger`, and what it received and how it is configured (see [Printing a substitute](#printing-a-substitute)).

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

The library tells the two apart by where they happen: the reads and calls before a setup or a check are left out only when they were made in the same file and the same function as the setup or check. (It compares the first stack frame outside the library: the position of the enclosing function, or on Node.js before 14.18 its name.) A call is made where it is invoked, which is not always where the method was read. So:

* A chain written over several lines, or in a helper function of your own, is one setup or check.
* A handle that you store and use in the same function is part of the setup: after `const logger = app.logger` and `logger.level.returns(3)`, the read of `app.logger` is not recorded. The same holds for a method that you read and then call in that function (`const load = app.load` and `load(1).size.returns(3)`).
* A member or call configured to return another substitute counts like an auto-substitute: after `app.getCalculator().returns(calculator)`, the setup `app.getCalculator().add(1, 2).returns(3)` records no call of `getCalculator()`, and after `app.logger.returns(logger)`, the check `app.logger.received(1).info('started')` records no read of `logger`. Reads and calls by the code under test are kept. As with a stored handle, a test that calls `app.getCalculator()` itself and then, in the same function, starts a setup or check from `calculator` with its next use of a substitute leaves that call out. When the configured value is the substitute itself (`map.set(Arg.all()).returns(map)`, a fluent `return this`), nothing is left out: after `map.set('b', 2)` in a test, `map.received(1).set('b', 2)` passes.
* A handle that you get in one function and use in another one keeps the reads that produced it. For example, after `const click = app.handlers.click` in a test, `t.notThrows(() => click.received(1).fire())` runs the check in a callback, so the reads of `handlers` and `click` stay recorded, and `app.didNotReceive().handlers` would fail.
* Calls that the code under test makes in its own functions are kept. That includes calls through a method that the test hands to it, like `new UserService(api.getUser)` or `openWith(driver.connect)`: the call is made where the code under test invokes the method, and its `called at` line in failure messages names that place, not the line of the test that read `api.getUser`. (For a direct call like `api.getUser(1)`, the read and the call are the same place.) This holds also when the code under test invokes the method with the substitute as `this`, like `Reflect.apply(this.fetch, this.client, [id])`, `fetch.call(api, id)` or a wrapper such as `(...args) => Reflect.apply(method, client, args)`: whether a read and a call belong to one expression depends on where they happen, as described here, and `this` plays no part.
* `Reflect.apply()` and a function's `call`, `apply` and `bind` have no stack frame of their own, so in a test, `Reflect.apply(app.getUser, app, [2]).name.returns('bob')` is one setup, like `app.getUser(2).name.returns('bob')`. A method that a built-in function calls itself, like `getUser` in `[1, 2].map(api.getUser)`, is called by that function, not by the test: those calls are kept, also when the test then configures their results, and their `called at` line reads `called at Array.map (<anonymous>)`. (`map` passes the index and the array as well, so these calls are `getUser(1, 0, [1, 2])` and `getUser(2, 1, [1, 2])`.)
* Calls that the code under test makes from a promise job, like `Promise.resolve(id).then(getUser)`, are kept too. Such a call has no stack frame outside the library (the library ignores the `async` frames that V8 adds for the functions awaiting the promise), and a call without a frame is never part of a setup or check that has one.
* Only when neither the call nor the setup or check has a stack frame outside the library does position alone decide: a setup or check right after the call that returned its value, with no other use of a substitute in between, leaves that call out. That happens when V8 collects no stack frames, as with `Error.stackTraceLimit = 0` or a limit that V8 cannot use, and when the library cannot read them because `Error.prepareStackTrace` cannot be replaced for a moment, for example when `Error` is frozen (see below).

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// the code under test calls the function that it is given
class UserService {
  constructor(fetchUser) {
    this.fetchUser = fetchUser
  }

  load(id) {
    return this.fetchUser(id)
  }
}

const api = Substitute.for()
const user = new UserService(api.getUser).load(1)
user.name.returns('ann')

console.log(user.name) // prints ann
api.received(1).getUser(1)
api.didNotReceive().getUser(1) // throws SubstituteException
```

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

// the code under test calls the method with the client as `this`
class Loader {
  constructor(client, fetch) {
    this.client = client
    this.fetch = fetch
  }

  load(id) {
    return Reflect.apply(this.fetch, this.client, [id])
  }
}

const api = Substitute.for()
const user = new Loader(api, api.getUser).load(1)
user.name.returns('ann')
api.received(1).getUser(1)
api.didNotReceive().getUser(1) // throws SubstituteException

// Array.prototype.map calls getUser, so these calls are kept
const users = [1, 2].map(api.getUser)
users[1].name.returns('bob')
console.log(users[1].name) // prints bob
api.received(3).getUser(Arg.all())

// in the test, Reflect.apply() is part of the setup
const app = Substitute.for()
Reflect.apply(app.getUser, app, [2]).name.returns('bob')
console.log(app.getUser(2).name) // prints bob
app.received(1).getUser(2)
```

```js
const { Substitute, received } = require('@fluffy-spoon/substitute')

// the code under test calls getUser from a promise job
const loadUser = (getUser, id) => Promise.resolve(id).then(getUser)

async function test() {
  const getUser = Substitute.for()
  const user = await loadUser(getUser, 1)
  user.name.returns('ann')

  console.log(user.name) // prints ann
  getUser[received](1)(1)
}
test()
```

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

// the code under test
const total = app => app.getCalculator().add(1, 2)

const app = Substitute.for()
const calculator = Substitute.for()
app.getCalculator().returns(calculator)
// getCalculator() answers with a substitute, so this is one setup
app.getCalculator().add(1, 2).returns(3)

console.log(total(app)) // prints 3
app.received(1).getCalculator()
calculator.received(1).add(1, 2)

// a fluent method that returns the substitute itself
const map = Substitute.for()
map.set(Arg.all()).returns(map)
console.log(map.set('b', 2) === map) // prints true
map.received(1).set('b', 2)
```

To read the stack frames, the library replaces `Error.prepareStackTrace` for a moment and then restores the exact property it found, so formatters such as `source-map-support` and `stack-chain` stay installed, and `Error.stack` stays a string. If the property cannot be replaced, the library reads no frames, and position alone decides, as above, although failure messages still have their `called at` lines. That is the case for:

* a non-configurable, non-writable value. `Object.freeze(Error)` makes one on Node.js 20.20 and newer, where `Error` has an own `prepareStackTrace` (Node.js' own formatter);
* a missing property that cannot be added. On Node.js before 20.20, `Error` has no own `prepareStackTrace` unless a formatter installed one, so there `Object.freeze(Error)`, `Object.seal(Error)` and `Object.preventExtensions(Error)` all keep the library from reading frames. (On Node.js 20.20 and newer, a sealed or non-extensible `Error` keeps its writable `prepareStackTrace`, so the library reads frames.);
* a non-configurable accessor, which `stack-chain` defines when `Error.prepareStackTrace` is not already an own configurable property of `Error` when `stack-chain` loads (for example on Node.js 18; on Node.js 20.20, 22, 24 and 26 it is one, so the library reads frames there).

While it captures a stack, the library also lowers `Error.stackTraceLimit` to 1 for a moment, where it can, and then restores it. It never defines or deletes the property, and leaves it as it found it. When the limit is a number of at least 1 that cannot be lowered, because the property is read-only or `Error` is frozen, each operation captures as many frames as the limit says, which is a little slower. When V8 collects no stack frames for any error, the library captures none either: with a limit that is an accessor (with or without a setter), that is missing (deleted), that is not a number (for example a string), or that is below 1, as with `Error.stackTraceLimit = 0`. Failure messages then have no `called at` lines, and position alone decides.

```js
// for example in a hardened environment
Object.freeze(Error)
const { Substitute } = require('@fluffy-spoon/substitute')

const calculator = Substitute.for()
calculator.add(1, 2).returns(3)
console.log(calculator.add(1, 2)) // prints 3
calculator.received(2).add(1, 2) // throws SubstituteException
console.log(Error.stackTraceLimit) // prints 10

// the library cannot read frames, so position decides: the setup right after
// openConnection() leaves the call out (see the example at the top of this section)
function openConnection(driver) {
  return driver.connect('db://test')
}
const driver = Substitute.for()
const connection = openConnection(driver)
connection.isOpen.returns(true)
driver.didNotReceive().connect('db://test')
driver.received(1).connect('db://test') // throws SubstituteException
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

A check needs a call or a member after it. A check that nothing follows, such as `next.didNotReceive()` or `sub[received](2)` as a statement, checks nothing, so it is reported as a `SubstituteException`. The library cannot know right away whether something will follow, so the report comes later, from a microtask, like the [assertions that fail later](#assertions-that-fail-later), and its stack points at the line of the check (with one exception for checks written with the symbols, below). The message says how to complete it: `@Substitute.received(2) checked nothing: it was not followed by a call or a member. Complete the check: sub.received(2)(Arg.all()) checks the calls of the substitute itself, sub.received(2).member(...) the calls of one of its members, and sub.received(2).member its property reads.` For the string forms, a hint for types with a member called `received` or `didNotReceive` of their own follows. A nested substitute is named by its path (`@Substitute.logger.received()`), and `received(0)` is reported as `didNotReceive()`.

A check is complete when it is used before that microtask runs: by a member access, an assignment, a call or `new`. So a helper that returns `sub.received(1)` for its caller to complete is fine. Printing a check (`String()`, `util.inspect()`), `await`ing it, `key in check` and `Object.keys(check)` do not complete it, and neither does a member access after an `await`. (On Node.js 10, `util.inspect()` reads the `constructor` of a check, which makes it a property check of a member called `constructor`, so it throws a `SubstituteException` there.) `Object.freeze()`, `Object.seal()`, `Object.preventExtensions()` and `Object.defineProperty()` on a symbol-form check (`sub[received]()`, `sub[didNotReceive]()`) or on the [`configure`](#re-configuring-a-call-configure) view throw a `SubstituteException` that names the operation, and that check is not reported later. On the string forms (`sub.received(1)`, `sub.didNotReceive()`), which may be a call of a member of your own, they act on the auto-substitute of that call and succeed (it is frozen, or the property is defined on it), and the check is reported later as one that checks nothing. The string forms `sub.received(...)` and `sub.didNotReceive(...)` can also be a member of the substituted type that is called, so some of them are not reported; see [In JavaScript](#in-javascript).

Each check that nothing follows is reported, also when the same check is made again, and completed, before the microtask runs: after `calculator.didNotReceive()` as a statement, a later `calculator.didNotReceive().add(3, 4)` does not hide it, and the report points at the line of the first. A string-form check hands out the same auto-substitute each time it is made with the same arguments (see [Auto-substitutes](#auto-substitutes-and-nested-members)), so each use of that auto-substitute completes one of the open checks that handed it out: the one made last. A check that is used is therefore never reported. One case slips through: a string-form check stored in a variable and used twice (`const check = sub.received(1); check.a(); check.b()`) uses up the report of an earlier `sub.received(1)` that nothing follows, which is then not reported. The symbol forms are tracked exactly, one report for each check.

When a matcher in the arguments of a call of the check itself throws its `TypeError` for invalid use, as in `listener.received(1)(Arg.any('String'))`, `listener.didNotReceive()(Arg.is('x'))` or `sub.member.received(1)(Arg.is('bad'))`, that `TypeError` is the only error: no report that the check checked nothing follows. The rule is the one for property-style checks in [Assertions that fail later](#assertions-that-fail-later): the matcher is called on the same line as the check, after it, in the same function.

To report it, a check records where it was made. The string forms (`sub.received(n)`, `sub.didNotReceive()`) always do. Of the checks written with the symbols (`sub[received](n)`, `sub[didNotReceive]()`), only the first 1,000 in one synchronous run (until the microtask that reports them runs) record it, because that is most of what such a check costs, and a loop that makes thousands of them pays for the first ones only. A symbol-form check after those that nothing follows is still reported, with the same message, but its stack has no line of the test, as with `Error.stackTraceLimit = 0`, and a matcher that throws its `TypeError` for invalid use in its own arguments (`sub[received](1)(Arg.any('String'))`) does not cancel its report. The next synchronous run starts again with 1,000.

<!-- docs-check: uses=calculator uncaught=SubstituteException -->
```typescript
calculator.add(1, 2)

// a helper that returns a check for its caller to complete
const receivedOnce = () => calculator.received(1)
receivedOnce().add(1, 2)

// nothing follows: reported later, from a microtask
calculator.didNotReceive()
// a complete check of the same form does not hide that report
calculator.didNotReceive().add(3, 4)
```

```js
const { Substitute, Arg, received } = require('@fluffy-spoon/substitute')

const listener = Substitute.for()
listener('saved')
// the matcher throws for invalid use; the check is not reported later as one that checks nothing
listener.received(1)(Arg.any('String')) // throws TypeError
listener[received](1)(Arg.any('Strin')) // throws TypeError
listener.received(1)('saved')
```

A failed check describes what was expected and lists the calls that were received: at most 50 of them, and no more once the listed calls take 20,000 characters. A list that leaves some calls out ends with `› … and N more`. Each argument is printed within bounds (see [Printing a substitute](#printing-a-substitute)). For example:

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

The `called at` lines are stack frames, formatted by Node.js like any stack trace. Each recorded read or call captures its stack once, and Node.js formats the text only when a message shows it. So source maps apply: with `node --enable-source-maps`, jest with `ts-jest`, vitest (also in its `vm` pools) and `tsx`, they name the lines of your TypeScript source. A formatter installed as `Error.prepareStackTrace` formats them, too: the one in place when the message is made. (If it was removed by then, the lines of property reads in a chain, like `app.config` in `app.config.get('x')`, can still come from the last formatter the library saw.) A call through a method reference is shown where it was invoked; see [Which calls lead to a setup or a check](#which-calls-lead-to-a-setup-or-a-check).

When the member was never used at all, the check fails as soon as it reads the member, before the arguments are known, so the message cannot name them: `Expected to receive 1 or more property reads or method calls matching add, but received none.` Once the method has been called, the message names the expected arguments, as above.

A method that was read but never called fails a method check right away, whatever the count, with the reads listed and a hint:

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

So does a check that expects fewer calls than there were reads, as for code under test that looks at a callback before it uses it. For `didNotReceive()` and `received(0)`, the reads are what fails the check, so they are marked `✔`, and the hint ends with how to reset them (see the known issue in [What counts as a call](#what-counts-as-a-call)).

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// the code under test reads the callback twice, and never calls it
const finish = options => {
  if (typeof options.onDone === 'function') {
    const done = options.onDone
  }
}

const options = Substitute.for()
finish(options)
options.received(1).onDone('ok') // throws SubstituteException: Expected to receive 1 property read or method call matching onDone, but received 2 property reads and no method calls.
```

Every substitute prints as `@Substitute`, so when the code under test passes another substitute than the one a check expects, the expected call and the received one can print alike. Then the message numbers the substitutes in the order in which they appear in it, an auto-substitute with the number of the substitute it belongs to (`@Substitute#3.handler`), and its last line says so. The numbers hold only within that message, and only messages whose expected call (or assignment) prints like a listed call that it does not match, and that show more than one substitute, have them. Other messages, printouts and snapshots show `@Substitute`. Whether two lines print alike is decided as for printing them deeper (see below): a matcher in the expected call stands for the value that the listed call was given, and orders that matching ignores, such as the order of keys, do not count. So a check with a matcher for a generated id is numbered, too (the second example below), and so is one whose object the code under test builds as `{ ...input, id }`. A listed call that differs only where the expected call has a matcher that it does not match is not numbered when the substitutes are the same. The substitutes of another copy of the package are numbered along with the others, when both copies are this version or newer (see [The symbol API](#the-symbol-api)).

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// the code under test mounts the wrong handler
const mount = (app, handlers) => app.use('/admin', handlers.public)

const app = Substitute.for()
const adminHandler = Substitute.for()
const publicHandler = Substitute.for()
mount(app, { admin: adminHandler, public: publicHandler })
app.received(1).use('/admin', adminHandler) // throws SubstituteException
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute#1.use:
Expected to receive 1 method call matching use('/admin', @Substitute#2), but received none.
All property or method calls to @Substitute#1.use received so far:
› ✘ @Substitute#1.use('/admin', @Substitute#3)
    called at mount (test/app.test.js:4:41)
The substitutes are numbered in this message (@Substitute#1, @Substitute#2, ...) to tell them apart.
```

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const bus = Substitute.for()
const app = Substitute.for()
const plugin = Substitute.for()
// the code under test subscribes the plugin's handler, with an id that it generates
bus.subscribe({ id: 'sub-81f3', handler: plugin.onEvent })

bus.received(1).subscribe({ id: Arg.any('string'), handler: app.onEvent }) // throws SubstituteException: matching subscribe({ id: Arg.any{string}, handler: @Substitute#2.onEvent }), but received none.
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute#1.subscribe:
Expected to receive 1 method call matching subscribe({ id: Arg.any{string}, handler: @Substitute#2.onEvent }), but received none.
All property or method calls to @Substitute#1.subscribe received so far:
› ✘ @Substitute#1.subscribe({ id: 'sub-81f3', handler: @Substitute#3.onEvent })
    called at Object.<anonymous> (test/bus.test.js:7:5)
The substitutes are numbered in this message (@Substitute#1, @Substitute#2, ...) to tell them apart.
```

Arguments are printed two levels deep (see [Printing a substitute](#printing-a-substitute)), and so is the value of an assignment. When the expected call and a received one that it does not match would still print alike, because they differ further down, as filters of an ORM often do, the message prints the expected line and those received lines deeper: at the least depth, up to four levels, at which they print differently. A matcher in the expected call does not count as a difference here: it prints by its label, such as `Arg.any{string}`, where the received call shows the value that it was given. So a check with a matcher for a generated id, a timestamp or a callback is printed deeper, too, when the calls differ further down somewhere else (the second example below), also inside a `Map` or a `Set`: `save(Arg.any{string}, { order: { meta: { tags: Set(1) { 'express' } } } })` against `@Substitute.save('ord-1', { order: { meta: { tags: Set(1) { 'gift' } } } })`. Neither does an order that matching ignores: the order of keys, as in an object that the code under test builds as `{ ...input, id }` (the third example below), the order of the entries of a `Map` or a `Set` built in another order, such as a `Set` of tags or a `Map` of headers made from `Object.entries()` (the fourth example below), the order of the own properties of an error or a function, and such orders inside them, such as the keys of an object held by an error's property or `cause`, or of the objects in a `Set`. Such lines are printed as deep as a difference further down needs, each with its keys and entries in its own order. Received lines that print differently two levels deep in another way stay two levels deep, and so do lines that differ only where the expected call has a matcher that they do not match: for an expected `f(Arg.is{n => n > 5}, { a: { b: { c: [Object] } } })`, a received `f(3, { a: { b: { c: [Object] } } })` with the same object. A matcher inside a `Map`, a `Set` or a class instance is a value, as when matching (see [Matchers inside objects and arrays](#matchers-inside-objects-and-arrays)), so it is a difference there: `f(Arg.any{any}, Map(1) { 'k' => Arg.any{any} })` against `@Substitute.f('x', Map(1) { 'k' => 1 })` stays two levels deep. Calls that differ only deeper than four levels print alike, two levels deep. To find the depth, the message compares the values themselves, as printing shows them: the keys of objects, in any order; the items of arrays, and their other keys, such as the `total` of an array of rows or the `index` and `input` of a `RegExp` match; the size, the first 20 entries (in any order: the entries of a `Map` by their keys and then their values, the other entries as a multiset of their printed texts) and the other keys of `Map`s and `Set`s; the part of a long string that is shown; errors and functions with properties by their printed text, with their properties and everything inside them in a fixed order; and other values, such as typed arrays, `Date`s and objects that print themselves, by their printed text, depth by depth. Only the first 20 entries of a `Map` or a `Set` are compared, and a value whose printed text is cut after 1,000 characters counts as different when only its order differs. On Node.js 10.0 to 10.11, whose `util.inspect()` cannot sort, an order inside the properties of errors and functions, or inside the members of a `Set`, still counts as a difference. It looks at no more than 2,000 objects, keys, items and entries for all the lines of the message (lines that differ only in the order of their keys are compared last, with what is left), and the lines that come after that are printed as deep as the lines before them, with or without a matcher in the expected call: without a matcher, those that print like the expected call two levels deep; with a matcher, the message cannot tell which of them already print differently, so all of them. Matchers in the expected call are shown by their own label at any depth, with the objects and arrays that hold them, and when a matcher is deeper than two levels, the received calls that it does not match are printed as deep as the object that holds it (at most four levels), so they show the value that the matcher was given: for an expected `{ a: { b: { c: { d: Arg.is{value => value > 5} } } } }`, a received call shows `{ a: { b: { c: { d: 1, e: [Object] } } } }`. The numbering of substitutes goes by the lines as printed, so two calls that differ only in which substitute sits inside a cut-off object (`use({ a: { b: { c: [Object] } } })`) print alike and are not numbered. `util.inspect()` puts at most 80 characters and three levels of nested objects on one line, so the lines printed deeper span several lines, as below.

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const prisma = Substitute.for()
// the code under test
prisma.user.findMany({ where: { AND: [{ email: { contains: 'ann' } }] } })

prisma.user.received(1).findMany({ where: { AND: [{ email: { contains: 'bob' } }] } }) // throws SubstituteException
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute.user.findMany:
Expected to receive 1 method call matching findMany({
  where: {
    AND: [ { email: { contains: 'bob' } } ]
  }
}), but received none.
All property or method calls to @Substitute.user.findMany received so far:
› ✘ @Substitute.user.findMany({
  where: {
    AND: [ { email: { contains: 'ann' } } ]
  }
})
    called at Object.<anonymous> (test/users.test.js:5:13)
```

With a matcher for an id that the code under test generates, the lines differ only further down elsewhere, so they are printed deeper as well:

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const users = Substitute.for()
// the code under test saves a user with a generated id
users.save({ id: 'u-81f3', profile: { address: { geo: { lat: 59.9, lng: 10.7 } } } })

users.received(1).save({ id: Arg.any('string'), profile: { address: { geo: { lat: 60.4, lng: 5.3 } } } }) // throws SubstituteException
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute.save:
Expected to receive 1 method call matching save({
  id: Arg.any{string},
  profile: { address: { geo: { lat: 60.4, lng: 5.3 } } }
}), but received none.
All property or method calls to @Substitute.save received so far:
› ✘ @Substitute.save({
  id: 'u-81f3',
  profile: { address: { geo: { lat: 59.9, lng: 10.7 } } }
})
    called at Object.<anonymous> (test/users.test.js:5:7)
```

With an object that the code under test builds from its input, whose keys come in another order:

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const users = Substitute.for()
// the code under test adds a generated id to its input
const input = { name: 'Ann', address: { geo: { point: { lat: 59.9, lng: 10.7 } } } }
users.save({ ...input, id: 'u-81f3' })

users.received(1).save({ id: Arg.any('string'), name: 'Ann', address: { geo: { point: { lat: 60.4, lng: 5.3 } } } }) // throws SubstituteException
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute.save:
Expected to receive 1 method call matching save({
  id: Arg.any{string},
  name: 'Ann',
  address: { geo: { point: { lat: 60.4, lng: 5.3 } } }
}), but received none.
All property or method calls to @Substitute.save received so far:
› ✘ @Substitute.save({
  name: 'Ann',
  address: { geo: { point: { lat: 59.9, lng: 10.7 } } },
  id: 'u-81f3'
})
    called at Object.<anonymous> (test/users.test.js:6:7)
```

With a `Set` whose entries come in another order:

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const posts = Substitute.for()
// the code under test collects the tags in the order in which it finds them
posts.publish({ id: 'p1', tags: new Set(['news', 'tech']), author: { profile: { address: { city: 'Oslo' } } } })

posts.received(1).publish({ id: 'p1', tags: new Set(['tech', 'news']), author: { profile: { address: { city: 'Bergen' } } } }) // throws SubstituteException
```

<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute.publish:
Expected to receive 1 method call matching publish({
  id: 'p1',
  tags: Set(2) { 'tech', 'news' },
  author: { profile: { address: { city: 'Bergen' } } }
}), but received none.
All property or method calls to @Substitute.publish received so far:
› ✘ @Substitute.publish({
  id: 'p1',
  tags: Set(2) { 'news', 'tech' },
  author: { profile: { address: { city: 'Oslo' } } }
})
    called at Object.<anonymous> (test/posts.test.js:5:7)
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

Assigning a property is recorded, but it does not change what the property reads, unlike NSubstitute's auto-properties: after `settings.mode = 'HEX'`, `settings.mode` is still an auto-substitute, and after `settings.mode.returns('DEC')` and `settings.mode = 'BIN'`, it is still `'DEC'`. Configure the value with `returns()`, or mimick a plain object (`client[mimick]({ baseUrl: '' })`, which compiles in TypeScript, too, as a partial instance; see [Partial mocks](#partial-mocks)): assignments then write to that object, and reads give the value back. Both are still recorded.

```js
const { Substitute, mimick } = require('@fluffy-spoon/substitute')

const settings = Substitute.for()
settings.mode.returns('DEC')
settings.mode = 'BIN' // the code under test assigns the property
console.log(settings.mode) // prints DEC
settings.received(1).mode = 'BIN'

const client = Substitute.for()
client[mimick]({ baseUrl: '' })
client.baseUrl = 'https://api'
console.log(client.baseUrl) // prints https://api
client.received(1).baseUrl = 'https://api'
client.received(1).baseUrl
```

In TypeScript, assigning a property on the substitute itself (`calculator.isEnabled = true`) does not compile, see [Typing limitations](#typing-limitations). The code under test assigns through its own type, like `toggle` above. In a check, read-only properties can be assigned, and optional properties that are not functions accept `undefined` (`form.received().note = undefined`). An optional callback (`onChange?: (value: string) => void`) does not; see [Typing limitations](#typing-limitations) for how to check that it was cleared.

## What counts as a call
* Every invocation is a call of its own, also through a stored or destructured reference or a callback.
* `new` is a call, too: `new sdk.Client('https://api')` counts as a call `Client('https://api')` (see [Creating a substitute](#creating-a-substitute)).
* A call that leaves out arguments at the end is a call with `undefined` there: `f(1)` and `f(1, undefined)` count as the same call (see [How arguments are compared](#how-arguments-are-compared)).
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

**Known issue in 2.0.1:** `didNotReceive().subtract(...)` (or `received(0)`) on a method that has been read but never called fails, because the library decides at `.subtract` whether you check a property read or a method call. The message says so: `Expected to receive 0 property reads or method calls matching subtract, but received 1 property read and no method calls.`, followed by a hint that ends with `Call sub[clearReceivedCalls]() after the arrange step to reset the reads.` If the code under test registers a method without calling it, clear the received calls after that (see below) before you check that it was not called.

<!-- docs-check: uses=calculator -->
```typescript
import { clearReceivedCalls } from '@fluffy-spoon/substitute'

// the code under test registers a handler, which never fires
const register = (c: Calculator) => c.subtract
register(calculator)

calculator.didNotReceive().subtract(Arg.all()) // throws SubstituteException: Expected to receive 0 property reads or method calls matching subtract, but received 1 property read and no method calls.
calculator[clearReceivedCalls]()
calculator.didNotReceive().subtract(Arg.all())
```

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
Checks throw right away, with two exceptions. One is a check that nothing follows, like `sub.didNotReceive()` as a statement, which checks nothing (see [received and didNotReceive](#received-and-didnotreceive)). The other is a property-style check, `sub.received(count).member` or `sub.didNotReceive().member` that is not followed by a call, on a member that has been called as a method. The library cannot know yet whether you are about to call it (`sub.received(2).member(...)`), so it reports the failure later, from a microtask (`queueMicrotask`; `process.nextTick` on Node.js 10, which has no `queueMicrotask`), and cancels the report if you call the member. There are two cases:

* The property check fails, as in `calculator.received(2).add` below.
* `didNotReceive().member` or `received(0).member` on a member that was only called, never read: it would pass as a property check, but the parentheses were probably forgotten. The report says so: `Expected to receive 0 property reads or method calls matching add, but received 1 method call. add was called 1 time as a method; to assert calls, invoke it: sub.didNotReceive().add(...)`.

Such a failure escapes `try`/`catch` and `t.throws()`: it is an uncaught exception, thrown from a microtask once the current synchronous code has finished. Its stack has one frame, the line of the check. (So does the report of a check that nothing follows, except for a check written with the symbols after the first 1,000 of a synchronous run; see [received and didNotReceive](#received-and-didnotreceive).) The reports of one synchronous run are thrown one per microtask, in the order of the checks.

<!-- docs-check: uses=calculator uncaught=SubstituteException -->
```typescript
calculator.add(1, 2)
calculator.add(1, 2)
calculator.add(3, 4)

// not followed by a call, so the library cannot decide yet:
// the SubstituteException is thrown later, from a microtask
calculator.received(2).add
```

<!-- docs-check: uses=calculator uncaught=SubstituteException -->
```typescript
calculator.add(1, 2)

// the parentheses are missing: reported later, from a microtask
calculator.didNotReceive().add
```

To avoid this, check methods with a call (`calculator.received(2).add(1, 2)`, or `.add(Arg.all())`). Those are decided right away.

When a matcher in such a check throws its `TypeError` for invalid use, as `Arg.any('String')` and `Arg.is('x')` do, that `TypeError` is the only error: `calculator.received(2).add(Arg.any('String'), 1)` reports nothing later. The library takes a matcher for a part of the check when it is called on the same line as the member is read, after it, in the same function. That includes a chain over several lines whose arguments start on the line of the member (`.add(Arg.any('String'), 1)`). A check whose arguments start on a later line than the member (`.add(` and then, on the next line, `Arg.any('String'), 1)`), or a run without stack traces (`Error.stackTraceLimit = 0`), reports both: the `TypeError` right away, and the check later. A matcher that throws anywhere else never cancels the report of an earlier check: in a later statement, or in another function (also on the same line, such as `expect(() => Arg.any('Strin')).toThrow()`). Only a statement after the check on the same line, in the same function, cannot be told apart from the check itself: `void s.didNotReceive().m; Arg.any('Strin')` on one line reports only the `TypeError`. The same rule decides for a check that is called itself, such as `listener.received(1)(Arg.any('String'))` (see [received and didNotReceive](#received-and-didnotreceive)), and there, too, a statement after the check on the same line counts as part of it: `s[received](1); try { Arg.any('x') } catch { }` on one line is not reported as a check that checks nothing.

<!-- docs-check: uncaught=SubstituteException -->
```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const sub = Substitute.for()
sub.m(1)
void sub.didNotReceive().m // reported later: m was called as a method
try { Arg.any('Strin') } catch { } // a usage error in another statement does not cancel that report
```

Every test runner fails the run, but not all of them can tie the failure to the test, and two of them stop running tests. Seen with jest 29.7 and 30.5, vitest 5.1, ava 6.4, mocha 12.0 and node:test on Node.js 22, 24 and 26; the [compatibility checks](#test-runners) pin this for jest 30, vitest, ava, mocha and node:test on every change, with passing tests before and after the failing one (and, for mocha and ava, a second test file):

* jest 29, and jest 30 on Node.js 24 and newer: as the failure of the running test (`● <test name>`). The other tests and test files still run and are reported, in band and with workers.
* jest 30 on Node.js 22: as a failure of the test file ("Test suite failed to run"). The other tests in the file still run and pass, and the run fails. (Node.js 22 loses the test context that jest 30 looks up for an exception thrown from a microtask.)
* vitest: every test runs and is listed as passed, and the run fails with one error: an "Unhandled Errors" entry with the `SubstituteException`, which names the test ("The last test to run before this error was ..."). This holds with `vi.useFakeTimers()` and in the `vm` pools, too.
* node:test: every test runs and passes, and the test file fails ("A resource generated asynchronous activity after the test ended", with the `SubstituteException`).
* mocha: the test is listed as passed (`✔ <test name>`) and then as failed (`1) <test name>`, with "Uncaught SubstituteException"), so the summary counts it both as passing and as failing. **Then mocha stops the run:** the tests after it in the same file, and every test in later files, do not run and are not listed. The run exits with a non-zero code. mocha marks a synchronous test as passed as soon as it returns, so no other way of reporting the failure later could change this.
* ava: `Uncaught exception in <file>` with the `SubstituteException`, the failing test listed as passed (`√ <test name>`), `× <file> exited with a non-zero exit code: 1`, and "1 uncaught exception" in the summary. **ava ends the worker of that test file:** the tests of that file that had not finished are not reported at all. ava runs the tests of a file concurrently, so this includes `async` tests written before the failing one. Tests in other files, which run in other workers, are reported as usual. The run exits with a non-zero code.
* Plain Node.js prints the uncaught exception and exits with code 1.

With mocha and ava, a check that fails later can therefore hide the results of other tests, including other failures. Fix it first, or avoid it altogether by checking methods with a call, as above.

The report is scheduled with the `queueMicrotask` that the library found when it was loaded, so fake timers that are installed later, such as `jest.useFakeTimers()` or `vi.useFakeTimers()` in a test, or `@sinonjs/fake-timers` faking `queueMicrotask` and `nextTick`, do not delay or swallow it. Fake timers that replace `queueMicrotask` before the library is loaded, for example jest's `fakeTimers: { enableGlobally: true }` configuration or a setup file that installs them before the library is imported, can delay the report until the fake clock runs its microtasks.

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

With a constrained type parameter, such as in a helper or a test fixture written for every `T extends Calculator`, setups, checks and the `configure` view work through the constraint, also for keys that exist only through the constraint's string index signature, and the values they take are checked against the constraint's member types. [Typing limitations](#typing-limitations) lists the exceptions: optional and nullable members on TypeScript older than 4.8, methods whose return type differs between the variants of a union constraint (and, on TypeScript 5.4 and newer, methods that they declare with different parameter lists), checks of sets of keys that exist only through an index signature, and `.resolves()` on promise-typed properties.

```typescript
import { Substitute, SubstituteOf, Arg, configure } from '@fluffy-spoon/substitute'

interface Calculator {
  add(a: number, b: number): number
  total: number
}

interface ScientificCalculator extends Calculator {
  sqrt(x: number): number
}

class CalculatorFixture<T extends Calculator> {
  readonly calculator: SubstituteOf<T> = Substitute.for<T>()

  arrange() {
    this.calculator.add(Arg.all()).mimicks((a, b) => a + b)
    this.calculator.total.returns(10)
    this.calculator[configure]().add(0, 0).returns(-1)
  }

  verifyAdded(a: number, b: number) {
    this.calculator.received(1).add(a, b)
  }
}

const fixture = new CalculatorFixture<ScientificCalculator>()
fixture.arrange()
fixture.calculator.sqrt(4).returns(2)

console.log(fixture.calculator.add(1, 2)) // prints 3
console.log(fixture.calculator.add(0, 0)) // prints -1
console.log(fixture.calculator.total + fixture.calculator.sqrt(4)) // prints 12
fixture.verifyAdded(1, 2)
```

`clearReceivedCalls`, `mimick` and `configure` exist only as symbols, so members with those names never conflict.

## In JavaScript
Without types, the library decides by how a name is used:

* `sub.received(...)` and `sub.didNotReceive()` are checks when they are called and followed by a member, like `sub.received(2).add(1, 2)`. Followed by `.returns()`, `.throws()`, `.resolves()`, `.rejects()` or `.mimicks()`, they configure a member of your own called `received` or `didNotReceive`.
* Called and followed by nothing, as a statement like `next.didNotReceive()` or `res.received(2)`, they are reported as a check that checks nothing (see [received and didNotReceive](#received-and-didnotreceive)), unless the call is most likely one of a member of your own: when its arguments are not those of a check (`received` with more than one argument, or with anything but a non-negative integer, and `didNotReceive` with any argument, as in `mailbox.received(new Date(0))`), when a setup or a mimicked instance answers it (`sub.received(1).returns(2)` and then `sub.received(1)`), or when, by the time the report would be made, the member has a setup or a check has named it as a member (`sub[received](1).received(10)`). Such a call is recorded as a call of the member, as always. The report's message adds how to keep such calls from being taken for checks: configure them, as below.
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

These rules are applied at runtime, so they apply to the code under test as well, in TypeScript as in JavaScript, whatever its types say. When the code under test calls a member called `received` (or `didNotReceive`) of a substitute and then uses a member of the result, the library takes it for a check, unless that call is configured: `mailbox.received(new Date(0)).filter(mail => !mail.read)` throws `SubstituteException: Expected count has to be a non-negative integer (or omitted for "1 or more"), but received 1970-01-01T00:00:00.000Z.` Configure every call that the code under test can make, for example `mailbox[configure]().received(Arg.any()).returns([])`, or mimick an instance (`mailbox[mimick](realMailbox)`), and check those calls with the symbol: `mailbox[received](1).received(Arg.any())`. A setup for other arguments only (`mailbox[configure]().received(new Date(1)).returns([])`) does not help a call with another date.

```js
const { Substitute, Arg, configure, received } = require('@fluffy-spoon/substitute')

// the code under test calls the mailbox's own `received(since)` method
const unread = (mailbox, since) => mailbox.received(since).filter(mail => !mail.read)

const unconfigured = Substitute.for()
unread(unconfigured, new Date(0)) // throws SubstituteException: Expected count has to be a non-negative integer

const mailbox = Substitute.for()
mailbox[configure]().received(Arg.any()).returns([{ read: false }, { read: true }])
console.log(unread(mailbox, new Date(0)).length) // prints 1
mailbox[received](1).received(Arg.any())
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
| `mimick` | `sub[mimick](instance)` | Symbol only. In TypeScript, a partial instance of an object type is enough. See [Partial mocks](#partial-mocks). |
| `configure` | `sub[configure]().member...` | Symbol only. See [Re-configuring a call](#re-configuring-a-call-configure). |
| `returns`, `throws`, `resolves`, `rejects`, `mimicks` | `sub.member(...)[returns](value)`, `sub.property[throws](error)` | The same as the string methods. They configure a member or a call, so using them on the substitute itself (`sub[returns](1)`) is an error. |

The symbols are registered with `Symbol.for()`, so they also work when two copies of the package are installed, or loaded twice, as after `jest.resetModules()`.

Substitutes of two such copies work together as well. A substitute of one copy among the arguments of a substitute of the other is shown by its path in failure messages and printouts, `use(@Substitute)` or `use(@Substitute.child)`, as a substitute of the same copy is, and a failure message that numbers its substitutes numbers those of both copies (see [received and didNotReceive](#received-and-didnotreceive)): with `app` from one copy and `plugin` from the other, after `app.events.subscribe(plugin.handler)`, `app.events.received(1).subscribe(app.handler)` expects `subscribe(@Substitute#1.handler)` and lists `@Substitute#1.events.subscribe(@Substitute#2.handler)`. For that, the copies share one object: an object on the global object, under the registered symbol `Symbol.for('@fluffy-spoon/substitute:guard')` (not enumerable), which the first copy creates and the others find. It says when any of them prints or compares values, and it holds the numbers of the message being built. (A copy of a development build made before this version leaves the substitutes of its own unnumbered.) So the reads that Node.js makes while one copy prints or compares an object that inherits from a substitute of the other, such as an instance of `class Plugin extends sdk.Base` (Node.js looks for `href`, `protocol` and `auth`), are not recorded on that substitute, as with one copy (see [Classes that extend a substitute](#classes-that-extend-a-substitute)). Where the global object cannot take that property, because it is frozen, sealed or not extensible, each copy keeps such an object of its own: then such reads are recorded, a substitute of the other copy is printed in full, with its calls and setups, and it is not numbered.

# Special members
A few members are handled by the substitute itself and cannot be configured or checked:

* `then` is always `undefined`, so a substitute is not a thenable. You can return it from an `async` function or `await` it, and you get the substitute back. In TypeScript, a member called `then` is typed `never`.
* `util.inspect.custom`: `util.inspect(sub)` and `console.log(sub)` show the substitute's setups and received calls (see [Printing a substitute](#printing-a-substitute)).
* `toJSON`: `JSON.stringify(sub)` gives the same text. A substitute that mimicks an object gives what `JSON.stringify(instance)` gives instead: the result of the instance's own `toJSON()`, or its fields (see [Partial mocks](#partial-mocks)).
* `Symbol.toPrimitive`: converting a substitute to a primitive, as `String(sub)`, template strings, `+`, `==` and comparisons do, gives the same text as well, unless `toString()` or `valueOf()` is configured or mimicked (see below).

```typescript
import { Substitute } from '@fluffy-spoon/substitute'

interface Calculator { add(a: number, b: number): number }

const calculator = Substitute.for<Calculator>()
async function load() { return calculator }
load().then(loaded => console.log(loaded === calculator)) // prints true
```

When the substitute configures `toString()` or `valueOf()`, or mimicks an object that has them, converting it to a primitive follows JavaScript's rules instead of giving the printout. A mimicked instance's own `Symbol.toPrimitive`, such as a `Date`'s, is used as it is. Otherwise, `toString()` and `valueOf()` are tried in the order that the conversion asks for: `toString()` first for template strings and `String()`, `valueOf()` first for `+`, `==` and comparisons. Each of them counts only when a call setup matches `()`, a property setup gives a function, or the mimicked instance has a method of its own (not the one of `Object.prototype` or `Function.prototype`), and the first one that gives a primitive wins. When none does, as with a setup for other arguments (`toString(16)`), a configured value that is not a primitive, or a mimicked plain object, the conversion gives the printout. Such a conversion is a call of `toString()` or `valueOf()`, recorded like any other, so `id.received(2).toString()` below counts the template string and the `+`. `util.inspect()`, `console.log()` and failure messages always show the printout. `Symbol.toPrimitive` itself cannot be configured: configure `toString()` or `valueOf()`, or mimick an object.

```js
const { Substitute, mimick } = require('@fluffy-spoon/substitute')

const id = Substitute.for()
id.toString().returns('u1')
console.log(`user ${id}`) // prints user u1
console.log(id + '!') // prints u1!
id.received(2).toString()

const money = Substitute.for()
money.valueOf().returns(5)
console.log(money + 1, money > 3) // prints 6 true

const price = Substitute.for()
price[mimick]({ valueOf() { return 5 }, toString() { return '5 EUR' } })
console.log(price + 1, `${price}`) // prints 6 5 EUR

const date = Substitute.for()
date[mimick](new Date(0))
console.log(+date) // prints 0
```

JavaScript, Node.js and test libraries read some members to find out what a value is. Unless you configure them, these read as `undefined` on every substitute and auto-substitute, and the reads are not recorded:

* `Symbol.iterator`, `Symbol.asyncIterator`, `Symbol.hasInstance`, `Symbol.isConcatSpreadable`, `Symbol.match`, `Symbol.matchAll`, `Symbol.replace`, `Symbol.search`, `Symbol.split`, `Symbol.species`, `Symbol.toStringTag` and `Symbol.unscopables`,
* `util.promisify.custom`: both `Symbol.for('nodejs.util.promisify.custom')` and the running Node.js' own `require('util').promisify.custom`, which is a different symbol on Node.js 10.0 to 12.16.1 and 13.0 to 13.11,
* `asymmetricMatch`, which jest reads to find asymmetric matchers,
* `_isMockFunction`, which the printing of jest and vitest (`pretty-format`) reads to find mock functions, and vitest's spy assertions, too,
* `calledWithExactly`, which sinon-chai reads (with `getCall`) to find sinon spies,
* `handleEvent`, which `addEventListener()` reads to find event listener objects.

So `[].concat(sub)` keeps the substitute as one element, `value instanceof sub.SomeClass` is `false`, `'text'.startsWith(sub.prefix)` works, `util.promisify(sub.readFile)` calls the substitute on every supported Node.js version (so a `mimicks()` setup that calls the callback works), `Object.prototype.toString.call(sub)` is `'[object Function]'`, jest's `toEqual(sub)` and `toHaveBeenCalledWith(sub)` compare a substitute by identity, like any other function (but see [Test runners](#test-runners) for jest's `toHaveProperty()`), jest and vitest snapshots show a substitute as a function, not as a mock function, the spy assertions of vitest and sinon-chai throw for a substitute instead of passing (jest's do not; see [Test runners](#test-runners)), and a function substitute used as an event listener is called itself (see [Substitutes are functions](#substitutes-are-functions)). A substitute is not iterable: `[...sub]`, `for...of`, `for await...of` and `Promise.all(sub)` throw a `TypeError`.

`__esModule` is not one of these members. Unconfigured, it reads as an auto-substitute, which counts as `true`, and the read is recorded, as for any other member. So code compiled from ES modules takes a substitute that stands in for a whole module for the module's namespace; see [Mocking a whole module](#mocking-a-whole-module).

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

## Substitutes are functions
Every substitute and every auto-substitute is a function: `typeof sub` is `'function'`. And every member that is not configured reads as an auto-substitute, which is a function, too, and counts as `true`. So code under test that asks whether it got a function or an object, or whether an optional member or callback exists (`typeof x === 'function'`, `if (options.onDone)`, `typeof x.method === 'function'`, an options object or a callback as the last argument), takes the branch for a function, or for a member that exists, when it gets a substitute. Only the members listed above read as `undefined`. Configure or mimick what such code should see, or pass it a plain object.

This also decides what `addEventListener()` does with a substitute: it calls it as a function. Node.js' `EventTarget` and jsdom do so because it is a function, and happy-dom because its `handleEvent` reads as `undefined`. A function substitute added as an event listener therefore records each event as a call of itself, and you check it as such: `onSave.received(1)(Arg.any())`. A substitute that stands in for an event listener object (an object with a `handleEvent` method) is called as a function as well, so its `handleEvent` is not called (in Node.js and jsdom, not even when it is configured). Hand the code under test a plain object that passes the events on to the substitute instead, and configure `handleEvent` on the substitute: code that calls `listener.handleEvent(event)` on a substitute where it is neither configured nor mimicked gets `TypeError: listener.handleEvent is not a function`.

```js
const { Substitute, Arg, configure } = require('@fluffy-spoon/substitute')

// the code under test
const watch = (target, listener) => target.addEventListener('save', listener)

const target = new EventTarget()
const onSave = Substitute.for()
watch(target, onSave)
target.dispatchEvent(new Event('save'))
onSave.received(1)(Arg.any())

// an event listener object
const listener = Substitute.for()
listener[configure]().handleEvent(Arg.any()).returns(undefined)
watch(target, { handleEvent: event => listener.handleEvent(event) })
target.dispatchEvent(new Event('save'))
listener.received(1).handleEvent(Arg.any())

const options = Substitute.for()
console.log(typeof options.onDone, Boolean(options.onDone)) // prints function true
```

## Printing a substitute
`String(sub)`, template strings, `util.inspect(sub)`, `console.log(sub)` and `JSON.stringify(sub)` show the received calls and the setups of a substitute (`String()` and template strings only when `toString()` and `valueOf()` are neither configured nor mimicked, and `JSON.stringify()` only when the substitute does not mimick an object; see [Special members](#special-members)). An auto-substitute shows its path, such as `@Substitute.logger`, `@Substitute.getUser(1)` or `@Substitute.a.b('x').c`, followed by its own received calls and setups, if it has any. A substitute also lists those of its auto-substitutes, under their paths: the calls in the order they were made, the setups in the order they were configured. A read of a member, like `logger` before `logger.info('started')`, is a received call of its own, so it is listed, too. In a failure message, in the printout of another substitute and in a path, an auto-substitute shows only its path, as in `emit('created', @Substitute.child)`, also one of another copy of the package (see [The symbol API](#the-symbol-api)). A call made with `new` shows as `new Client('https://api')`.

```js
const { Substitute } = require('@fluffy-spoon/substitute')

const app = Substitute.for()

// the code under test
app.logger.info('started')
app.save({ id: 1 })

app.logger.level.returns(3)
app.getUser(1).name.returns('ann')

const printedApp = [
  '@Substitute {',
  '  received:',
  '    logger',
  "    logger.info('started')",
  '    save({ id: 1 })',
  '  configured:',
  '    logger.level => returns(3)',
  "    getUser(1).name => returns('ann')",
  '}'
]
console.log(String(app) === printedApp.join('\n')) // prints true

const logger = app.logger
const printedLogger = [
  '@Substitute.logger {',
  '  received:',
  "    info('started')",
  '  configured:',
  '    level => returns(3)',
  '}'
]
console.log(String(logger) === printedLogger.join('\n')) // prints true

console.log(`${app.getUser(2)}`) // prints @Substitute.getUser(2)
console.log(JSON.stringify({ user: app.getUser(2) })) // prints {"user":"@Substitute.getUser(2)"}
```

Printing always ends, also for values that refer to each other:

* A path can hold other paths, among the arguments of its calls. Such an inner path shows its own arguments only when they are all primitives: `@Substitute.save(@Substitute.getUser(1))`, but `@Substitute.wrap(@Substitute.save(…))` for `app.wrap(app.save({ id: 1 }))`.
* A call whose arguments are already being printed further out shows them as `(…)`. That happens when the code under test stores what a factory makes on the object it passes to the factory, or binds handlers to the instance that holds them: with `context.child = app.create(context)`, `String(context.child)` is `@Substitute.create({ name: 'root', child: @Substitute.create(…) })`.
* The printout of a substitute lists all of its own received calls and setups, and at most 50 received calls and 50 setups of its auto-substitutes. A list that leaves some out ends with `… and N more`.
* A path with more than 10 members shows the first 3 and the last 6: `@Substitute.next.next.next.….next.next.next.next.next.next`. Printing, `JSON.stringify()`, `in` and [`[clearReceivedCalls]()`](#clearing-received-calls) work on chains of auto-substitutes of any length, such as a linked list walked by the code under test.

Each value in a failure message, in the printout of a substitute and in a path is printed within bounds, so a large argument takes a few lines: a DOM event that refers to its element, document and window, an object with thousands of keys or a string of a megabyte. Values are printed by `util.inspect()`, two levels deep as it does by default, so `{ a: { b: { c: 1 } } }` shows in full and `{ a: { b: { c: { d: 1 } } } }` shows as `{ a: { b: { c: [Object] } } }` (a failure message prints deeper where that tells the expected call from a received one; see [received and didNotReceive](#received-and-didnotreceive)), and:

* arrays, `Map`s and `Set`s show their first 20 items (`... 99980 more items`), and objects their first 20 keys (`... 4980 more keys`);
* a string inside another value shows its first 200 characters (`'yyy…'... 9800 more characters`), and a string that is an argument itself up to about 960;
* each value ends after 1,000 characters (`… (N more characters)`), and a call shows at most 20 arguments (`... 980 more arguments`). A value with so many nested objects that the library prints only the part of it that shows, such as an object of 20 objects of 20 objects of 20 keys, ends with `… (more characters)`;
* in a path, each argument is shown on one line, without nested objects (`[Object]`), with at most 10 keys or items and at most 200 characters, and a call shows at most 10 arguments: `@Substitute.lookup({ key0: 0, key1: 1, key2: 2, key3: 3, key4: 4, key5: 5, key6: 6, key7: 7, key8: 8, key9: 9, ... 4990 more keys })`.

Values within these bounds print exactly as `util.inspect(value)` prints them. That includes the other keys of an array, a `Map` or a `Set`, such as the `total` of an array of rows, which follow the items: `[ { id: 1 }, { id: 2 }, total: 10 ]`. (In a `Map` or `Set` with more than 20 entries, they come before `... N more items`, where `util.inspect()` shows them after it.) An array of more than 1,000 items is printed without these other keys when one of its first 20 items prints in a form of the library's own: an error, which prints compactly, an object with more than 20 keys, a `Map` or `Set` with more than 20 entries, or an object that holds a matcher deeper than the printed depth. Such an array shows its first 20 items and `... N more items`: with 1,001 errors and a `total`, `[ [Error: failed 0], ..., [Error: failed 19], ... 981 more items ]`, while 1,000 errors, or 1,001 numbers, are printed with their `total`, as by `util.inspect()`. Matchers inside plain objects and arrays, in setups and in the expected call of a message, are shown by their own label at any depth, with the objects and arrays that hold them: `find({ q: { r: { s: { t: Arg.any{number} } } } }) => returns(2)`. Measured on Node.js 22, a failure message about a function substitute that happy-dom called with one click event takes about 2,100 characters, and with 60 click events about 22,000 characters. The bounds apply to what `util.inspect()` shows. Proxies, objects with a custom inspection of their own, and `Date`s, typed arrays and other built-in objects are shown by `util.inspect()` as they are, without the limit on keys, but still end after 1,000 characters. On Node.js 10 to 12.16, whose `util.inspect()` cannot shorten strings, a long string ends after 1,000 characters, too.

Errors show as `[Name: message]`, without their stack, wherever they appear: as an argument, inside an object, array, `Map` or `Set` argument (one level deeper than other objects, too, so three levels deep: `log({ context: { err: { cause: [Error: deep] } } })`), among the other keys of an array (`[ 1, failure: [TypeError: bad] ]`), and as the value configured with `throws()`. Their own enumerable properties other than `name`, `message` and `stack` follow in braces, and then their `cause`, as `[cause]`: `fail([HttpError: not found] { status: 404 })`, `fail([Error: saving failed] { [cause]: [TypeError: x is undefined] })`. An error shows at most 10 such properties, then `... N more keys`, and each of them briefly: one level deep, in at most 200 characters, with errors among them shown in the same form. Causes are shown three levels deep. A property or a cause with a getter shows as `[Getter]`, and the getter does not run. An error that refers back to itself shows only `[Name: message]` there.

```js
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const app = Substitute.for()
console.log(String(app.save(app.getUser(1)))) // prints @Substitute.save(@Substitute.getUser(1))
console.log(String(app.wrap(app.save({ id: 1 })))) // prints @Substitute.wrap(@Substitute.save(…))

// the code under test stores what a factory makes on the object it passes to the factory
const context = { name: 'root' }
context.child = app.create(context)
console.log(String(context.child)) // prints @Substitute.create({ name: 'root', child: @Substitute.create(…) })

let node = Substitute.for()
for (let i = 0; i < 20; i++) node = node.next
console.log(String(node)) // prints @Substitute.next.next.next.….next.next.next.next.next.next

const repository = Substitute.for()
repository.save(new Error('saving failed', { cause: new TypeError('x is undefined') }))
repository.load(1).throws(new RangeError('too large'))
repository.find({ where: { name: { startsWith: Arg.any('string') } } }).returns([])
const printedRepository = [
  '@Substitute {',
  '  received:',
  "    save([Error: saving failed] { [cause]: [TypeError: x is undefined] })",
  '  configured:',
  '    load(1) => throws([RangeError: too large])',
  '    find({ where: { name: { startsWith: Arg.any{string} } } }) => returns([])',
  '}'
]
console.log(String(repository) === printedRepository.join('\n')) // prints true

class HttpError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

const logger = Substitute.for()
logger.error('request failed', new HttpError('not found', 404))
logger.warn({ cause: new SyntaxError('bad json') })
logger.info({ context: { err: { cause: new Error('deep') } } })
logger.debug({ a: { b: { c: 1 } } })
logger.debug({ a: { b: { c: { d: 1 } } } })
logger.trace(...Array.from({ length: 25 }, (_, i) => i))
const printedLogger = [
  '@Substitute {',
  '  received:',
  "    error('request failed', [HttpError: not found] { status: 404 })",
  "    warn({ cause: [SyntaxError: bad json] })",
  "    info({ context: { err: { cause: [Error: deep] } } })",
  '    debug({ a: { b: { c: 1 } } })',
  '    debug({ a: { b: { c: [Object] } } })',
  '    trace(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, ... 5 more arguments)',
  '}'
]
console.log(String(logger) === printedLogger.join('\n')) // prints true

const table = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`key${i}`, i]))
console.log(String(logger.lookup(table))) // prints @Substitute.lookup({ key0: 0, key1: 1, key2: 2, key3: 3, key4: 4, key5: 5, key6: 6, key7: 7, key8: 8, key9: 9, ... 4990 more keys })

// an array of more than 1,000 errors is printed without its other keys
const failures = count => Object.assign(Array.from({ length: count }, (_, i) => new Error(`failed ${i}`)), { total: count })
const jobs = Substitute.for()
jobs.retry(failures(1000))
console.log(String(jobs).includes('total: 1000')) // prints true
jobs.retry(failures(1001))
console.log(String(jobs).includes('total: 1001')) // prints false
```

jest and vitest print a function, and so a substitute, with its `name` member, which is a member of the substitute like any other: `expect(...)` failure messages and diffs show `app.logger` as `[Function @Substitute.logger.name]` (or as the value that `name` is configured to return). Their snapshots (`toMatchSnapshot()`, `toMatchInlineSnapshot()`) show every function as `[Function]`, so a substitute, too. To find out what a value is, their printing reads members of it, such as `$$typeof`, `constructor`, `nodeType` and `name`, and these reads are recorded and listed in printouts of the substitute. It does not take a substitute for a mock function, because `_isMockFunction` reads as `undefined` (see [Special members](#special-members)).

Tools that print without the custom inspection that the library provides, such as the messages of `node:assert`, show any substitute as `[Function: bound substitute]` (on Node.js 26 as `Proxy([Function: bound substitute])`; Node.js 10 reads the `name` member and shows `[Function: @Substitute.name]`).

A function that takes over the prototype of a substitute or of a bound method of one is an ordinary function, not a substitute: it prints as a function, printing it does not call it, and nothing is recorded. Such functions are the wrappers that `mem`, `p-memoize`, `debounce-fn` and `onetime` (through `mimic-fn`) and `util.promisify()` make, and functions bound with the function's own `bind`: `Function.prototype.bind.call(listener, context)`, and wrappers bound again, such as `mem(api.getUser.bind(api)).bind(null, 1)` or `util.promisify(fs.readFile).bind(null, path)`. `util.inspect()`, `console.log()` and failure messages show these as `[Function: bound ]`, `[Function: bound bound getUser]` and `[Function: bound readFile]`. A wrapper that copies the `name` of the function that it wraps, as `mimic-fn` and `util.promisify()` do, gets the member's name, as for a real method: `mem(api.getUser)` prints as `[Function: getUser]`, and `mem(api.getUser.bind(api))` as `[Function: bound getUser]` (see [Freezing, defined properties and `in`](#freezing-defined-properties-and-in) for the `name` of a substitute). The function's own `bind` reads the `length` and `name` members of the function that it binds, so `Function.prototype.bind.call(listener, context)` records these two reads on `listener`, as reads of the code under test.

```js
const util = require('util')
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

// what mimic-fn does for the function that a memoizing wrapper wraps
const mimic = (wrapper, wrapped) => {
  Object.defineProperty(wrapper, 'name', Object.getOwnPropertyDescriptor(wrapped, 'name'))
  return Object.setPrototypeOf(wrapper, Object.getPrototypeOf(wrapped))
}

const api = Substitute.for()
api.getUser(1).returns({ id: 1 })
// the code under test memoizes a method of its client
const getUser = mimic(function memoized(id) { return api.getUser(id) }, api.getUser)
console.log(getUser(1)) // prints { id: 1 }
console.log(util.inspect(getUser)) // prints [Function: getUser]
api.received(1).getUser(1)

// the code under test binds a listener with the function's own bind
const listener = Substitute.for()
const bound = Function.prototype.bind.call(listener, { id: 1 })
console.log(util.inspect(bound)) // prints [Function: bound ]
listener.didNotReceive()(Arg.all())
```

## Freezing, defined properties and `in`
`Object.freeze()`, `Object.seal()` and `Object.preventExtensions()` work on a substitute and on an auto-substitute, and it keeps working afterwards: reads, calls, `new`, setups, checks and printing work as before, and `Object.isFrozen()`, `Object.isSealed()` and `Object.isExtensible()` say what was done. So code under test that freezes what it is given, like `this.options = Object.freeze(options)`, works with a substitute.

`Object.defineProperty(sub, key, descriptor)` defines a real property of the substitute. Reads return its value (a getter runs with the substitute as `this`), assignments write it (or fail, if it is not writable), and `delete` removes it (if it is configurable), after which the key is an ordinary member again. Reads and assignments of such a property are not recorded, and the property has no setup API.

Like every function, a substitute has the own properties `length` and `name`, which are not enumerable: `Reflect.ownKeys(sub)` and `Object.getOwnPropertyNames(sub)` are `[ 'length', 'name' ]`, while `Object.keys(sub)`, `{ ...sub }`, `Object.assign({}, sub)`, `for...in` and `JSON.stringify(sub)` do not see them. Auto-substitutes, the values that the library hands out for checks and setups, and functions returned by `x.bind(...)` have them as well. Both are read-only and configurable. `length` is `0`, and `name` is the member's name for a member (`'getKey'` for `keys.getKey`, `'[description]'` for a member with a symbol key), `'bound getKey'` for `keys.getKey.bind(keys)`, and `''` for a substitute itself and for the result of a call. These are what tools that adapt or wrap a function read: `util.callbackify(keys.getKey)` works, and wrappers that copy the name of the function that they wrap get the member's name (see [Printing a substitute](#printing-a-substitute)). Reading `sub.name` or `sub.length` does not use them: these are members like any other, so the read is recorded and gives an auto-substitute unless the member is configured (after `sub.name.returns('billing')`, `sub.name` is `'billing'`, while the own property `name` still holds `''`), and `'name' in sub` is `false` unless it is configured. `delete sub.member` changes nothing.

A substitute that mimicks an object lists the instance's enumerable own keys before `length` and `name` (see [Partial mocks](#partial-mocks)). A substitute that is given a property of its own lists the properties defined on it, followed by `length` and `name`: `[ 'version', 'length', 'name' ]` (a mimicked instance's keys are then no longer listed). A substitute that is frozen, sealed or made non-extensible lists only the properties defined on it, without `length` and `name`, so `Reflect.ownKeys()` gives `[]` for one that has none. On Node.js 12 and newer, `util.callbackify()` of such a substitute throws a `TypeError`, because it reads the descriptor of `length`: `Cannot read properties of undefined (reading 'value')` from Node.js 16.9 on, and `Cannot read property 'value' of undefined` before (Node.js 10 does not read it). Wrap such a substitute in a function: `util.callbackify((...args) => frozen(...args))`. Its auto-substitutes are not frozen, so `util.callbackify(frozen.load)` works.

The values that the library hands out for checks and setups (`sub[received]()`, `sub[configure]()` and members of them), a function returned by `x.bind(...)` and a member configured both as a property and as a method cannot be frozen, sealed or given properties: `Object.freeze()`, `Object.seal()`, `Object.preventExtensions()` and `Object.defineProperty()` throw a `SubstituteException` that says so.

`Object.setPrototypeOf(sub, prototype)` works on a substitute, a function substitute and an auto-substitute (`Object.setPrototypeOf(app.events, EventEmitter.prototype)`), for code under test that checks `instanceof`: `sub instanceof EventEmitter` is then `true`. Reads, calls, assignments (which are recorded, as on any substitute), setups, checks, the symbols and their views, `new`, `String()`, template strings and `JSON.stringify()` work as before, and so does passing the substitute as an argument or configuring it as a value. Only `util.inspect()` no longer finds the library's custom inspection, which it looks up through the prototype: `util.inspect(sub)` and `console.log(sub)` show `[Function: bound substitute] EventEmitter` (on Node.js 26 inside `Proxy(...)`), and so do failure messages and printouts in which the substitute is an argument (`use([Function: bound substitute] EventEmitter)`, where other substitutes show as `@Substitute`). Objects that inherit from such a substitute are ordinary objects, as above.

The prototype of a frozen, sealed or non-extensible substitute cannot change, as with any object that is not extensible: `Object.setPrototypeOf()` throws a `TypeError` that names the substitute, `@Substitute.events is not extensible: its prototype cannot be changed after Object.freeze(), Object.seal() or Object.preventExtensions()`, and setting the prototype it already has succeeds. Unlike on an ordinary object, `Reflect.setPrototypeOf()` throws that `TypeError`, too, instead of returning `false`, because a proxy cannot tell the two apart. (`sub.__proto__ = value` does not set the prototype: it is an assignment of a member called `__proto__`, recorded like any other.) `Object.defineProperty()` of a new key throws a `TypeError` on such a substitute as well, as on any object that is not extensible, with the message that V8 gives for proxies: `'defineProperty' on proxy: trap returned falsish for property 'x'`.

`key in sub`, and `Reflect.has(sub, key)`, is `true` when the key has a setup on the substitute: a property setup, a call setup, or a setup further down, like `sub.config.port.returns(80)` for `'config'`. It is also `true` when the substitute mimicks an instance that has the key (`key in instance`, so inherited members count), and for a property defined with `Object.defineProperty()`. Otherwise it is `false`: for members that the code under test used but that are not configured, for the members every function has (`call`, `apply`, `bind`, `name`, `length`, ...), for `then`, `toJSON` and the protocol members above (unless they are configured), and for the library's own methods. Reads, calls and checks through a call with a matcher, like `app.repo(Arg.any()).didNotReceive().save(1)`, do not count as setups here. `in` records nothing, and it takes the same time however many auto-substitutes the substitute has. So code under test that checks whether an optional member exists, like `if ('destroy' in stream)`, takes the branch that the test configured.

```js
const { Substitute, configure } = require('@fluffy-spoon/substitute')

// the code under test freezes its options, and checks for an optional member
class Service {
  constructor(options, stream) {
    this.options = Object.freeze(options)
    this.stream = stream
  }
  get name() { return this.options.name }
  close() { return 'destroy' in this.stream ? this.stream.destroy() : this.stream.end() }
}

const options = Substitute.for()
options.name.returns('billing')
const stream = Substitute.for()
stream.destroy().returns('destroyed')

const service = new Service(options, stream)
console.log(service.name) // prints billing
console.log(Object.isFrozen(options)) // prints true
console.log(service.close()) // prints destroyed
console.log('end' in stream) // prints false

const versioned = Substitute.for()
Object.defineProperty(versioned, 'version', { value: 2, enumerable: true, configurable: true })
console.log(versioned.version, Object.keys(versioned)) // prints 2 [ 'version' ]
console.log(Reflect.ownKeys(versioned)) // prints [ 'version', 'length', 'name' ]
versioned.didNotReceive().version
console.log(Reflect.ownKeys(Substitute.for())) // prints [ 'length', 'name' ]
console.log(Reflect.ownKeys(Object.freeze(Substitute.for()))) // prints []

Object.freeze(versioned[configure]()) // throws SubstituteException: cannot be used on
```

```js
const util = require('util')
const { Substitute, Arg } = require('@fluffy-spoon/substitute')

const keys = Substitute.for()
keys.getKey(Arg.any()).resolves('secret')
console.log(Object.getOwnPropertyDescriptor(keys.getKey, 'name').value) // prints getKey
// a read of the member called name is a read like any other
console.log(typeof keys.getKey.name) // prints function

// the code under test adapts the method to a callback API
const getKey = util.callbackify(keys.getKey)
getKey('kid', (error, key) => console.log(error, key)) // prints null secret
keys.received(1).getKey('kid')

const store = Object.freeze(Substitute.for())
store(Arg.any()).resolves('saved')
util.callbackify(store) // throws TypeError
const save = util.callbackify((...args) => store(...args))
save('ann', (error, result) => console.log(error, result)) // prints null saved
```

```js
const { EventEmitter } = require('events')
const util = require('util')
const { Substitute, Arg, received } = require('@fluffy-spoon/substitute')

// the code under test only accepts emitters
const subscribe = events => {
  if (!(events instanceof EventEmitter)) throw new TypeError('not an emitter')
  events.on('saved', () => { })
}

const app = Substitute.for()
Object.setPrototypeOf(app.events, EventEmitter.prototype)
subscribe(app.events)
app.events[received](1).on('saved', Arg.any())
console.log(`${app.events}`.split('\n')[0]) // prints @Substitute.events {
console.log(util.inspect(app.events).includes('[Function: bound substitute] EventEmitter')) // prints true

// a frozen substitute keeps its prototype
const options = Substitute.for()
Object.freeze(options)
Object.setPrototypeOf(options, EventEmitter.prototype) // throws TypeError: @Substitute is not extensible: its prototype cannot be changed after Object.freeze()
Reflect.setPrototypeOf(options, EventEmitter.prototype) // throws TypeError: @Substitute is not extensible
console.log(Object.setPrototypeOf(options, Object.getPrototypeOf(options)) === options) // prints true
Object.defineProperty(options, 'x', { value: 1 }) // throws TypeError: 'defineProperty' on proxy
```

# Typing limitations
TypeScript cannot express a few things about substitutes:

* **Assigning a property on the substitute** (`calculator.isEnabled = true`) does not compile, because the property's type also carries the setup API (`.returns()` and so on). Assign through the interface type, as the code under test does, and check with `calculator.received().isEnabled = true`.
* **`null` and `undefined`** are not part of the type of a call or property under `strictNullChecks`, although `.returns(null)` is accepted. Assign the value to the declared type, or give explicit type arguments (`t.is<string | null>(repository.find(1), null)`).
* **A generic method called with explicit type arguments** (`store.get<number>('answer')`) has no setup API. Call it without type arguments.
* **Generic methods** (`get<K extends keyof Config>(key: K): Config[K]`, a typed event emitter's `emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>)`, or Node.js' `EventEmitter<Events>` with a `@types/node` version that types the events, which needs TypeScript 4.8 or newer; see the end of this item for which versions) have the setup API, the checks and the `configure` view, with their type parameters replaced by their constraints. So the arguments are checked against the constraints only, and the configured value against what the method returns for them. With `Config` being `{ port: number; host: string }`, `config.get('port').returns('eighty')` compiles, because `Config[keyof Config]` is `number | string`, and `emitter.emit('failed', 'id1')` compiles although `'failed'` takes an `Error`, because the event and its arguments are not matched up. A value that the method can never return is rejected (`config.get('port').returns(Symbol('80'))`, also with `Arg.any()` arguments). That holds as well for arguments that fit the parameters only with the type parameters replaced by their constraints: for `same<T extends string | number>(a: T, b: T): T`, `same(1, 'x').returns(...)` takes what the method returns for those constraints, `string | number`, and never any value. A call with too many or too few arguments is rejected (`config.get('port', 'extra')`), with two exceptions. One is Node.js' `EventEmitter<Events>.emit`, on every version: the number of its arguments depends on the event, so on a substitute, `orders.emit('paid', 'o1')` compiles although `paid` also takes an amount, and so does `Arg.all()` after its last argument (`orders.emit('paid', 'o1', 20, Arg.all())`, where `Arg.all()` matches the empty rest). The other is on TypeScript 3.6 to 3.9: there, a generic method whose rest parameter is typed by an indexed access (`send<K extends keyof Events>(event: K, ...args: Events[K])`) takes any number of arguments on a substitute (the interface's own type rejects them). TypeScript 4.0 and newer check them. A generic method whose return type is conditional on a type parameter (`convert<T>(value: T): T extends string ? number : boolean`, or `listeners()` of `EventEmitter<Events>`) has the setup API as well, but TypeScript cannot work out that return type for a setup, so `.returns()` takes any value there. A callback without parameter types gets no types from a generic method (TypeScript reports that they implicitly have an `any` type): annotate them, as in `orders.on('paid', (orderId: string, amount: number) => { })`. An `Arg.is()` predicate without a parameter type does get the parameter's type, with the type parameters replaced by their constraints (see [Matching specific arguments](#matching-specific-arguments)), except in a rest parameter whose type depends on a type parameter, such as the event arguments of a typed emitter's `emit()`. There it gets the parameter types of all events together (`string | Error` for `emitter.emit('saved', Arg.is(id => id.startsWith('o')))` with the emitter below), or `unknown` with Node.js' `EventEmitter<Events>`, so the call does not compile: give the predicate a parameter type, as in `orders.received(1).emit('paid', Arg.is((orderId: string) => orderId.startsWith('o')), Arg.any())`. With a type parameter used as a key, a call with a matcher takes what the method returns for the key's constraint: `config.get(Arg.is(key => key === 'port')).returns(80)` takes `number | string`, and `.returns(true)` does not compile. On Node.js' `EventEmitter<Events>`, `Arg.all()` after the leading arguments of `emit()` compiles, in setups, checks and the `configure` view (`orders.received(1).emit('paid', Arg.all())`, `orders.emit('paid', 'o1', Arg.all()).returns(true)`), and the leading arguments are checked against `emit()`'s own signature: `orders.emit('nope', Arg.all())` and `orders.emit('paid', 1, Arg.all())` do not compile. For the event itself, `emit()` there takes no matcher but `Arg.any()` and `Arg.all()`: `Arg.any('string')` and `Arg.is()`, with or without a parameter type, do not compile in that position. Write the event, or `orders.received(1).emit(Arg.any(), Arg.all())`. What this item says about Node.js' `EventEmitter<Events>` holds for the `@types/node` versions that declare `emit<K>(eventName: Key<K, T>, ...args: Args<K, T>)`: 18.19.63 and newer 18.x versions, 20.11.21 and newer 20.x versions, 22.x and 24.x. (Older versions have no generic `EventEmitter`, so `EventEmitter<OrderEvents>` does not compile with them.) From `@types/node` 25 on, `emit()` is declared with `E extends string | symbol`, and on a substitute neither the event nor its arguments are checked: `orders.emit('nope', Arg.all())`, `orders.emit('paid', 1, Arg.all())`, `orders.received(1).emit(Arg.any('string'), Arg.all())` and `orders.emit(Symbol('x'), Arg.all())` compile, an `Arg.is()` predicate without a parameter type gets `any` there (`orders.emit('paid', Arg.is(orderId => orderId.nonexistent), Arg.any())` compiles), and `on()` and `once()` take any listener, whose parameters are `any` when it does not annotate them. `.returns()` still takes only a boolean for `emit()`. TypeScript itself checks less there, too: `new EventEmitter<OrderEvents>().emit('refunded')` compiles with `@types/node` 25, while `emit('paid', 1)` does not.
* **A type parameter of a generic method that has a default** is replaced by its constraint as well, not by its default. So pino's `child<ChildCustomLevels extends string = never>(bindings): Logger<CustomLevels | ChildCustomLevels>`, which returns a `Logger<never>` when it is called without type arguments, is taken as returning `Logger<string>`, and a substitute of `Logger` does not fit that: `log.child(Arg.any()).returns(Substitute.for<Logger>())` does not compile, also not in the `configure` view (TypeScript reports that `SubstituteOf<Logger>` is not assignable to `Logger<string, boolean>`, which has an index signature that it lacks). Return a substitute of `Logger<string>`, `log.child(Arg.any()).returns(Substitute.for<Logger<string>>())`, or cast, `childLogger as unknown as Logger<string>`. Checks are not affected (`log.received(1).child({ module: 'auth' })`). TypeScript 3.6 accepts the `Logger<never>` value.
* **Methods with a parameter declared with a literal type** (`once(event: 'drain', listener: () => void)`, `get(kind: 'user', id: number)`, also with a number or boolean literal, and with `null` from TypeScript 4.0 on), overloaded or not, resolve to the interface's own declaration when you call them directly with arguments that fit that declaration, so they have no setup API there: TypeScript tries such signatures before all others. `Arg.any()` fits any parameter, so it fits there, too. Configure them through the `configure` view: `stream[configure]().once('drain', Arg.any()).returns(stream)`. Checks work as usual (`stream.received(1).once('drain', Arg.any())`). A type matcher fits no literal type (see [Matching by type](#matching-by-type)), so where another overload takes any string, as `on(event: string, ...)` in Node.js' streams, `stream.on(Arg.any('string'), Arg.any()).returns(stream)` takes that overload and has the setup API. Parameters typed with a union of literals (`mode: 'r' | 'w'`) or with an enum member are not affected: `file.open('r').returns(1)` compiles (a type matcher does not fit them, either).
* **Overloaded generic methods whose parameter types depend on a type parameter through a conditional type**, such as `@types/pg`'s `Pool.query` and `ClientBase.query` (`values?: QueryConfigValues<I>`, with `QueryConfigValues<T> = T extends Array<infer U> ? T : never`): a setup that passes values has no setup API, as in `pool.query(sql, [1]).resolves(result)`, also with `values` in a config object, with `Arg.any()` for the values, and in the `configure` view. The substitute sees each overload with its type parameters replaced by their constraints, which leaves `values` taking nothing, and checking the values against the method's own overloads cannot help, as TypeScript relates overloads with `any` for their type parameters and would accept any values. Calls without values (`pool.query('SELECT 1').resolves(result)`, `pool.query({ text })`) and checks (`pool.received(1).query(sql, [1])`) compile. Pass the values `as never`: `pool.query(sql, [1] as never).resolves(result)`, `pool.query({ text: sql, values: [1] as never })`, and the same in `pool[configure]()`. That is the same call at runtime, so the setup answers the call that the code under test makes. Or match the SQL with any values: `pool.query(sql, Arg.all()).resolves(result)`.
* **More than 8 overloads:** only the last 8 have the setup API, in setups and in the `configure` view. With `@types/node` 18 to 24, Node.js' `http.Server` declares 12 overloads of `on()` and of `once()`, in this order: one for any event name, then `'close'`, `'connection'`, `'error'`, `'listening'`, `'checkContinue'`, `'checkExpectation'`, `'clientError'`, `'connect'`, `'dropRequest'`, `'request'` and `'upgrade'`. So `server.on(Arg.any('string'), Arg.any()).returns(server)` does not compile, also not in the `configure` view, and the setup of one event, `server[configure]().on('request', Arg.any()).returns(server)`, compiles only for the events of the last 8 overloads: not for `'close'`, `'connection'` and `'error'`, also not with `once()`. `net.Socket` has the same limit for `'close'`, and with `@types/node` 22 and 24 also for `'connect'`, `'connectionAttempt'` and `'connectionAttemptFailed'`. A setup that compiles for every event is one with `Arg.all()`: `server[configure]().on(Arg.all()).returns(server)` makes `on()` return the server for every event, so that the code under test can chain it (`server.on('error', onError).on('close', onClose)`), and the same works with `once()` and for `net.Socket`. To get the listener of one event, give that setup a `mimicks()` that looks at the event name (see the example below). Checks work with every overload (`server.received(1).on('error', Arg.any())`, `server.received(1).on(Arg.any('string'), Arg.any())`). On the substitute itself, outside the `configure` view, the setup of one event (`server.on('request', Arg.any()).returns(server)`) has no setup API either, because its parameter has a literal type (see above). With `@types/node` 25 and newer, `http.Server` and `net.Socket` declare `on()` and `once()` as one generic method for their events and one for any other name, and every one of these setups compiles.
* **A property typed `never`** cannot be configured. On a method that returns `never`, `.returns()` only accepts `never`; use `.throws()`.
* **Members typed only `null` or `undefined`** (`error?: undefined`, `ownerDocument: null`) keep their plain type and have no setup API. Configure them through `sub[configure]()`.
* **Generic code:** the result of a call on the substitute (`box.get('a')`) is not assignable to `T`; read it through the plain interface type, or cast it. Checking a set of a property whose type is the type parameter itself (`holder.received().current = value`, with `current: T`) may not compile; write `(holder.received() as Holder<T>).current = value`. Setups of such a property (`box.current.returns(value)`, and from TypeScript 3.9 on also with `maybe?: T` or `orNull: T | null`), of properties of types like `T[]` or `Promise<T>`, and of calls that return `T` are fine. With a constrained type parameter, a promise-typed property of the constraint (`name: Promise<string>` in `Repo`, with `T extends Repo`) has no `.resolves()` or `.rejects()` (nor `[resolves]` and `[rejects]`, also not in the `configure` view), while promise-returning methods have them: write `repo.name.returns(Promise.resolve('ann'))`, or `.returns(Promise.reject(error))`, which work on every supported version. Concrete types are not affected.
* **Generic code on TypeScript older than 4.8:** on TypeScript 3.6 to 4.7, with a constrained type parameter (`<T extends Calculator>`), calls of optional methods and of members typed as a function or `undefined` have no setup API: `sub.reset().returns()` with `reset?(): void`, `sub.find('a').returns('b')` with `find?(id: string): string | undefined`, `sub.maybeAdd(1).returns(2)` with `maybeAdd: ((a: number) => number) | undefined`, and every method of `T extends Partial<Calculator>` (TypeScript reports "This expression is not callable"). On TypeScript 3.6 to 3.8, in addition, properties whose type includes `null` or `undefined` have no setup API: with a constrained type parameter (`name: string | null`, `limit?: number`, every property of `T extends Partial<Calculator>`), and also in an interface instantiated with any type parameter, constrained or not (`maybe?: T` and `orNull: T | null` in `SubstituteOf<Box<T>>`). Configure them through the `configure` view, which works on every version: `sub[configure]().reset().returns()`, `sub[configure]().limit.returns(10)`, `box[configure]().maybe.returns(value)`. Checks work as well (`sub.received().reset()`, `sub.received().name = null`). Calls of optional methods in an instantiated interface (`load?(): T` in `Box<T>`) work on every version. TypeScript 4.8 and newer have none of these limitations.
* **Generic code with a union constraint** whose variants' methods return different types: in `function stubPet<T extends Cat | Dog>(pet: SubstituteOf<T>)`, where `speak()` returns `'meow'` or `'woof'`, `.returns()` and the `configure` view take `never` (`pet.speak().returns('meow')` does not compile). Members whose signature is the same in every variant (`pet.age().returns(3)`) and properties (`pet.kind.returns('cat')`) work. Cast to the constraint: `(pet as SubstituteOf<Cat | Dog>).speak().returns('meow')`. On TypeScript 5.4 and newer, a method that the variants of a union constraint declare with different parameter lists has no setup API at all, even when every variant returns the same type: with `log(message: string): void` in `LogA` and `log(message: string, level?: number): void` in `LogB`, `sub.log('x').returns()` does not compile in `function stubLog<T extends LogA | LogB>(sub: SubstituteOf<T>)` (TypeScript 5.0 and older compile it). The `configure` view (`sub[configure]().log('x').returns()`), checks (`sub.received().log('x')`) and the cast to the constraint work there on every version. A concrete union, as in `Substitute.for<Cat | Dog>()`, takes the union of the return types: `pet.speak().returns('meow')` compiles there, and so does `pet.speak().returns('woof')`, also when the variants have a string index signature, and when they declare the method with different parameter lists (see the next item).
* **A method that the variants of a concrete union declare with different parameter lists** (an extra optional parameter, other parameter types or other overloads, such as `read(path): string` and `read(path, encoding?): Uint8Array` in `Substitute.for<ReaderA | ReaderB>()`) has the setup API, and `.returns()` takes the return types of the variants that the call can reach. Each call is checked against the parameter list of one variant as a whole, in setups, checks and the `configure` view, so arguments that no variant accepts together do not compile, also when every variant returns the same type: with `move(x: string, y: number): void` in one variant and `move(x: number, y: string): void` in the other, `shape.move('a', 'b')` does not compile. A callback without parameter types gets them from the parameter list that the call resolves to, also in large unions such as the union of all HTML element types (`anyElement.addEventListener('click', event => event.preventDefault())`). A callback that annotates `this` with the type of a variant whose method takes it compiles: with `onClick(listener: (this: Button, x: number) => void)` in `Button` and `(this: Link, x: number) => void` in `Link`, both `function (this: Button, x: number) { }` and `function (this: Link, x: number) { }` do. Such a call takes that variant's return type, on every TypeScript version from 3.6 on, also when it leaves out an optional parameter: with `onPress(listener: (this: Btn, x: number) => void, options?: { once: boolean }): 'b'` in `Btn` and the same with `Lnk` and `'l'`, `widget.onPress(function (this: Btn, x: number) { }).returns('b')` compiles, and `.returns(true)` does not. Callbacks with the `this` types of different variants in one call (`both(function (this: C1) { }, function (this: C2) { })`) do not compile, in setups, checks and the `configure` view, as TypeScript rejects that call on the union itself. A callback with a `this` that no variant takes does not compile either, and a callback without a `this` annotation gets the `this` types of all variants. Which variants a call can reach depends on the number of arguments that it passes. A call that leaves out an optional parameter in which the variants differ takes what every variant that accepts the call returns: with `get(key: string, options?: OptionsV1): number` in one variant and `get(key: string, options?: OptionsV2): string` in the other, `api.get('k').returns(1)` and `api.get('k').returns('s')` both compile, while `api.get('k', { retries: 1 }).returns('s')`, with `OptionsV1` options, does not. A single `Arg.all()` takes the return types of every variant, and a variant with a rest parameter counts for calls with any number of arguments. On TypeScript 3.6 to 5.3, `Arg.all()` after other arguments takes `never` when the variants' parameter lists have different lengths: with `on(cb)` in one variant and `on(cb, extra: number)` in the other, `ab.on(x => { }, Arg.all()).returns('rb')` does not compile there (it does on 5.4 and newer). Use `Arg.all()` alone, or cast to the variant. If every overload of every variant returns the same type, or one of them returns `any`, `.returns()` takes that type. Three cases can surprise:
  * The values of the arguments do not count, so parameter types that only overlap do not either: with `letter(x: 'a' | 'b'): 'lower'` in one variant and `letter(x: 'b' | 'c'): 'upper'` in the other, `letters.letter('b').returns('upper')` does not compile.
  * `Arg.any()`, and an `Arg.is()` predicate without a parameter type, resolve to the first variant's overload that takes that many arguments. When the variants' parameter types differ, such a call takes only the return types of the variants that accept that overload's parameters: with `m(x: string): 'A'` in `MatchA` and `m(x: number): 'B'` in `MatchB`, `matched.m(Arg.any()).returns('B')` does not compile. Use `Arg.all()`, or a typed matcher such as `Arg.any('number')`.
  * A call that resolves to an overload with optional parameters also counts the variants whose parameter lists overlap with that overload's whole list: with `read(path): string` and `read(path, encoding?): Uint8Array`, `reader.read('p', 'utf8').returns('text')` compiles, although only the second variant takes an encoding.

  In these cases, cast to the variant: `(letters as SubstituteOf<Upper>).letter('b').returns('upper')`. Editors and error messages show the parameters of such a method without their names (`AllArguments<[string, (string | undefined)?]>`).
* **Checking a set of an index-signature key in generic code:** with `T extends Settings`, where `Settings` is `{ [key: string]: number; port: number }`, keys that exist only through the index signature can be configured (`sub.timeout.returns(5)`) and read in a check (`sub.received().timeout`). A check of a set, `sub.received().timeout = 5` (also with `[received]()`, `didNotReceive()` or `received(1)`), does not compile, because TypeScript does not resolve a write through an index signature of a type parameter. Write `(sub.received() as Settings).timeout = 5`, or `(sub as SubstituteOf<Settings>).received().timeout = 5`.
* **A union with `null` or `undefined`** (`Substitute.for<Calculator | undefined>()`) has no setup API. Substitute `Calculator`: the substitute can be passed where a `Calculator | undefined` is expected.
* **`Arg.all()` after other arguments** type-checks after up to 6 of them, also after a callback that annotates `this` with the type of a variant of a concrete union (with `onClick(listener: (this: Btn, n: number) => void, options?: { once: boolean }): 'b'` in `Btn`, `widget.onClick(function (this: Btn, n: number) { }, Arg.all()).returns('b')` takes `Btn`'s return type), and after the leading arguments of `emit()` on Node.js' `EventEmitter<Events>` (see the generic methods above). It does not type-check with arguments after it (which is an error at runtime, too), after the last parameter of a fixed parameter list (`add(1, 2, Arg.all())`; `EventEmitter<Events>.emit` does not check the number of an event's arguments, see above), or inside an object or array. Editors show the signatures that accept it with parameters named `arg0`, `arg1`, and so on.
* **A lone `Arg.any()`** compiles for a method with more parameters (`calculator.add(Arg.any())`), because it also fits the signature that takes `Arg.all()`, but it only matches calls with one argument; see [Ignoring all arguments](#ignoring-all-arguments).
* **`.resolves()` and `.rejects()`** are offered only where a native promise of the value fits the member's type, so not for a thenable with members of its own, such as a query builder, nor for a subtype of `Promise` with members of its own, such as ky's `ResponsePromise`, knex's `QueryBuilder`, execa's result or a `CancellablePromise`; see [Working with promises](#working-with-promises).
* **`Arg.any('object')`** is typed `any`, like `Arg.any()`, so the compiler does not check it against the parameter. `Arg.any('function')` is typed as any function or class.
* **`Arg.any.not(type)`** is typed as that type, so `Arg.any.not('number')` only fits a parameter that accepts every number, although it matches every value that is not a number. Like `Arg.any('number')`, it does not fit a union of number literals such as `80 | 443`, and `Arg.any.not('string')` does not fit `'EUR' | 'USD'`. On a parameter that does not accept numbers it would match every value, so use `Arg.any()` there. `Arg.any.not('undefined')` fits any parameter.
* **An optional function-typed property** (`onChange?: (value: string) => void`) does not accept `undefined` in a check: `widget.received().onChange = undefined` does not compile, nor do the `[received]()`, `didNotReceive()` and `[didNotReceive]()` forms, because in a check the member is callable (`widget.received().onChange('x')` checks a call). Write `(widget.received() as Widget).onChange = undefined`, or `widget.received().onChange = Arg.any.not('function')`, which matches any value that is not a function. (`Arg.any('undefined')` does not fit there either.)
* **Assigning a function to a callable member in a check** (`button.received().onClick = handler`) does not compile, because in a check the member also has the call signatures that take `Arg.all()`. Write `(button.received() as Button).onClick = handler`. Matchers fit there, `Arg.any('function')` included (`button.received().onClick = Arg.any('function')`), also on a union. On a substitute of a union whose variants declare the member with different types (`speak(loud: boolean): 'meow'` in `Cat`, `'woof'` in `Dog`), no function can be assigned to it in a check, in any form (`pet.received().speak = () => 'meow'`, also with `[received]()`, `didNotReceive()`, `[didNotReceive]()` and `received(1)`). Cast to the variant through `unknown`: `(pet.received() as unknown as Cat).speak = handler`. A direct `as Cat` does not compile, and `as Cat | Dog` does not take the function either, because TypeScript writes a property of a union with the intersection of its types. Matchers fit (`pet.received().speak = Arg.any('function')`, in each of these forms). Nor can `null` be assigned in a check to such a member that includes `null`: with `handler: ((e: MouseEvent) => void) | null` in one variant and `((e: KeyboardEvent) => void) | null` in the other, `widget.received().handler = null` does not compile; cast as above, or check with `Arg.is(handler => handler === null)`.
* **Optional properties of a type with a string index signature** do not accept `undefined` in a check (`sub.received().note = undefined`). Without an index signature, optional properties that are not functions do.
* **Nested auto-substitutes** are not typed as substitutes, see [Auto-substitutes](#auto-substitutes-and-nested-members).
* **Type-check time of very large unions**, mostly on old TypeScript versions. Measured on Node.js 22 (the time of TypeScript's checker, with `strict` and `skipLibCheck`, best of 3 runs on an otherwise idle machine; a busy machine takes longer), a file with a few setups and checks on a substitute of the union of all lib.dom element types takes about 2 to 2.6 seconds on TypeScript 3.6 to 4.5, about 1.4 seconds on 5.9 and about 0.75 seconds on 7.0, and a larger file (about 15 setups and checks, some with callbacks, plus substitutes of `Document` and of a union of two input elements) about 2.9 to 3.7, 2.1 and 1.2 seconds. A substitute of a union of 60 interfaces whose methods have different parameter lists takes about 24 to 29 seconds on TypeScript 3.6 to 4.2, which merge the signatures of such a union's members in quadratic time, about 3.1 seconds on 4.5, about 2.5 seconds on 5.9 and about 1.1 seconds on 7.0. A file with a few setups on Node.js' `EventEmitter<Events>`, whose generic methods cost the most there, takes about 0.24 to 0.31 seconds on TypeScript 4.8 to 5.9 and about 0.04 seconds on 7.0.

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

interface Stream {
  once(event: 'drain', listener: () => void): Stream
}
const stream = Substitute.for<Stream>()
// @ts-expect-error a parameter with a literal type: the call resolves to Stream's own declaration
stream.once('drain', Arg.any()).returns(stream)
stream[configure]().once('drain', Arg.any()).returns(stream)
stream.received(0).once('drain', Arg.any())

interface Readable {
  on(event: 'close', listener: () => void): Readable
  on(event: string, listener: (...args: any[]) => void): Readable
}
const readable = Substitute.for<Readable>()
// a type matcher does not fit 'close', so the call takes the overload for any string
readable.on(Arg.any('string'), Arg.any()).returns(readable)
// @ts-expect-error Arg.any() fits 'close', so the call resolves to Readable's own declaration
readable.on(Arg.any(), Arg.any()).returns(readable)

interface File { open(mode: 'r' | 'w'): number }
const file = Substitute.for<File>()
file.open('r').returns(1)

interface Box<T> {
  current: T
  items: T[]
  get(key: string): T
}
function stubBox<T>(box: SubstituteOf<Box<T>>, value: T) {
  box.get(Arg.any()).returns(value)
  box.items.returns([value])
  box.current.returns(value)
}
function checkCurrentSet<T>(box: SubstituteOf<Box<T>>, value: T) {
  (box.received() as Box<T>).current = value
}
const box = Substitute.for<Box<number>>()
stubBox(box, 7)
console.log(box.current) // prints 7
const replace = (b: Box<number>) => { b.current = 8 }
replace(box)
checkCurrentSet(box, 8)
```

<!-- docs-check: uses=calculator -->
```typescript
interface Widget {
  onChange?: (value: string) => void
  onClick?: (event: string) => void
}
const widget = Substitute.for<Widget>()
const handler = (event: string) => { }

// the code under test
const rewire = (w: Widget) => {
  w.onChange = undefined
  w.onClick = handler
}
rewire(widget)

// @ts-expect-error an optional function-typed property does not accept undefined in a check
widget.received().onChange = undefined
;(widget.received() as Widget).onChange = undefined
widget.received().onChange = Arg.any.not('function')

// @ts-expect-error in a check, a callable member also has the call signatures that take Arg.all()
widget.received().onClick = handler
;(widget.received() as Widget).onClick = handler
widget.received().onClick = Arg.any('function')

interface Greeter {
  greet(name: string): string
}
const greeter = Substitute.for<Greeter>()
// @ts-expect-error Arg.any.not('number') is typed number
greeter.greet(Arg.any.not('number')).returns('hi')
greeter.greet(Arg.any()).returns('hi')
greeter.greet(Arg.any.not('undefined')).returns('hi')
interface Server {
  listen(port: 80 | 443): void
}
const server = Substitute.for<Server>()
// @ts-expect-error Arg.any('number') is typed number, which is not 80 | 443
server.listen(Arg.any('number')).returns()
server.listen(Arg.any('number') as 80 | 443).returns()
server.listen(Arg.is((port: 80 | 443) => true)).returns()
// @ts-expect-error Arg.any.not('number') is typed number, too
server.listen(Arg.any.not('number')).returns()

interface Cat { kind: 'cat'; speak(loud: boolean): 'meow' }
interface Dog { kind: 'dog'; speak(loud: boolean): 'woof' }
const meow = (loud: boolean): 'meow' => 'meow'
// the code under test
const teach = (pet: Cat | Dog) => { if (pet.kind === 'cat') pet.speak = meow }
const pet = Substitute.for<Cat | Dog>()
pet.kind.returns('cat')
teach(pet)
// @ts-expect-error in a check, no function can be assigned to a member that the variants declare differently
pet.received().speak = meow
;(pet.received() as unknown as Cat).speak = meow
pet.received().speak = Arg.any('function')

interface Clicks { kind: 'clicks'; handler: ((event: MouseEvent) => void) | null }
interface Keys { kind: 'keys'; handler: ((event: KeyboardEvent) => void) | null }
const input = Substitute.for<Clicks | Keys>()
// @ts-expect-error nor null, for such a member
input.received(0).handler = null
input.received(0).handler = Arg.is(handler => handler === null)

const maybeCalculator = Substitute.for<Calculator | undefined>()
// @ts-expect-error a union with undefined has no setup API
maybeCalculator.add(1, 2).returns(3)
```

```typescript
import { Substitute, SubstituteOf, Arg, configure } from '@fluffy-spoon/substitute'

interface Cat { kind: 'cat'; speak(): 'meow'; age(): number; load(): Promise<number> }
interface Dog { kind: 'dog'; speak(): 'woof'; age(): number; load(): Promise<string> }

// a concrete union takes the union of the variants' return types
const pet = Substitute.for<Cat | Dog>()
pet.speak().returns('woof')
pet.load().resolves('bone')
console.log(pet.speak()) // prints woof
// @ts-expect-error neither variant returns 'moo'
Substitute.for<Cat | Dog>().speak().returns('moo')

function stubPet<T extends Cat | Dog>(pet: SubstituteOf<T>) {
  ;(pet as SubstituteOf<Cat | Dog>).speak().returns('meow')
  pet.age().returns(3)
}
function doesNotCompile<T extends Cat | Dog>(pet: SubstituteOf<T>) {
  // @ts-expect-error in generic code, .returns() only takes what every variant's speak() returns: never
  pet.speak().returns('meow')
}
const genericPet = Substitute.for<Cat | Dog>()
stubPet<Cat | Dog>(genericPet)
console.log(genericPet.speak(), genericPet.age()) // prints meow 3

interface Settings {
  [key: string]: number
  port: number
}
function stubSettings<T extends Settings>(settings: SubstituteOf<T>) {
  settings.timeout.returns(5)
  settings[configure]().retries.returns(3)
}
function checkTimeoutSet<T extends Settings>(settings: SubstituteOf<T>) {
  // @ts-expect-error a set of a key that exists only through the index signature cannot be checked here
  settings.received().timeout = 10
  ;(settings.received() as Settings).timeout = 10
}
const settings = Substitute.for<Settings>()
stubSettings<Settings>(settings)
console.log(settings.timeout + settings.retries) // prints 8
const setTimeoutTo10 = (s: Settings) => { s.timeout = 10 }
setTimeoutTo10(settings)
checkTimeoutSet<Settings>(settings)

// a union constraint whose variants declare the method with different parameter lists
interface LogA { kind: 'a'; log(message: string): void }
interface LogB { kind: 'b'; log(message: string, level?: number): void }
function stubLog<T extends LogA | LogB>(log: SubstituteOf<T>) {
  // @ts-expect-error no setup API on TypeScript 5.4 and newer
  log.log('x').throws(new Error('full'))
  log[configure]().log('y').throws(new Error('full'))
}
const log = Substitute.for<LogA | LogB>()
stubLog<LogA | LogB>(log)
log.log('y') // throws Error: full

// generic methods: the type parameters are replaced by their constraints
interface Config { port: number; host: string }
interface ConfigService { get<K extends keyof Config>(key: K): Config[K] }
const config = Substitute.for<ConfigService>()
config.get('host').returns('localhost')
console.log(config.get('host')) // prints localhost
// Config[keyof Config] is number | string, so this compiles, too
config.get('port').returns('eighty')
// @ts-expect-error no member of Config is a symbol
config[configure]().get('port').returns(Symbol('80'))
// @ts-expect-error get() takes one argument
config.get('port', 'extra')
// a matcher for the key takes what get() returns for keyof Config
config.get(Arg.is(key => key === 'port')).returns(80)
// @ts-expect-error get() returns number | string
config.get(Arg.is(key => key === 'host')).returns(true)

// arguments that fit only the constraints: the value is checked against what same() returns for them
interface Pairs { same<T extends string | number>(a: T, b: T): T }
const pairs = Substitute.for<Pairs>()
pairs.same(1, 'x').returns('y')
console.log(pairs.same(1, 'x')) // prints y
// @ts-expect-error same() returns string | number for these arguments
Substitute.for<Pairs>().same(1, 'x').returns({})

// a promise-typed property of a constraint: returns() a promise
interface Repo { name: Promise<string>; load(): Promise<number> }
function stubRepo<T extends Repo>(repo: SubstituteOf<T>) {
  repo.load().resolves(1)
  repo.name.returns(Promise.resolve('ann'))
}
function doesNotCompileEither<T extends Repo>(repo: SubstituteOf<T>) {
  // @ts-expect-error no resolves() on a promise-typed property of the constraint
  repo.name.resolves('ann')
}
const repo = Substitute.for<Repo>()
stubRepo<Repo>(repo)
repo.name.then(name => console.log(name)) // prints ann

interface Events { saved: (id: string) => void; failed: (error: Error) => void }
interface Emitter { emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean }
const emitter = Substitute.for<Emitter>()
emitter.emit('saved', 'id1').returns(true)
console.log(emitter.emit('saved', 'id1')) // prints true
emitter.received(1).emit('saved', 'id1')
// the event and its arguments are not matched up, so this compiles, too
emitter.didNotReceive().emit('failed', 'id1')
// a predicate in the event's arguments needs a parameter type
emitter.emit('saved', Arg.is((id: string) => id.startsWith('o'))).returns(true)
// @ts-expect-error without it, id gets the parameter types of all events: string | Error
emitter.emit('saved', Arg.is(id => id.startsWith('o'))).returns(true)

// a type parameter's default is not used: child() is taken as returning a Logger<string>
type Logger<Levels extends string = never> = { info(message: string): void }
  & { [level in Levels]: (message: string) => void }
  & { child<ChildLevels extends string = never>(bindings: object): Logger<Levels | ChildLevels> }
const logger = Substitute.for<Logger>()
// @ts-expect-error a Logger<never> is not a Logger<string>
logger.child(Arg.any()).returns(Substitute.for<Logger>())
const childLogger = Substitute.for<Logger<string>>()
logger.child(Arg.any()).returns(childLogger)
logger.child({ module: 'auth' }).info('started')
logger.received(1).child({ module: 'auth' })

// a return type that is conditional on the type parameter: .returns() takes any value
interface Converter { convert<T>(value: T): T extends string ? number : boolean }
const converter = Substitute.for<Converter>()
converter.convert('42').returns(42)
console.log(converter.convert('42')) // prints 42
```

```typescript
import { EventEmitter } from 'events'
import * as http from 'http'
import { Substitute, Arg, configure } from '@fluffy-spoon/substitute'

type OrderEvents = { paid: [orderId: string, amount: number]; cancelled: [orderId: string] }
const orders = Substitute.for<EventEmitter<OrderEvents>>()
orders.emit('paid', 'o1', 20).returns(true)
// the number of emit()'s arguments depends on the event, so this compiles, too
orders.emit('paid', 'o1').returns(true)
// a callback gets no parameter types from a generic method: annotate them
orders.on('paid', (orderId: string, amount: number) => { }).returns(orders)

// Arg.all() after the leading arguments
orders.emit('paid', 'o2', Arg.all()).returns(false)
// a predicate in the event's arguments needs a parameter type
orders[configure]().emit('paid', Arg.is((orderId: string) => orderId.startsWith('x')), Arg.any()).returns(false)

// the code under test
console.log(orders.emit('paid', 'o1', 20), orders.emit('paid', 'o2', 5)) // prints true false
orders.received(2).emit('paid', Arg.all())
orders.didNotReceive().emit('cancelled', Arg.all())
orders.received(2).emit(Arg.any(), Arg.all())

// http.Server: on() for every event, and the listener of one event
const server = Substitute.for<http.Server>()
const listeners: { [event: string]: (...args: any[]) => void } = {}
server[configure]().on(Arg.all()).mimicks((event: string | symbol, listener: (...args: any[]) => void) => {
  listeners[String(event)] = listener
  return server
})

// the code under test
server.on('error', (error: Error) => console.log('error handler got', error.message)).on('close', () => { })

listeners.error(new Error('EADDRINUSE')) // prints error handler got EADDRINUSE
server.received(1).on('error', Arg.any())
server.received(2).on(Arg.any('string'), Arg.any())
```

What `@types/node` 18.19.63 to 24.x rejects (from `@types/node` 25 on, the lines marked `@ts-expect-error` compile):

<!-- docs-check: types-node-below=25 -->
```typescript
import { EventEmitter } from 'events'
import * as http from 'http'
import { Substitute, Arg, configure } from '@fluffy-spoon/substitute'

type OrderEvents = { paid: [orderId: string, amount: number]; cancelled: [orderId: string] }
const orders = Substitute.for<EventEmitter<OrderEvents>>()
// the leading arguments are checked against emit()'s own signature
orders.emit('paid', 'o2', Arg.all()).returns(false)
// @ts-expect-error there is no event called 'refunded'
orders.emit('refunded', Arg.all()).returns(false)
// @ts-expect-error without a parameter type, orderId is unknown
orders.emit('paid', Arg.is(orderId => orderId.startsWith('x')), Arg.any()).returns(false)

// http.Server declares 12 overloads of on(), the one for any event name first
const server = Substitute.for<http.Server>()
// @ts-expect-error only the last 8 overloads have the setup API
server.on(Arg.any('string'), Arg.any()).returns(server)
server[configure]().on('request', Arg.any()).returns(server)
// @ts-expect-error 'error' is not among the last 8 overloads
server[configure]().on('error', Arg.any()).returns(server)
server[configure]().on(Arg.all()).returns(server)
```

```typescript
import { Substitute, Arg, configure } from '@fluffy-spoon/substitute'

// the shape of @types/pg's Pool.query
type QueryConfigValues<T> = T extends Array<infer U> ? T : never
interface QueryConfig<I = any[]> { text: string; values?: QueryConfigValues<I> }
interface QueryResult<R> { rows: R[] }
interface Pool {
  query<R = any, I = any[]>(config: QueryConfig<I>): Promise<QueryResult<R>>
  query<R = any, I = any[]>(text: string | QueryConfig<I>, values?: QueryConfigValues<I>): Promise<QueryResult<R>>
}

// the code under test
const findUser = (pool: Pool, id: number) => pool.query('SELECT * FROM users WHERE id = $1', [id]).then(result => result.rows[0])

const pool = Substitute.for<Pool>()
// @ts-expect-error a setup that passes values has no setup API
pool.query('SELECT * FROM orders WHERE id = $1', [1]).resolves({ rows: [] })
pool.query('SELECT * FROM users WHERE id = $1', [1] as never).resolves({ rows: [{ id: 1 }] })
pool.query({ text: 'SELECT * FROM users WHERE id = $1', values: [2] as never }).resolves({ rows: [] })
pool[configure]().query('SELECT * FROM users WHERE id = $1', [3] as never).resolves({ rows: [] })
pool.query('SELECT now()', Arg.all()).resolves({ rows: [] })
pool.query('SELECT 1').resolves({ rows: [] })

findUser(pool, 1).then(user => console.log(user)) // prints { id: 1 }
pool.received(1).query('SELECT * FROM users WHERE id = $1', [1])
```

```typescript
import { Substitute, SubstituteOf, Arg, configure } from '@fluffy-spoon/substitute'

// each call is checked against one variant's parameter list as a whole
interface Left { side: 'left'; move(x: string, y: number): void }
interface Right { side: 'right'; move(x: number, y: string): void }
const shape = Substitute.for<Left | Right>()
shape.move('a', 1).returns()
shape[configure]().move(1, 'b').returns()
// @ts-expect-error neither variant takes (string, string)
shape.received(0).move('a', 'b')

// a callback without parameter types gets them from the variant's parameter list
interface SocketV1 { version: 1; onMessage(listener: (data: string) => void): void }
interface SocketV2 { version: 2; onMessage(listener: (data: Uint8Array) => void): void }
const socket = Substitute.for<SocketV1 | SocketV2>()
socket.onMessage(data => data.length).returns()

// a callback that annotates `this` with a variant's type
interface Button { kind: 'button'; onClick(listener: (this: Button, x: number) => void): void }
interface Link { kind: 'link'; onClick(listener: (this: Link, x: number) => void): void }
interface Image { kind: 'image' }
const control = Substitute.for<Button | Link>()
control.onClick(function (this: Button, x: number) { }).returns()
control.onClick(function (this: Link, x: number) { }).returns()
// @ts-expect-error no variant takes a listener whose `this` is an Image
control.received(0).onClick(function (this: Image, x: number) { })

// such a call takes that variant's return type, also when it leaves out an optional parameter
interface Btn { kind: 'btn'; onPress(listener: (this: Btn, x: number) => void, options?: { once: boolean }): 'b' }
interface Lnk { kind: 'lnk'; onPress(listener: (this: Lnk, x: number) => void, options?: { once: boolean }): 'l' }
const widget = Substitute.for<Btn | Lnk>()
widget.onPress(function (this: Btn, x: number) { }).returns('b')
widget.onPress(function (this: Lnk, x: number) { }, { once: true }).returns('l')
// @ts-expect-error Btn's onPress() returns 'b'
widget.onPress(function (this: Btn, x: number) { }).returns(true)
// Arg.all() after such a callback
widget.onPress(function (this: Btn, x: number) { }, Arg.all()).returns('b')
// @ts-expect-error Btn's onPress() returns 'b'
widget.onPress(function (this: Btn, x: number) { }, Arg.all()).returns('l')

// callbacks with the `this` types of different variants in one call
interface Pair1 { kind: 1; both(a: (this: Pair1) => void, b: (this: Pair1) => void): void }
interface Pair2 { kind: 2; both(a: (this: Pair2) => void, b: (this: Pair2) => void): void }
const pair = Substitute.for<Pair1 | Pair2>()
pair.both(function (this: Pair1) { }, function (this: Pair1) { }).returns()
// @ts-expect-error no variant takes both
pair[configure]().both(function (this: Pair1) { }, function (this: Pair2) { }).returns()

// the variants declare the method with different parameter lists
interface ClientV1 { version: 1; fetch(url: string): Promise<string> }
interface ClientV2 { version: 2; fetch(url: string, options?: { timeout: number }): Promise<string> }
const client = Substitute.for<ClientV1 | ClientV2>()
client.fetch('/users').resolves('[]')
client.fetch('/users').then(body => console.log(body)) // prints []

interface ReaderA { kind: 'a'; read(path: string): string }
interface ReaderB { kind: 'b'; read(path: string, encoding?: string): Uint8Array }
const reader = Substitute.for<ReaderA | ReaderB>()
reader.read('notes.txt').returns('text')
reader.read('image.png').returns(new Uint8Array([1, 2]))
reader[configure]().read('empty.txt').returns('')
console.log(reader.read('notes.txt')) // prints text
// @ts-expect-error neither variant's read() returns a number
Substitute.for<ReaderA | ReaderB>().read('notes.txt').returns(1)

// parameter types that only overlap do not count
interface Lower { kind: 'lower'; letter(x: 'a' | 'b'): 'lower' }
interface Upper { kind: 'upper'; letter(x: 'b' | 'c'): 'upper' }
// @ts-expect-error the call resolves to Lower's letter(), whose parameter type Upper's letter() does not accept as a whole
Substitute.for<Lower | Upper>().letter('b').returns('upper')
const letters = Substitute.for<Lower | Upper>()
;(letters as SubstituteOf<Upper>).letter('b').returns('upper')
console.log(letters.letter('b')) // prints upper

// a call that leaves out the options can reach both variants
interface ApiV1 { version: 1; get(key: string, options?: { retries: number }): number }
interface ApiV2 { version: 2; get(key: string, options?: { timeoutMs: number }): string }
const api = Substitute.for<ApiV1 | ApiV2>()
api.get('count').returns(1)
api.get('name').returns('ann')
console.log(api.get('count'), api.get('name')) // prints 1 ann
// @ts-expect-error only ApiV1 takes { retries }, and its get() returns a number
api.get('name', { retries: 1 }).returns('ann')

// Arg.any() resolves to the first variant's m(x: string)
interface MatchA { kind: 'a'; m(x: string): 'A' }
interface MatchB { kind: 'b'; m(x: number): 'B' }
const matched = Substitute.for<MatchA | MatchB>()
// @ts-expect-error the call resolves to m(x: string), which only MatchA declares
matched.m(Arg.any()).returns('B')
const typed = Substitute.for<MatchA | MatchB>()
typed.m(Arg.any('number')).returns('B')
typed.m(Arg.all()).returns('A')
console.log(typed.m(2), typed.m('x')) // prints B A
```

# Test runners
Checks throw a `SubstituteException`, so they work with any test runner: a failed check fails the test, and you can expect one with your runner's `throws` assertion. ava, jest, mocha, node:test and vitest (also with the package inlined through `server.deps.inline`) are tested on every change, including a check that [fails later](#assertions-that-fail-later). Each of them fails the run for it, but not all in the same way: jest reports it as the failure of the running test (jest 30 on Node.js 22 as a failure of the test file), vitest and node:test run every test and fail the run or the file, mocha stops the run after that test, so the remaining tests and files do not run, and ava ends the worker of that test file, so its unfinished tests are not reported. In jest and vitest, the `called at` lines of failure messages name the lines of the TypeScript source. Fake timers that a test installs do not hold back such a report; see [Assertions that fail later](#assertions-that-fail-later) for how each runner reports it, and for fake timers that are installed before the library is loaded.

**Check the calls of a substitute with `received()` and `didNotReceive()`, never with the spy assertions of jest or sinon-chai.** A substitute is neither a jest mock nor a sinon spy, but these assertions ask a value whether it is one, and a substitute answers with auto-substitutes:

* jest's `toHaveBeenCalled()`, `toHaveBeenCalledTimes()`, `toHaveBeenCalledWith()`, `toHaveBeenLastCalledWith()` and `toHaveBeenNthCalledWith()` also accept Jasmine-style spies, which they recognise by `calls.all` and `calls.count` being functions. On a substitute, these are auto-substitutes, which are functions, so jest takes every substitute for such a spy, and reads the number of its calls from `calls.count()`, which gives an auto-substitute, not a number. So `expect(next).not.toHaveBeenCalled()`, `.not.toHaveBeenCalledTimes(1)`, `.not.toHaveBeenLastCalledWith(...)` and `.not.toHaveBeenNthCalledWith(...)` **pass, whatever `next` received**. The forms without `.not` fail with messages such as `Received number of calls: [Function @Substitute.calls.count().name]`, and `toHaveBeenCalledWith()` fails with jest's "Unexpected return from a matcher function", with or without `.not`. These reads (`calls`, `calls.count()` and more) are recorded on the substitute, too. `jest.spyOn(sub, 'save')` returns the auto-substitute `sub.save`, which is no spy either. The library cannot make `calls.all` and `calls.count` read as `undefined`, as it does for other such probes (see [Special members](#special-members)), without breaking types with a member called `calls`, such as a telephony client's `client.calls.create()`. (`toHaveReturned()` and jest's other matchers for return values take only jest's own mocks: they throw `received value must be a mock function`.)
* sinon-chai's assertions, as mocha tests use them with chai (`expect(next).to.have.been.called`, `.calledOnce`, `.calledWith(...)`, also with `.not`), throw `TypeError: [Function @Substitute.name] is not a spy or a call to a spy!` for a substitute, because `calledWithExactly` reads as `undefined` on it, and so do vitest's spy assertions, because `_isMockFunction` does. The reads that they make to find out (`getCall`, `proxy`, `name`) are recorded on the substitute.

In a test written for `jest.fn()` or a sinon spy, replace each spy assertion with a check:

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

// the code under test passes an error on
const handle = (next, error) => next(error)

const next = Substitute.for()
handle(next, new Error('boom'))

// not expect(next).toHaveBeenCalledWith(...), nor expect(next).to.have.been.calledWith(...)
next.received(1)(Arg.is(error => error.message === 'boom'))
// not expect(next).not.toHaveBeenCalled(), which would pass here
next.didNotReceive()(Arg.all()) // throws SubstituteException
```

Other assertions of your runner can take substitutes as values: jest's `toEqual(sub)` and `toContainEqual(sub)`, and `toHaveBeenCalledWith(sub)` on a jest mock, compare substitutes by identity: a substitute only equals itself (see [Special members](#special-members)). In their failure messages, jest and vitest show a substitute by its `name` member, for example `[Function @Substitute.logger.name]`, and their snapshots show it as `[Function]` (see [Printing a substitute](#printing-a-substitute)).

With jest, `toHaveProperty(path, value)` does not compare the value of a member that is not configured: `expect(app.config).toHaveProperty('port', 80)` and `expect(app).toHaveProperty('config.port', 80)` pass, whatever the value. jest compares the value only when the last key is `in` the object, and an unconfigured member of a substitute is not (see [Freezing, defined properties and `in`](#freezing-defined-properties-and-in)), although reading it gives an auto-substitute. Assert on the member itself (`expect(app.config.port).toEqual(80)` fails, as it should), or configure it: after `app.config.port.returns(443)`, `toHaveProperty('port', 80)` and `toHaveProperty('config.port', 80)` fail, and `toHaveProperty('port', 443)` passes. The members of a mimicked instance are compared, too. vitest's `toHaveProperty()` compares the value in every case. (Seen with jest 30.5 and vitest 5.1.)

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

## Mocking a whole module
A substitute can stand in for a whole module in jest's module mocks of CommonJS code (also code compiled to CommonJS by TypeScript or Babel): `jest.mock('./mailer', () => require('@fluffy-spoon/substitute').Substitute.for())`, configured through `jest.requireMock('./mailer')`. Other module mocks need a plain object; see below. Code compiled from ES modules by TypeScript (with `esModuleInterop`) or Babel reads `__esModule` of a module to find out whether it is an ES module. On a substitute, that is an ordinary member, which reads as an auto-substitute and so counts as `true`. So such code takes the substitute for the module's namespace:

* A namespace import (`import * as mailer from './mailer'`), a named import (`import { send } from './mailer'`) and a mixed import (`import mailer, { send } from './mailer'`) reach the members configured on the substitute: `jest.requireMock('./mailer').send('ann').returns(true)`.
* A default import (`import mailer from './mailer'`) gives the auto-substitute `default` of the substitute. Configure that one: `jest.requireMock('./mailer').default.send('ann').returns(true)`. To make the default import the substitute itself, return it as the default export of a plain ES module object: `jest.mock('./mailer', () => ({ __esModule: true, default: require('@fluffy-spoon/substitute').Substitute.for() }))`, and get it with `jest.requireMock('./mailer').default`.

The compatibility checks run these forms with jest on every change, with ts-jest and with babel-jest. `__esModule` can also be configured like any other member: `sub.__esModule.returns(false)`. The substitute then counts as a CommonJS module that exports a function: the default import gives the substitute itself, and a namespace import copies the substitute's own properties, which are only `length` and `name` (see [Freezing, defined properties and `in`](#freezing-defined-properties-and-in)), so it has no other members.

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// what TypeScript (with esModuleInterop) makes of the imports of a module
const importStar = mod => (mod && mod.__esModule) ? mod : { ...mod, default: mod }
const importDefault = mod => (mod && mod.__esModule) ? mod : { default: mod }

// jest.mock('./mailer', () => Substitute.for())
const mailer = Substitute.for()
mailer.send('ann').returns(true)
console.log(importStar(mailer).send('ann')) // prints true
console.log(importDefault(mailer).default === mailer.default) // prints true

// jest.mock('./mailer', () => ({ __esModule: true, default: Substitute.for() }))
const factoryModule = { __esModule: true, default: Substitute.for() }
console.log(importDefault(factoryModule).default === factoryModule.default) // prints true
```

Other module mocks need a plain object. A substitute is a function whose only own keys are `length` and `name`, which are not enumerable, so it cannot stand in for a module where a tool copies the module's own keys, or wants an object. Make a plain object whose members are the substitute's members, with the substitute as the default export, so that the test can reach it: `{ default: mailer, send: mailer.send, verify: mailer.verify }`. A call through such a member is a call of the substitute's member: `mailer.send('ann').returns('ok')` answers it, and `mailer.received(1).send('ann')` checks it. This is needed:

* **For a module that a barrel re-exports.** A module with `export * from './mailer'` copies the own enumerable members of `./mailer` when it is loaded, in code compiled by TypeScript and by Babel. With `jest.mock('./mailer', () => Substitute.for())`, the barrel gets no `send`, and code under test that imports `send` from the barrel fails with `TypeError: (0 , barrel_1.send) is not a function`. Either mock the module that the code under test imports, the barrel itself: `jest.mock('./barrel', () => require('@fluffy-spoon/substitute').Substitute.for())`, configured through `jest.requireMock('./barrel')`. Or return a plain object from the factory: `jest.mock('./mailer', () => { const mailer = require('@fluffy-spoon/substitute').Substitute.for(); return { __esModule: true, default: mailer, send: mailer.send, verify: mailer.verify } })`, and configure and check `jest.requireMock('./mailer').default`. Both work for named and namespace imports through the barrel.
* **With vitest's `vi.mock()`**, which refuses a factory that does not return an object: `TypeError: [vitest] vi.mock("./src/api", factory?: () => unknown) is not returning an object. Did you mean to return an object with a "default" key?`
* **With node:test's `mock.module()`** (`node --test --experimental-test-module-mocks`, Node.js 22.3 and newer), which takes the named exports as an object (`The "options.namedExports" property must be of type object`). A substitute can be the default export on its own (`mock.module('node:os', { defaultExport: os })`, for code that does `import os from 'node:os'`), but not together with `namedExports` (`Cannot create mock because named exports cannot be applied to the provided default export.`). Node.js 24 and newer deprecate `namedExports` and `defaultExport` in favour of `exports: { exec: childProcess.exec }` and `exports: { default: os }`; Node.js 22 knows only the older options.
* **With jest's `jest.unstable_mockModule()`** for native ES modules (run with `NODE_OPTIONS=--experimental-vm-modules`), which takes a module's named exports from the own keys of the factory's object: with a substitute, the import fails with `SyntaxError: The requested module './db.mjs' does not provide an export named 'query'`.
* **With esbuild, and tools built on it**, which copy the module's own properties when code imports it: `{ __esModule: true, default: mailer, send: mailer.send }` works there, too.

The compatibility checks run each of these with the runner on every change: the barrel with ts-jest and with babel-jest, `vi.mock()`, `mock.module()` on Node.js 22, 24 and 26, and `jest.unstable_mockModule()`.

```js
const { Substitute } = require('@fluffy-spoon/substitute')

// what TypeScript and Babel make of `export * from './mailer'` in a barrel: a copy of the module's own keys
const exportStar = mod => {
  const barrel = {}
  for (const key of Object.keys(mod)) if (key !== 'default') barrel[key] = mod[key]
  return barrel
}

// jest.mock('./mailer', () => Substitute.for())
console.log(typeof exportStar(Substitute.for()).send) // prints undefined

// jest.mock('./mailer', () => { const mailer = Substitute.for(); return { __esModule: true, default: mailer, send: mailer.send } })
const mailerModule = (() => {
  const mailer = Substitute.for()
  return { __esModule: true, default: mailer, send: mailer.send }
})()
const barrel = exportStar(mailerModule)

// in the test: const mailer = jest.requireMock('./mailer').default
const mailer = mailerModule.default
mailer.send('ann').returns('ok')
console.log(barrel.send('ann')) // prints ok
mailer.received(1).send('ann')
```

With vitest, where `src/history.ts` imports `fetchHistory` and `post` from `./api` (named and namespace imports work alike):

<!-- docs-check: skip runs only under vitest; compatibility-checks/test-runners/vitest-modules runs it -->
```typescript
import { test, vi } from 'vitest'
import api from './src/api'
import { loadHistory } from './src/history'

vi.mock('./src/api', async () => {
  const { Substitute } = await import('@fluffy-spoon/substitute')
  const api = Substitute.for<any>()
  return { default: api, fetchHistory: api.fetchHistory, post: api.post }
})

test('loads the history', async () => {
  const apiSubstitute = api as any // the substitute: the default export of the mock
  apiSubstitute.fetchHistory('lobby').resolves(['a'])
  await loadHistory('lobby')
  apiSubstitute.received(1).fetchHistory('lobby')
})
```

With node:test on Node.js 22, where `src/notify.mjs` does `import { exec } from 'node:child_process'` and `import os from 'node:os'`:

<!-- docs-check: skip needs node --test --experimental-test-module-mocks; compatibility-checks/test-runners/nodejs-modules runs it -->
```js
import { test, mock } from 'node:test'
import { Substitute, Arg } from '@fluffy-spoon/substitute'

const childProcess = Substitute.for()
const os = Substitute.for()
childProcess.exec(Arg.any('string'), Arg.any('function')).mimicks((command, callback) => callback(null, ''))
os.hostname().returns('box')
mock.module('node:child_process', { namedExports: { exec: childProcess.exec } })
mock.module('node:os', { defaultExport: os })
const { notify } = await import('./src/notify.mjs')

test('notifies', async () => {
  await notify('hi')
  childProcess.received(1).exec('notify-send "hi"', Arg.any())
})
```

With jest and native ES modules, where `src/repo.mjs` does `import { query } from './db.mjs'`:

<!-- docs-check: skip runs only under jest with --experimental-vm-modules; compatibility-checks/test-runners/jest-esm-modules runs it -->
```js
import { jest, expect, test } from '@jest/globals'
import { Substitute } from '@fluffy-spoon/substitute'

const db = Substitute.for()
jest.unstable_mockModule('./src/db.mjs', () => ({ default: db, query: db.query }))
const { count } = await import('./src/repo.mjs')

test('counts the rows', async () => {
  db.query('select count(*)').resolves([42])
  expect(await count()).toBe(42)
  db.received(1).query('select count(*)')
})
```

## Debuggers
With "pause on caught exceptions" turned on (VS Code's "Caught Exceptions", Chrome DevTools' "Pause on caught exceptions", WebStorm's "Any exception"), an ordinary test raises no exception inside the library when `Error.prepareStackTrace` holds a function. That is the case on Node.js 20.20, 22, 24 and 26, which install a formatter of their own, with `source-map-support` (also on older Node.js versions), in jest 29's test environment, and in vitest's `forks` and `threads` pools.

Where `Error.prepareStackTrace` is not a function, the library throws and catches an exception for each step of a chain like `app.repo.users.find(1)`, to read where that step was made, and the debugger stops twice for each, in `dist/internals/CallSite.js` (in `peekFirstFrame` and `readFirstFrame`): 40 times for a test of two setups, a call of the code under test and two checks, all through such chains. That happens on Node.js 18 and other versions before 20.20 without an installed formatter, when `Error.prepareStackTrace` was deleted, and in `vm` contexts: jest 30's test environment, vitest's `vmThreads` and `vmForks` pools, and `node:vm`. To skip these stops, add `**/node_modules/@fluffy-spoon/substitute/**` to the debugger's `skipFiles` (in VS Code's `launch.json`) or to its ignore list (in Chrome DevTools).

A getter of your own that throws, in an argument that cannot be read yet (see [How arguments are compared](#how-arguments-are-compared)), stops the debugger whenever the library reads it: at most once for each call or setup that passes the value (a call and the `.returns()` or other setup method chained to it count as one; and only the first of several calls with the same object, unless the member has setups with literal arguments), and up to once for each received call that a check compares the value with.

# Performance
A call or property read with small arguments takes a few microseconds. Measured on Node.js 22, 10,000 calls `sub.f(i)` take about 55 to 80 milliseconds, and 10,000 calls `app.a.b.c.d(i)` (four property reads and a call each) about 0.17 to 0.24 seconds. Much of that time goes into capturing where each call was made (see [Which calls lead to a setup or a check](#which-calls-lead-to-a-setup-or-a-check)); where V8 captures no stack frames, for example with `Error.stackTraceLimit` deleted, the same calls take about 28 to 35 and 40 to 50 milliseconds.

Finding the setup and the auto-substitute for a call does not scan earlier calls. It looks the arguments up by a hash whose cost is bounded, whatever their size or shape: nested objects, objects with cycles (such as a child that refers back to its parent), errors, long arrays, `Buffer`s and typed arrays, long strings, `Map`s, `Set`s, `Date`s or URLs. Measured on Node.js 22, each of these takes about 0.1 to 0.25 seconds: 10,000 calls with nested-object arguments, 4,000 setups with object arguments plus 4,000 matching calls, 10,000 calls with a different `Error` each, 10,000 calls with objects that refer back to their parent, 200 calls with different 1 MB strings, and 20 calls with arrays of 150,000 objects.

A URL of the global `URL` class (the one the library finds when it is loaded, a WHATWG `URL`) is hashed by its address, so calls with different URLs are told apart without comparing them, also when the URLs are inside other objects, and in fetch `Request`s on Node.js 20 and 22, which hold their URL. Measured on Node.js 22, 10,000 calls with different URLs take about 0.09 seconds, 10,000 calls with different URLs inside an object (`{ url, method }`) about 0.11 seconds, and 10,000 calls with different `Request`s about 0.21 seconds. Promises (on Node.js 24 and newer) and `WeakMap`s and `WeakSet`s (on Node.js 22 and newer), which Node.js compares by identity, are hashed by identity: 10,000 calls with different promises or `WeakMap`s take about 0.1 seconds.

The hash reads only a bounded part of each argument:

* at most 1,024 nested arrays and objects, which each of them shares evenly among its items, and at most 32 levels;
* of an array with more than 256 items, 256 of them: the first 64, the last 64 and 128 at a fixed stride;
* of a string or a byte array with more than 4,096 characters or bytes, 4,096 of them: the first 1,024, the last 1,024 and 2,048 at a fixed stride;
* of an object with more than 256 keys, and of a `Map` or `Set` with more than 256 entries (a wide one), every key and every value. An object among the values, a `Set` member that is an object, and a `Map` key that is an object count with a budget of 4 objects of their own, which they share among their values like any other object: enough for a small record and the objects right inside it. A wide object, `Map` or `Set` inside them counts only as such, and one that several of them share, or the container itself when they refer back to it, is listed at most once per call. Above 65,536 keys or entries, every key counts, but only about 256 of the values, chosen by their keys; the members of a `Set` that large, and the entries with object keys of a `Map` that large, count only shallowly.

Objects with many keys in common, such as snapshots of a state or translation tables per locale, need not have their keys listed, which is what costs most about them: the first object with at least 1,025 string keys gives a list of 1,025 of its keys, and a later object that has all the keys of that list is hashed by the values of those keys alone. The library makes up to 16 such lists per process, each from the first object with at least 1,025 string keys that does not have all the keys of an earlier list. An object is looked up in a list only when it has the two keys of the list with the lowest and the highest hash, so small objects that happen to share a key with such a list (such as `id`) cost nothing extra, and items of arrays and values inside a wide object, `Map` or `Set` are not looked up at all. Any other wide object has its keys listed once. The hash of a wide object, `Map` or `Set` is computed the first time it is passed, and remembered with it (weakly) for later calls; this does not change which setup a call matches (see [How arguments are compared](#how-arguments-are-compared) for objects that change after they were passed).

Arguments that a setup or an earlier call already used are found by identity first, so a large object that is passed again and again costs little. And a call is looked up among the setups with literal arguments only when one of them could match it: a call whose primitive arguments (numbers, strings and so on) are those of no such setup skips that lookup. Measured on Node.js 22:

* 10,000 calls that each pass one shared table with 300 to 10,000 keys, with a different first argument each time, take about 0.1 seconds, whatever the size of the table, and 2,000 calls with the same object with 10,000 keys about 25 milliseconds. 10,000 calls whose one argument is a small object or array that holds the shared table with 10,000 keys, such as `{ id, table }` or `[id, table]`, take about 0.2 seconds;
* 10 calls with 256 rows that share one object with 5,000 keys take about 17 milliseconds, 10 calls with 300 rows that share one `Map` with 10,000 entries about 20 to 25 milliseconds, and a setup with an object with 10,000 keys plus 1,000 calls with that object about 18 milliseconds;
* 10 calls with a `Map` of 2,000 records that share one object with 5,000 keys take about 20 milliseconds, 10 calls with tables of 300 such records about 15 milliseconds, and 10 calls with tables of 1,000 records that refer back to their table about 25 milliseconds;
* 200 calls with different objects with 5,000 keys each take about 30 milliseconds, and 100 calls with different objects with 70,000 keys each about 40 to 45 milliseconds;
* 50 calls with a normalized state whose `byId` holds 5,000 records take about 0.12 seconds, and 100 calls with different tables of 5,000 records, `Set`s of 5,000 records or `Map`s with 5,000 object keys and record values about 60 to 180 milliseconds;
* 1,000 calls that each pass a new array of 256 to 300 records with nested objects take about 0.25 seconds, the same per record for 257 records as for 256, and with 1,000 records each about 0.6 seconds;
* with 16 of the lists of keys above whose first key is `id`, 2,000 calls with arrays of 100 small records with an `id` take about 0.19 seconds, as without such lists.

Arguments with the same hash are told apart by comparing them in full, with `util.isDeepStrictEqual`, so a copy of an object only matches a setup or an earlier call after that comparison. For wide objects, it costs about 1.3 milliseconds per 5,000 keys: 200 setups with different objects with 5,000 keys plus 200 calls with copies of them take about 0.34 seconds, of which about 0.26 seconds is that comparison.

Arguments that differ only outside the parts that the hash reads get the same hash. They are still told apart correctly, but each new call is compared with every earlier call with that hash, so many such calls get slow: 200 calls with 1 MB strings of the same length that differ only in a few characters in the middle take about 1.6 to 1.8 seconds. The same applies to symbols with the same description (`Symbol('id')`), because a symbol is hashed by its description: 4,000 calls with such symbols take about 0.21 seconds. It applies as well to built-in objects whose state Node.js compares, but which have no keys that the hash could read: `crypto` `KeyObject`s and WebCrypto `CryptoKey`s. Measured on Node.js 22, 24 and 26, 2,000 calls with different secret `KeyObject`s take about 0.5 to 0.9 seconds, and 1,000 calls with different `CryptoKey`s about 1 to 1.1 seconds. The same goes for URLs of another `URL` class than the global one, such as jsdom's `window.URL` used from Node.js (`new JSDOM().window.URL`): Node.js compares them by their address, but the library does not recognise them as URLs. Measured on Node.js 22, 1,000 calls with different such URLs take about 0.5 seconds, 2,000 about 1.7 seconds and 4,000 about 7 seconds, while 4,000 calls with different Node.js URLs take about 0.04 seconds. Under `jest-environment-jsdom`, the global `URL` is jsdom's, so its URLs are hashed by their address: 4,000 calls take about 0.08 seconds. A value that cannot be read, such as an object with a getter that throws, is matched by its identity (see [How arguments are compared](#how-arguments-are-compared)) and read at most once per call: 4,000 calls with different such objects take about 0.1 seconds.

Setups with matchers cannot be looked up by a hash: a call tries the matcher setups of its member one by one. So many matcher setups on the same member slow down each call of it: 4,000 setups with `Arg.is()` plus 4,000 calls take about 0.9 seconds, and with a matcher inside an object (`find({ id: i, name: Arg.any() })`) about 10 seconds. A check goes through the received calls of the member that it checks.

A check written with the symbols, of a member that was never called, takes about 2 microseconds: measured on Node.js 22, 20,000 `sub[didNotReceive]().member(1)` or `sub[received](0).member()` checks take about 35 to 45 milliseconds in a fresh process (only the first 1,000 checks of a synchronous run record where they were made; see [received and didNotReceive](#received-and-didnotreceive)). With the string form, 20,000 `sub.didNotReceive().member(1)` checks take about 0.25 seconds.

A failed check builds a message from the calls that it lists (at most 50). Measured on Node.js 22, that takes about half a millisecond for small arguments, about 1.5 to 2 milliseconds when the listed calls print like the expected call two levels deep and differ further down (an object argument that differs only six levels down, also inside a `Map`, or a string of 300 characters that differs after the 200 that are shown), about 2 to 2.5 milliseconds when such calls are printed deeper (next to a matcher in the expected call, with their keys in another order, or with the difference inside a `Set` or among the other keys of an array), and about 4.5 milliseconds with 20 such arguments in each call, also when each of them holds a `Set`. The first message in a process takes about 4 to 9 milliseconds longer. To decide how deep to print the lines, the message compares the values as printing shows them, and looks at no more than 2,000 objects, keys, items and entries for that (see [received and didNotReceive](#received-and-didnotreceive)).

Each received call is kept until [`[clearReceivedCalls]()`](#clearing-received-calls), at about 300 bytes per call (measured on Node.js 22, 64-bit). A distinct unconfigured call also keeps its auto-substitute, about 200 bytes more, for as long as the substitute lives, so that the same call always returns the same auto-substitute; `[clearReceivedCalls]()` keeps those. A call through a chain of property reads keeps a record of each read as well: `app.a.b.c.d(i)` with a different `i` each time keeps about 1,350 bytes per call. Symbols passed as arguments are not kept alive by the library once the substitute is gone.

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
