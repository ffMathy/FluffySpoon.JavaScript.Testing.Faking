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

## Test

```sh
npm test
```

`npm test` runs `npm run build:spec`, which compiles the specs together with the sources they import into
`dist-spec/`, and then ava twice. It never writes into `dist/`, so running the tests (or interrupting them) cannot
leave a broken or missing `dist/` behind for publishing or for `npm link`.

The first ava run (`ava`, configured by `ava.config.js`) runs every test file except the timing-sensitive ones, with
ava's usual parallelism. The timing-sensitive files are the spec files with performance limits (timings, and ratios
of timings), listed once as `timingSensitive` in `ava.config.js`: `spec/regression/fixes/*hashing*.test.ts`,
`spec/regression/fixes/performance.test.ts`, `spec/regression/fixes/round5.test.ts`,
`spec/regression/fixes/round8.test.ts` and `spec/regression/fixes/ported-from-a.spec.ts`. The second run,
`ava --config ava.perf.config.js --serial --concurrency=1`, runs only those, one test at a time, so that other test
files cannot slow them down. Tests that compare timings take the median of several interleaved rounds, and check
the ratios with `assertRatiosWithin()` from `spec/helpers/timing.ts`: a measurement whose ratio is over its limit is
made again, up to three measurements in all (`RATIO_ATTEMPTS`), and the smallest ratio of each kind decides, so that
load that comes and goes during one measurement does not fail the test, while a real slowdown, which is over the limit
in every measurement, still does. Every measurement is logged. A test in
`spec/regression/fixes/round10-hashing.test.ts` checks that no timing-sensitive file compares a ratio of timings with
its limit directly. Absolute limits (such as 10,000 calls in under 1 s) are checked with `timeLimit()` and
`assertWithin()` from
`spec/helpers/timing.ts`. Right before the measurement, the helper times a fixed CPU-bound workload in the same
process, and scales the limit by that time over the workload's time on an idle machine (`IDLE_WORKLOAD_MS`, 9 ms),
clamped to between 1 and 4 (`MAX_FACTOR`). If a measurement exceeds its limit, it is judged once more against the
larger of that factor and one measured right after it. A busy machine slows the workload as much as the test, so the
limit grows with the load, while an algorithmic regression still fails, as no limit grows beyond 4 times. Every check
logs its time, limit and factor. A new timing test must use the helper: a test in
`spec/regression/fixes/round9-hashing.test.ts` checks that no timing-sensitive file compares a time with a fixed
number. To reproduce a busy machine, start the busy loops (for example `node -e 'for (;;) {}'`, 12 of them for 4
cores) in the same shell session as `npm test`: Linux groups the processes of a session for scheduling (autogroup),
so loops started in another terminal barely slow the tests down. Both runs
have a stall timeout of 3 minutes (ava's default of 10 seconds is too short for the packaging checks and the long
serial tests on a busy machine). A new spec file that measures time must be added to `timingSensitive`: a test in
`spec/regression/fixes/round8-hashing.test.ts` checks that every spec file that reads a clock or imports
`spec/helpers/timing.ts` runs in the second run, and that every spec file runs in exactly one of the two.

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
them; a test in `spec/regression/fixes/round10-hashing.test.ts` checks that the two ava runs leave nothing in
`os.tmpdir()`.

To run a single file or test, use ava's options after building the specs, for example:

```sh
npm run build:spec && npx ava spec/regression/returns.spec.ts --match '*order*'
```

A timing-sensitive file needs the second configuration, because the first one leaves it out (plain `npx ava <file>`
runs nothing for it):

```sh
npm run build:spec && npx ava --config ava.perf.config.js spec/regression/fixes/performance.test.ts
```

### Type tests

```sh
npm run test:types
```

Type-level tests in `spec-types/` check the public typings with the TypeScript compiler of this repository
(`spec-types/` with `strict`, `spec-types/loose/` without). CI runs them with `npm run test:types --if-present`.

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
Afterwards the same script runs two more checks with the TypeScript of this repository:

- `spec-types/TD-10.T32.jsdoc.js` checks that the public API in the built typings carries documentation comments
  (editor quick info). It fails when one of them is missing.
