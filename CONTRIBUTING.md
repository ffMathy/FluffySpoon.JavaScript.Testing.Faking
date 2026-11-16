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
  `exports.default`. The wrapper therefore imports both the default and the namespace of `dist/index.js`, uses
  whichever one holds the complete exports, and throws at import time if neither does. A packaging test simulates
  each of these interop shapes, and the compatibility checks bundle the package with the real tools.
- `dist/index.d.mts` holds the matching typings for TypeScript's `node16`, `nodenext` and `bundler` resolution.

The `exports` map in `package.json` sends `import` to the ES module entry and everything else (`require`, older
resolvers) to the CommonJS entry. `exports["."]` is an array: the conditions object comes first, and the plain
CommonJS entry `./dist/index.js` follows as a fallback for Node.js 13.0 and 13.1, which read `exports` but do not
understand conditions (without the fallback, `require` fails there). `main` and `types` are kept for resolvers that
do not read `exports`.

The package supports Node.js 10 and newer with `require`. The ES module entry needs Node.js 12.17 or newer on 12.x,
or 13.7 or newer (13.2 to 13.6 have ES modules but not the `import` condition, so `import` gets the CommonJS entry
and named imports fail there). Deep
imports of compiled files (`@fluffy-spoon/substitute/dist/...`, with or without `.js`) stay available through
the `./dist/*` subpaths, but they are not public API.

## Test

```sh
npm test
```

`npm test` runs `npm run build:spec`, which compiles the specs together with the sources they import into
`dist-spec/`, and then ava. It never writes into `dist/`, so running the tests cannot leave a broken `dist/`
behind for publishing.

ava runs two groups of tests:

- `spec/**/*.spec.ts` and `spec/**/*.test.ts`: the runtime behaviour of the library.
- `packaging/**/*.test.js`: packaging and release checks. They pack the repository exactly like `npm publish`
  does (which rebuilds `dist/` through the `prepack` script), extract the tarball into a fresh consumer project
  and check it there: the tarball contents, `require` and native `import` (including the default import),
  deep imports, TypeScript resolution in `node10`, `node16`, `nodenext` and `bundler` mode, and the consistency
  of `package.json`, `package-lock.json` and the workflows.

To run a single file or test, use ava's options after building the specs, for example:

```sh
npm run build:spec && npx ava spec/regression/returns.spec.ts --match '*order*'
```

### Type tests

```sh
npm run test:types
```

Type-level tests check the public typings with the TypeScript compiler. CI runs them with
`npm run test:types --if-present`.

### Compatibility checks

`compatibility-checks/` is a separate npm project with its own dependencies. It runs against the packed package,
not against `src/`, and checks two things:

- `test/index.ts`: every supported test runner (ava, jest, mocha, node:test, vitest, and vitest with the package
  inlined through `vitest.inline.config.mts`) reports a failing Substitute assertion, including one that is thrown
  after the test function has returned.
- `test/bundlers.ts`: `bundlers/entry.mjs` is bundled with Rollup and `@rollup/plugin-commonjs`, webpack, esbuild
  (CommonJS and ES module output) and a Vite SSR build with `ssr.noExternal`, and each bundle is run with Node.js.
  The default, named and namespace imports must be the real exports. vitest with `server.deps.inline` runs
  `test-runners/vitest-inline/exports.test.ts`, which checks the same.

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

## Continuous integration

`.github/workflows/nodejs.yml` runs on every push and pull request:

- **test**: `npm ci`, `npm run build`, `npm test` and `npm run test:types --if-present` on every supported
  Node.js LTS line (22, 24 and 26).
- **compatibility**: the compatibility checks against the packed package on the same Node.js versions.
- **minimum-node**: packs the package and smoke-tests it (`packaging/smoke/`) on the oldest supported Node.js
  version (`MINIMUM_NODE_VERSION`, which must equal `engines.node`), on the oldest version with native ES
  modules (`MINIMUM_ESM_NODE_VERSION`, 12.17.0), on 13.0.0 (`EXPORTS_FALLBACK_NODE_VERSION`, which only loads the
  package through the `exports["."]` fallback) and on 13.7.0 (`MINIMUM_ESM_NODE_13_VERSION`, the oldest 13.x with
  the `import` condition). If a change needs a newer Node.js, raise `engines.node` and `MINIMUM_NODE_VERSION`
  together; a packaging test checks that they match.

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
