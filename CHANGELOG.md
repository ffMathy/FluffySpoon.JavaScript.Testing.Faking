# Changelog
All notable changes to `@fluffy-spoon/substitute` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Upgrading? Read the [migration guide](MIGRATION.md).

## [2.0.1] - Unreleased
The first stable release of version 2 (there was no 2.0.0 release). It is published as the npm `latest` version, which was 1.208.0 until now. See the [migration guide](MIGRATION.md) for upgrading from 1.x or from a beta.

### Added
- Symbols for the library's methods, exported from the package root: `received`, `didNotReceive`, `clearReceivedCalls`, `mimick`, `configure`, `returns`, `throws`, `resolves`, `rejects` and `mimicks`. They always mean the library's method, so they handle members with the same names, and they work when two copies of the package are installed.
- `sub[configure]()`: a view of a substitute in which every call and property read is a setup. Use it to change a call that is already configured, or to configure a mimicked substitute.
- `sub[mimick](instance)`: hands everything that is not configured to a real instance. Calls are still recorded, and setups still win.
- `sub[clearReceivedCalls]()`: forgets the received calls of a substitute and its auto-substitutes, and keeps the setups.
- `SubstituteException` is exported from the package root, for `instanceof` checks.
- Auto-substitutes are cached, so nested setups and checks work at runtime: `app.getCalculator().add(1, 2).returns(99)` and `app.logger.received().info('hi')`.
- `Arg.all()` after other arguments matches the rest of the arguments, including none: `log('x', Arg.all())`.
- A native ES module entry point and an `exports` map, with typings for the `node16`, `nodenext` and `bundler` module resolutions. The ES module entry point shares one copy of the library with CommonJS.
- `console.log`, `util.inspect` and `String()` show a substitute's setups and received calls.
- The public typings carry documentation comments for editors.
- A [migration guide](MIGRATION.md), this changelog and [contributing guidelines](CONTRIBUTING.md). The README examples are type-checked and run in CI.

### Changed
- When several setups match a call, the most specific one wins: literal arguments, then matchers, then `Arg.all()` alone. Among setups of the same kind, the most recent one wins, and configuring the same call again replaces it. (The README said that the first matching setup wins.)
- A call with an argument matcher (`Arg.any`, `Arg.is`, `Arg.all`, also with `.not`) is always a setup or a check. It is never recorded as a received call and never runs an existing setup.
- Reading a method without calling it is no longer a call; method checks count invocations only.
- `received(count)` throws a `SubstituteException` unless the count is a non-negative integer (or left out). `received(0)` is the same as `didNotReceive()`.
- `Arg.any('object')` matches objects, arrays and substitutes, but no longer `null`. `Arg.any('function')` matches substitutes, and `Arg.any('array')` uses `Array.isArray`.
- `Arg.is()` throws a `TypeError` right away when it is not given a function. A predicate that throws counts as a non-match, and the failure message says so.
- Failure messages say what kind of call was expected (method calls, property reads or property assignments), with the expected arguments and the path of nested substitutes. They list at most 50 received calls. They contain ANSI colours only when the output is a terminal, and honour `NO_COLOR`, `FORCE_COLOR`, `NODE_DISABLE_COLORS` and `TERM=dumb`.
- Failed checks throw right away. Only a property-style check on a member that was called as a method can be reported later, on `process.nextTick` (see the README).
- TypeScript: on a type with a member called `received`, `didNotReceive`, `returns`, `throws`, `resolves`, `rejects` or `mimicks`, only the symbol forms `sub[received]()` and `sub[didNotReceive]()` are offered. `.returns()` and the other setup methods are offered unless the configured value has its own member with that name.
- TypeScript: a member called `then` is typed `never`, because substitutes are never thenables.
- The minimum TypeScript version is 3.6 (2.0.0-beta.4 needed 3.8). The package runs on Node.js 10 and newer with CommonJS, and 12.17 and newer as an ES module.
- Releases are published to npm with provenance: stable versions as `latest`, prereleases as `beta`.

