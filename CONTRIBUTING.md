# Contributing to @fluffy-spoon/substitute

Thanks for helping out! This document describes the development workflow: how to build and test the
library, how the packaging checks work, and how a release is published.

Bug reports and feature requests go to the [issue tracker](https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/issues).
Please include a small snippet that reproduces the problem, your TypeScript and Node.js versions, your module
system (CommonJS, native ESM or a bundler) and your test runner.

## Prerequisites

- Node.js: the version pinned in `package.json` under `volta` (currently 24.x). If you use [Volta](https://volta.sh)
  it is picked automatically. Any supported LTS line (22, 24 or 26) works for development.
- npm (comes with Node.js).

The published package itself supports much older Node.js versions than the development tooling. See
`engines.node` in `package.json`; CI smoke-tests the packed package on exactly that version.

## Install

```sh
npm ci
```

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The library source (TypeScript). `src/index.ts` is the public entry point. |
| `spec/` | The runtime specs, run with [ava](https://github.com/avajs/ava). |
| `spec-types/` | Type-level tests of the public typings (`npm run test:types`), and `spec-types/min-ts/`, which checks the built typings with the oldest supported TypeScript (`npm run test:types:min-ts`). |
| `spec-docs/` | The documentation check (`npm run test:docs`): it type-checks and runs the code examples of the README, MIGRATION and CHANGELOG. See [spec-docs/README.md](spec-docs/README.md). |
| `packaging/` | Packaging checks (run as part of `npm test`), the ES module wrapper generator and the smoke tests. |
| `compatibility-checks/` | A separate npm project that checks the packed package with ava, jest, mocha, node:test and vitest, and bundles it with Rollup, webpack, esbuild and Vite. |
| `dist/` | Build output that gets published (generated, not committed). |
| `dist-spec/` | Compiled specs used by `npm test` (generated, not committed). |

## Build

```sh
npm run build
```

This compiles `src/` into `dist/` with `tsc` (CommonJS plus `.d.ts` typings) and then runs
`packaging/build-esm.js`, which generates the native ES module entry point next to it:

- `dist/index.mjs` re-exports every export of `dist/index.js`, plus the default export. It wraps the CommonJS
  build instead of being a second copy, so CommonJS and ESM consumers share one module instance. Tools disagree
  about what a default import of a CommonJS module that sets `__esModule` is: Node.js, webpack and esbuild give
  `module.exports`, while Rollup's commonjs plugin, Vite SSR and vitest with inlined dependencies give
  `exports.default`, and vitest with inlined dependencies and `deps.interopDefault: false` gives an object
  without the named exports (with a namespace whose `default` is that object). The wrapper therefore imports
  both the default and the namespace of `dist/index.js` and uses whichever one holds every named export with the
  type it has at build time; it throws at import time if neither does. Its own default export is the named export
  `Substitute` (the default export of `dist/index.js`, found at build time), whatever the `default` of the view it
  reads from is. A packaging test simulates each of these interop shapes, and the compatibility checks bundle the
  package with the real tools.
- `dist/index.d.mts` holds the matching typings for TypeScript's `node16`, `nodenext` and `bundler` resolution.

The `exports` map in `package.json` sends `import` to the ES module entry and everything else (`require`, older
resolvers) to the CommonJS entry. `exports["."]` is an array: the conditions object comes first, and the plain
CommonJS entry `./dist/index.js` follows as a fallback for Node.js 13.0 and 13.1, which read `exports` but do not
understand conditions (without the fallback, `require` fails there). `main` and `types` are kept for resolvers that
do not read `exports`.

The package supports Node.js 10 and newer with `require`. The ES module entry needs Node.js 12.17 or newer on 12.x,
or 13.7 or newer (13.2 to 13.6 have ES modules but not the `import` condition, so `import` gets the CommonJS entry
and named imports fail there).

Deep imports of compiled files (`@fluffy-spoon/substitute/dist/...`) stay available through the `./dist/*`
subpaths, but they are not public API. Both forms, with and without `.js`, work on Node.js versions that ignore
`exports` (older than 12.17) and on versions with subpath patterns and pattern trailers (14.19 or newer on 14.x,
16.9 or newer). Deep imports fail on 12.17 to 12.19, all of 13.x and 14.0 to 14.12; on 12.20 to 12.22, 14.13 to
14.18 and 16.0 to 16.8 (subpath patterns without trailers), only the form without `.js` works. MIGRATION.md says the
same. `packaging/smoke/deep-import-support.js` holds this table, and `packaging/smoke/deep-imports.js` checks it
on the Node.js version it runs on.

Three directories have entries of their own in `exports`: `./dist/shared`, `./dist/api` and `./dist/api/types`, each
mapped to its `index` (`types` and `default`, with the plain CommonJS file as the array fallback, as for `"."`). These
are the directories that the published declarations import, and TypeScript 5.9 and older write such a directory
(`import("@fluffy-spoon/substitute/dist/shared")`) into the declaration files of a project that emits with
`moduleResolution: node` and exports a member of a check view or a matcher. `packaging/smoke/deep-imports.js`
requires these three directories on every Node.js version (and `deep-imports.mjs` imports them where it runs), and
`packaging/package.test.js` emits such declarations with `moduleResolution: node` and type-checks a project that
uses them with `node16`, `nodenext` (ES modules and CommonJS) and `bundler` resolution, without `skipLibCheck`. Other
directories, such as `dist/internals`, do not resolve where `exports` is read; no public declaration imports them.

## Test

```sh
npm test
```

`npm test` runs `npm run build:spec`, which compiles the specs together with the sources they import into
`dist-spec/`, and then ava once, over `spec/**/*.spec.ts`, `spec/**/*.test.ts` and `packaging/**/*.test.js`. It
never writes into `dist/`, so running the tests (or interrupting them) cannot leave a broken or missing `dist/` behind
for publishing or for `npm link`.

The run has a stall timeout of 3 minutes (ava's default of 10 seconds is too short for the packaging checks, which pack
a copy of the repository before their first test).

The tests are of two kinds:

- `spec/**/*.spec.ts` and `spec/**/*.test.ts`: the runtime behaviour of the library.
- `packaging/**/*.test.js`: packaging and release checks. They work on a temporary copy of the repository: the
  working tree as it is on disk (uncommitted changes included), without `dist/`, `dist-spec/`, `.git`, other
  dot-directories and `node_modules/` (the copy links to the repository's `node_modules/`). They put a stale
  `dist/` into the copy and pack it exactly like `npm publish` does, which rebuilds `dist/` there through the
  `prepack` script. They extract the tarball into a fresh consumer project and check it there: the tarball
  contents, `require` and native `import` (including the default import), deep imports, the ES module entry under
  each way that tools turn its CommonJS build into an ES module, TypeScript resolution in `node10`, `node16`,
  `nodenext` and `bundler` mode, and the consistency of `package.json`, `package-lock.json` and the workflows.
  The temporary directories are removed afterwards.

No test leaves files in the temporary directory (`os.tmpdir()`). A run leaves only Node.js' module compile cache there
(`node-compile-cache/`, which npm, npx and tsc write when they start, on Node.js 22.1 and newer; set
`NODE_COMPILE_CACHE` to another directory, or `NODE_DISABLE_COMPILE_CACHE=1`, to keep it out). ava keeps its cache in
`node_modules/.cache/ava`, where (outside CI) it notes the test files that failed, so that its next run starts with
them; a test in `spec/regression/fixes/round10-printing.test.ts` checks that the ava run leaves nothing in
`os.tmpdir()`.

To run a single file or test, use ava's options after building the specs, for example:

```sh
npm run build:spec && npx ava spec/regression/returns.spec.ts --match '*order*'
```

### Type tests

```sh
npm run test:types
```

Type-level tests in `spec-types/` check the public typings with the TypeScript compiler of this repository
(`spec-types/` with `strict`, `spec-types/loose/` without). `spec-types/declaration-emit/` is compiled with
`declaration: true` and `emitDeclarationOnly`, as a project with `declaration` or `composite` would build it: it
exports check views of substitutes, which must emit without errors (the README, "Typing limitations", says what
cannot be exported). It writes the declaration files into `node_modules/.cache/substitute-spec-types-declaration-emit`,
which git ignores. CI runs them with `npm run test:types --if-present`.

### Oldest supported TypeScript

```sh
npm run test:types:min-ts
```

The README promises TypeScript 3.6 or newer. This builds `dist/` and type-checks `spec-types/min-ts/consumer.ts`
against the built typings (resolved through `package.json` like an installed copy) with TypeScript 3.6 and 4.3 (a
version whose typing behaviour the consumer pins, `PINNED_TYPESCRIPT_VERSIONS` in `spec-types/min-ts/check.js`),
each with `skipLibCheck` off and on. These TypeScript versions are installed on the fly with `npx`, so this needs
access to the npm registry. To check other versions after `npm run build`, pass them explicitly (instead of the
default ones): `node spec-types/min-ts/check.js 3.9 4.0 4.4`. Keep `consumer.ts` to code that TypeScript 3.6 can parse (no
`@ts-expect-error`, for example). If a change makes the typings need a newer TypeScript, that is a breaking change:
raise `MINIMUM_TYPESCRIPT_VERSION` in `spec-types/min-ts/check.js` and the documented minimum together.
For each of these versions, it also compiles three fixtures of `spec-types/declaration-emit/`,
`R13TD-1.T73.check-views.ts`, `R14TD-1.annotated-generic-helpers.ts` and `R17FE-2.T83.check-view-type.ts`, against the
built typings with `declaration` and `emitDeclarationOnly`, into its temporary directory, which it removes afterwards
(printed as `ok   typescript@3.6 (declaration emit of check views and annotated generic helpers)`).
Afterwards the same script runs `spec-types/TD-10.T32.jsdoc.js` with the TypeScript of this repository: it checks
that the public API in the built typings carries documentation comments (editor quick info), and fails when one of
them is missing.

### Documentation examples

```sh
npm run test:docs
```

This builds `dist/` and checks every code example in `README.md`, `MIGRATION.md` and `CHANGELOG.md`: TypeScript
examples are type-checked against the built package and run, JavaScript examples are run, and their
`// prints ...` and `// throws ...` comments must hold. Relative links and `#anchors` must resolve. It then runs a
self-test against deliberately broken fixtures. A change to the library's behaviour or typings that breaks a
documented example fails this check, so update the example in the same change. How to write checked examples,
and the directives that mark blocks (`compile-only`, `esm`, `skip`, ...), are described in
[spec-docs/README.md](spec-docs/README.md).

The examples are type-checked with the `@types/node` of this repository (18.19.x). An example of what only older
`@types/node` versions declare, such as the README's limitations of Node.js' `EventEmitter<Events>` with
`@types/node` up to 24, is marked `types-node-below=25`: with a newer `@types/node`, the check says that it did not
check that block, instead of failing. The examples that need a test runner (jest, vitest) are marked `skip`, and the
compatibility checks below run the same code.

### Compatibility checks

`compatibility-checks/` is a separate npm project with its own dependencies. It runs against the packed package,
not against `src/`, and checks two things:

- `test/index.ts`: every supported test runner (ava, jest, mocha, node:test, vitest, and vitest with the package
  inlined through `vitest.inline.config.mts`) reports a failing Substitute assertion, including one that is thrown
  after the test function has returned, and checks what each runner then does with the tests around it, as README
  "Assertions that fail later" describes. For mocha, it does so with a synchronous test (`test-runners/mocha/`) and
  with an `async` test (`test-runners/mocha-async/`), which mocha reports twice, the second time as "done() called
  multiple times" (as long as the run is still going when the test's promise settles; README "Assertions that fail
  later" describes the other case). It also runs these suites, which must pass:
  - `test-runners/jest-matchers/` (`npm run validate:jest-matchers`): substitutes used inside jest matchers compare
    by identity, so a non-matching `expect(fn).toHaveBeenCalledWith(substitute)` fails and
    `expect(42).toEqual(substitute)` fails with jest's normal assertion error. It also checks that snapshots
    (`toMatchSnapshot()` against the committed `__snapshots__/`, and `toMatchInlineSnapshot()`) and failure diffs of
    values that hold substitutes print paths and do not show substitutes as mock functions, and that
    instances of classes that extend a substitute are ordinary objects in `toEqual()`, `toHaveBeenCalledWith()`,
    inline snapshots, setups and checks, and that jest's asymmetric matchers (`expect.any()`,
    `expect.objectContaining()`, ...) work as matchers in setups and checks, as README "Matchers of test runners"
    documents. `jest.fn(substitute)` must answer what the substitute answers (README "What counts as a call").
    `spyon-mimicked.spec.ts` checks `jest.spyOn()`, node:test's `mock.method()` and an instrumentation wrapper
    (`const original = obj.m; obj.m = wrap(original)`) on a substitute that mimicks an instance: setups still
    answer, each call is recorded once, and the restore gives the instance its function back (README "Partial
    mocks" and "Test runners"). `spies-mimicked-round18.spec.ts` checks node:test's `mock.method()` with an
    implementation (setups first, then the mock) and that the instance's own calls through `this` of a member that
    `jest.spyOn()`, node:test or a wrapper replaced are not recorded, and `sinon-mimicked-round18.spec.ts` pins what
    sinon (22, a dev dependency of the checks) does on a mimicked substitute: `sinon.replace()` for an own method,
    the `TypeError`s of `spy()`, `stub()` and, for a method on a class prototype, `replace()`, and sinon on the
    instance itself (README "Test runners").
  - `test-runners/vitest-matchers/` (`npx vitest run ./test-runners/vitest-matchers/index.spec.ts`): the same for
    vitest's matchers, snapshots and diffs (including the checks and setups with vitest's asymmetric matchers that the
    README's vitest example makes, and `vi.fn(substitute)`), and how vitest and `util.inspect` see printed, frozen and
    `in`-probed substitutes.
  - `test-runners/jest-modules/` (`npm run validate:jest-modules-ts` and `npm run validate:jest-modules-babel`): a
    substitute that stands in for a whole module (a `jest.mock()` factory), imported by the code under test as a
    namespace, with named imports, with a default and named import together, and as a default export through the
    factory that README "Mocking a whole module" documents, and a module re-exported by a barrel (`export *`), mocked
    either through the barrel itself or with a plain object of the substitute's members (`barrel-substitute.spec.ts`,
    `barrel-members.spec.ts`). It runs once compiled by ts-jest with `esModuleInterop`
    (`jest.modules.ts-jest.config.js`) and once by babel-jest (`jest.modules.babel.config.js`).
  - Module mocks that need a plain object of a substitute's members, as README "Mocking a whole module" shows:
    vitest's `vi.mock()` (`test-runners/vitest-modules/`, `npm run validate:vitest-modules`), node:test's
    `mock.module()` (`test-runners/nodejs-modules/`, `npm run validate:nodejs-modules`, with
    `--experimental-test-module-mocks`) and jest's `unstable_mockModule()` for native ES modules
    (`test-runners/jest-esm-modules/`, `npm run validate:jest-modules-esm`, with `--experimental-vm-modules` and
    `jest.modules.esm.config.js`). That run also checks vitest's `vi.spyOn()` (the `spyOn()` of `@vitest/spy`) on
    substitutes that mimick an instance and on those that do not (`spies-mimicked.test.mjs`), and that the
    instance's own calls through `this` of a member that `vi.spyOn()` replaced stay its own
    (`spies-mimicked-round18.test.mjs`).
  - `test-runners/tsx-lines/`: the same checks of the line rules (README "Which calls lead to a setup or a check",
    "Lines in transpiled test files") run with `node --import tsx` (`checks.ts` and `checks.mts`) and with
    `node --require tsx/cjs`, which put each file on one line, and must give what they give with a statement per
    line of the code that runs.
- `test/bundlers.ts`: `bundlers/entry.mjs` is bundled with Rollup and `@rollup/plugin-commonjs`, webpack, esbuild
  (CommonJS and ES module output) and a Vite SSR build with `ssr.noExternal`, and each bundle is run with Node.js.
  The default, named and namespace imports must be the real exports. vitest with `server.deps.inline` runs
  `test-runners/vitest-inline/exports.test.ts`, which checks the same, once with `vitest.inline.config.mts` and
  once with `vitest.inline-no-interop-default.config.mts`, which also sets `deps.interopDefault: false`.
  It also bundles `bundlers/require-entry.mjs`, which imports CommonJS code that `require()`s the package
  (`bundlers/require-helper.cjs`). With `@rollup/plugin-commonjs` on default options and the package kept external,
  that `require()` gets the `Substitute` class instead of the exports object (Vite 7 and older SSR builds do the
  same, since they externalize dependencies). README "Importing" and MIGRATION "Imports and packaging" document
  this and its workarounds, and the check makes sure each of them gives the exports object:
  `commonjs({ esmExternals: true })`, `commonjs({ esmExternals: ['@fluffy-spoon/substitute'] })`, bundling the
  package, Vite's `ssr.noExternal: ['@fluffy-spoon/substitute']`, and the default externals of the Vite version
  in use (Vite 8 bundles with Rolldown and is not affected). It also checks that the caveat itself still holds,
  so the documentation is updated when the tools change.
  Finally, it bundles ES module code into CommonJS output with the package kept external: Rollup with
  `output.format: 'cjs'`, esbuild with `format: 'cjs'` and `packages: 'external'`, webpack with a `commonjs`
  external, and a Vite SSR build with `output.format: 'cjs'`. Such a bundle `require()`s the package at run time,
  and its default import follows Node.js's CommonJS interop: it is the exports object, not the `Substitute` class
  (with Rollup for every source; with esbuild, webpack and Rolldown, which Vite 8 uses, for `.mjs` sources and
  sources in a `"type": "module"` package). README "Importing" and MIGRATION "Imports and packaging" recommend the
  named import there. The check bundles `bundlers/named-entry.mjs`, which uses only the named import, with each of
  them; bundles `bundlers/entry.mjs` with Rollup's `output.interop: 'auto'`, which makes the default import work;
  and checks that the caveat itself still holds for `bundlers/entry.mjs` with each of them.
  Bundles that keep the package external are written to `node_modules/.substitute-bundles/` there, where Node.js can
  resolve the installed package, and removed afterwards.

Run them with:

```sh
cd compatibility-checks
npm ci
npm test
```

`npm test` there first runs `npm run install:local`, which packs the repository root like `npm publish`
(building `dist/` on the way) and installs the tarball with `npm install --no-save`, so neither `package.json`
nor `package-lock.json` of the compatibility checks changes. From the repository root, `npm run test:compat`
does the same once the compatibility check dependencies are installed.

To try a single runner by hand after `npm run install:local`, use `npm run validate:<runner>` (`ava`, `jest`,
`mocha`, `mocha-async`, `nodejs`, `vitest` or `vitest-inline`). Each of them is expected to fail with exactly one
failing test (`mocha-async` lists it twice, as "2 failing").
`npm run validate:jest-matchers`, `npm run validate:jest-modules-ts`, `npm run validate:jest-modules-babel`,
`npm run validate:jest-modules-esm`, `npm run validate:nodejs-modules` and `npm run validate:vitest-modules` are the
exceptions: they are expected to pass, as is the vitest-matchers suite.

## Continuous integration

`.github/workflows/nodejs.yml` runs on every push and pull request:

- **test**: `npm ci`, `npm run build`, `npm test`, `npm run test:types --if-present` and
  `npm run test:docs` on every supported Node.js LTS line (22, 24 and 26).
- **types-min-ts**: `npm run test:types:min-ts`: the built typings with the oldest supported TypeScript (3.6) and
  with 4.3, and the documentation comments of the public API, on the development
  Node.js version.
- **compatibility**: the compatibility checks against the packed package on the same Node.js versions.
- **minimum-node**: packs the package and smoke-tests it (`packaging/smoke/`) on the oldest supported Node.js
  version (`MINIMUM_NODE_VERSION`, which must equal `engines.node`), on the oldest version with native ES
  modules (`MINIMUM_ESM_NODE_VERSION`, 12.17.0), on 13.0.0 (`EXPORTS_FALLBACK_NODE_VERSION`, which only loads the
  package through the `exports["."]` fallback) and on 13.7.0 (`MINIMUM_ESM_NODE_13_VERSION`, the oldest 13.x with
  the `import` condition). On each of them, `deep-imports.js` also checks that deep imports work or fail as
  described under [Build](#build). If a change needs a newer Node.js, raise `engines.node` and
  `MINIMUM_NODE_VERSION` together; a packaging test checks that they match.

`.github/workflows/codeql-analysis.yml` runs CodeQL on pushes and pull requests to `master` and weekly.

## Releasing

Releases are published to npm by `.github/workflows/npm-publish.yml` when a GitHub release is published.

1. Bump the version with npm, which updates `package.json` and `package-lock.json` together and creates the
   matching git tag:

   ```sh
   npm version 2.0.2              # or: npm version patch | minor | major
   npm version 2.1.0-beta.1       # a prerelease
   ```

2. Push the commit and the tag: `git push --follow-tags`.
3. Create a GitHub release for that tag (for example `v2.0.2`) and publish it. A draft does nothing until it is
   published.

The publish workflow then:

1. runs the complete CI workflow above (tests, type tests, compatibility checks and the oldest Node.js versions);
2. checks that the release tag matches the `package.json` version (`v2.0.2` or `2.0.2` for version 2.0.2) and
   stops otherwise;
3. picks the npm dist-tag with `packaging/dist-tag.js`: `latest` for a stable version such as 2.0.1, `beta` for a
   prerelease version such as 2.1.0-beta.1 or for a release that is marked as a prerelease on GitHub;
4. runs `npm publish --provenance --access public --tag <dist-tag>`. The `prepack` script rebuilds `dist/` from
   scratch first.

Publishing uses the `NPM_PUBLISH_TOKEN` repository secret (a granular npm access token with publish rights for
`@fluffy-spoon/substitute`). The job also has the `id-token: write` permission, so npm attaches a provenance
statement, and npm's trusted publishing works once it is configured for this repository on npmjs.com.

The package is only published to npm. GitHub Packages is not used: it only accepts npm packages whose scope
is the repository owner (`@ffmathy`), so it cannot host `@fluffy-spoon/substitute`.

Never publish by hand from a working copy unless you have to. If you do, `npm publish` still runs `prepack`,
so the published `dist/` is always a fresh build.