- `spec-types/R6V-5.R6TD-2.T44.check-cost.js` checks the type-check cost of a substitute of a large union: it
  compiles `spec-types/R6V-5.R6TD-2.T44.element-union.ts` (a substitute of the union of all lib.dom element types)
  against the built typings and fails when that needs more type instantiations than its budget,
  `INSTANTIATION_BUDGET` in the script: 470,000 (469,885 with TypeScript 5.9.2 now, so 115 to spare: a change to the
  typings that adds work for every member fails it). Instantiation counts are deterministic, unlike timings. A change
  to the typings that needs more must make them cheaper, or raise the budget in the same change with a reason in the
  script's header. To run it alone: `npm run build && node spec-types/R6V-5.R6TD-2.T44.check-cost.js`.

  The budget covers TypeScript 5.9 only. On older TypeScript, large unions cost more, and that cost is accepted as it
  is (README, "Typing limitations"). Check times measured on Node.js 22 with `strict` and `skipLibCheck`, best of 3:
  the T44 fixture takes 4.6 s on TypeScript 3.6, 4.0 s on 4.2, 4.9 s on 4.5, 2.7 s on 5.9 and 1.5 s on 7.0; a
  substitute of a union of 60 interfaces whose methods have different parameter lists takes 32 s on 3.6 and 39 s on
  4.2 (those versions merge the signatures of each variant's members in quadratic time, and the per-arity signatures
  of such methods multiply them), 4.2 s on 4.5, 3.3 s on 5.9 and 1.4 s on 7.0; a few setups on Node.js'
  `EventEmitter<Events>` (`@types/node` 18) take 0.32 to 0.36 s on 4.8 to 5.9 and 0.05 s on 7.0, mostly for its
  generic methods, whose signatures are built when the substitute is compared with `EventEmitter`. A change to the
  typings should not make these slower; compare before and after on TypeScript 3.6 and 5.9.

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

### Compatibility checks

`compatibility-checks/` is a separate npm project with its own dependencies. It runs against the packed package,
not against `src/`, and checks two things:

- `test/index.ts`: every supported test runner (ava, jest, mocha, node:test, vitest, and vitest with the package
  inlined through `vitest.inline.config.mts`) reports a failing Substitute assertion, including one that is thrown
  after the test function has returned. It also runs these suites, which must pass:
  - `test-runners/jest-matchers/` (`npm run validate:jest-matchers`): substitutes used inside jest matchers compare
    by identity, so a non-matching `expect(fn).toHaveBeenCalledWith(substitute)` fails and
    `expect(42).toEqual(substitute)` fails with jest's normal assertion error. It also checks that snapshots
    (`toMatchSnapshot()` against the committed `__snapshots__/`, and `toMatchInlineSnapshot()`) and failure diffs of
    values that hold substitutes finish quickly, print paths, and do not show substitutes as mock functions, and that
    instances of classes that extend a substitute are ordinary objects in `toEqual()`, `toHaveBeenCalledWith()`,
    inline snapshots, setups and checks.
  - `test-runners/vitest-matchers/` (`npx vitest run ./test-runners/vitest-matchers/index.spec.ts`): the same for
    vitest's matchers, snapshots and diffs, and how vitest and `util.inspect` see printed, frozen and `in`-probed
    substitutes.
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
    `jest.modules.esm.config.js`).
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
`mocha`, `nodejs`, `vitest` or `vitest-inline`). Each of them is expected to fail with exactly one failing test.
`npm run validate:jest-matchers`, `npm run validate:jest-modules-ts`, `npm run validate:jest-modules-babel`,
`npm run validate:jest-modules-esm`, `npm run validate:nodejs-modules` and `npm run validate:vitest-modules` are the
exceptions: they are expected to pass, as is the vitest-matchers suite.

## Continuous integration

`.github/workflows/nodejs.yml` runs on every push and pull request:

- **test**: `npm ci`, `npm run build`, `npm test` (both ava runs), `npm run test:types --if-present` and
  `npm run test:docs` on every supported Node.js LTS line (22, 24 and 26).
- **types-min-ts**: `npm run test:types:min-ts`: the built typings with the oldest supported TypeScript (3.6) and
  with 4.3, the documentation comments of the public API, and the type-check cost budget, on the development
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