### Fixed
- Configuring a call whose arguments overlap an existing setup ran that setup instead. It failed with `TypeError: ... returns is not a function`, or silently configured the wrong thing. This broke the README's "Match order" and "Partial mocks" examples.
- Checking a configured property ran its setup: it threw the configured error, used up values of a `returns()` sequence, ran `mimicks()` again or left an unhandled rejection.
- Calls through a stored or destructured method reference, or a callback, were recorded only once.
- Merely reading a method (for example to register it as a callback) satisfied `received().method(...)`.
- `.call()`, `.apply()` and `.bind()` on a configured method returned a proxy instead of the configured value.
- Checks on members called `returns`, `throws`, `resolves`, `rejects` or `mimicks` passed silently.
- `received(count)` with a negative, fractional or `NaN` count passed silently.
- A setup on the substitute leaked into nested members with the same name. Nested checks were checked against the root members, and code under test that read a nested member called `received` threw.
- `Arg.all()` after other arguments ignored those arguments.
- Every call scanned all earlier calls, which made large tests slow. 10,000 calls now take well under a second.
- A failed check overflowed the stack when substitutes referred to each other through their arguments, and threw a `TypeError` with `Error.stackTraceLimit = 0`.
- An exception thrown by an `Arg.is()` predicate escaped into the code under test.
- Failure messages for methods said "property calls" and left out the expected arguments.
- The symbol API did not work across two copies of the package.
- TypeScript: `mimicks()` on methods that return a union (including `boolean`); `received()` in generic helpers over `SubstituteOf<T>`; a member called `returns` removing `.returns()` from all properties; optional members; named members next to an index signature; overloads without parameters; methods with more than 5 overloads; `.throws()` on methods returning `never`; `(...args: unknown[])` methods; a private member called `received` turning the substitute type into `never`.
- Under native ES modules, the default import was the CommonJS module object, so `Substitute.for` was not a function.
- The package could not be loaded on Node.js versions before 14.18.
- A manual `npm publish` after `npm test` could publish a package without its entry point. `package-lock.json` had an outdated version.

### Removed
- `Substitute.disableFor()`. Call members with conflicting names directly, and use the symbols for the library's methods.
- `sub.clearSubstitute(clearType)` and the `ClearType` export. Use `sub[clearReceivedCalls]()`, or create a new substitute to drop setups.
- The string `sub.mimick(instance)`. Use `sub[mimick](instance)`; `mimick` is now an ordinary member name.
- The 2.0.0-beta deep import paths (`dist/Substitute`, `dist/Arguments`, `dist/SubstituteException`, ...). Import from the package root. Directory deep imports (`.../dist/api`) no longer resolve on Node.js versions that read `exports`.
- The GitHub Packages publishing job, which could not publish the `@fluffy-spoon` scope.

## [2.0.0-beta.4] - 2024-03-21
### Changed
- Failure messages list the received calls with the place each call was made, and mark the ones that matched ([#281](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/281)).

## [2.0.0-beta.3] - 2024-03-08
### Added
- Members used both as a property and as a method (callable interfaces) can be configured and checked in both ways ([#248](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/248)).
- Compatibility checks with the ava, jest, mocha, node:test and vitest test runners.

### Changed
- Tested on Node.js 18 and the current LTS versions; Node.js 10 was dropped from the test matrix ([#245](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/245)).

## [2.0.0-beta.2] - 2022-10-09
### Added
- The `ClearType` export, with the values for `clearSubstitute()` (`ClearType.receivedCalls`, ...).

### Changed
- The core was simplified ([#243](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/243)).
- `strict` mode, including `strictNullChecks`, is supported; it no longer needs to be turned off ([#244](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/244)).

### Fixed
- Typings for TypeScript versions before 4.6.

## [2.0.0-beta.1] - 2022-06-02
The version 2 rework ([#139](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/139)) was merged, with the same features as 2.0.0-beta.0.

## [2.0.0-beta.0] - 2021-10-24
### Added
- `sub.clearSubstitute(clearType)` with `ClearType` `'all'`, `'receivedCalls'` or `'substituteValues'` ([#233](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/233), [#46](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/issues/46)).

### Changed
- The substitution logic was rewritten ([#139](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/139), [#232](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/pull/232)).
- After a sequence of values (`returns(1, 2, 3)`), the last value repeats. Version 1 returned `undefined`.

## 1.x
Version 1 has no changelog. See the [GitHub releases](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/releases) and the [1.208.0 README](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/tree/v1.208.0#readme).

[2.0.1]: https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/compare/v2.0.0-beta.4...v2.0.1
[2.0.0-beta.4]: https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/compare/v2.0.0-beta.3...v2.0.0-beta.4
[2.0.0-beta.3]: https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/compare/v2.0.0-beta.2...v2.0.0-beta.3
[2.0.0-beta.2]: https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/compare/v2.0.0-beta.1...v2.0.0-beta.2
[2.0.0-beta.1]: https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/compare/v2.0.0-beta.0...v2.0.0-beta.1
[2.0.0-beta.0]: https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/compare/v1.208.0...v2.0.0-beta.0
