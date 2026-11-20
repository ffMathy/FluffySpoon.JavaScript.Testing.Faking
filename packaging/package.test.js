'use strict'
// Packaging, release and CI checks. These run as part of `npm test` (see ava.config.js).
// They pack the repository the way `npm publish` does and use the tarball from a fresh consumer project.
const test = require('ava')
const { execFile, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const {
  root, readText, readJson, copyRepository, snapshotDirectory, pack, createConsumer, runNode, childEnvironment,
  makeTemporaryDirectory, removeTemporaryDirectories
} = require('./helpers')

const packageJson = readJson('package.json')
const ciWorkflow = readText('.github/workflows/nodejs.yml')
const publishWorkflow = readText('.github/workflows/npm-publish.yml')
const minutes = n => n * 60 * 1000

/** Runs a command without blocking, so that slow checks run concurrently. */
const run = (command, args, cwd) => new Promise(resolve => {
  execFile(command, args, { cwd, encoding: 'utf8', env: childEnvironment() }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: stdout + stderr })
  })
})

const state = {}

test.before('pack a copy of the repository like npm publish does', t => {
  t.timeout(minutes(5))
  // PK4-4: everything below happens in a temporary copy of the working tree, so `npm test` never writes into the
  // working tree's dist/ (an interrupted run once left no dist/ at all).
  state.distBefore = snapshotDirectory(path.join(root, 'dist'))
  const copy = copyRepository(makeTemporaryDirectory('repository'))
  // Start from a stale dist/ like the one `npm test` used to leave behind: spec output and no dist/index.js.
  // Packing must rebuild the library from scratch.
  fs.mkdirSync(path.join(copy, 'dist', 'spec'), { recursive: true })
  fs.writeFileSync(path.join(copy, 'dist', 'spec', 'Stale.spec.js'), '')

  const destination = makeTemporaryDirectory('pack')
  state.packed = pack(destination, copy)
  state.distAfter = snapshotDirectory(path.join(root, 'dist'))
  state.consumer = createConsumer(state.packed.tarball)
  for (const file of fs.readdirSync(path.join(__dirname, 'smoke'))) {
    fs.copyFileSync(path.join(__dirname, 'smoke', file), path.join(state.consumer, file))
  }
})

test.after.always('remove temporary directories', () => {
  removeTemporaryDirectories()
})

test('G:PK-3 npm pack rebuilds dist/ first: the tarball has the entry points and no stale or spec output', t => {
  const { files } = state.packed
  for (const entry of ['dist/index.js', 'dist/index.d.ts', 'dist/index.mjs', 'dist/index.d.mts', 'package.json', 'README.md', 'LICENSE']) {
    t.true(files.includes(entry), `${entry} is in the tarball`)
  }
  t.deepEqual(files.filter(file => /(^|\/)spec(\/|$)|\.spec\.|\.test\.|dist-spec/.test(file)), [], 'no spec output in the tarball')
  t.deepEqual(files.filter(file => !file.startsWith('dist/') && !['package.json', 'README.md', 'LICENSE'].includes(file)), [], 'only dist/ and the package metadata are published')
  t.is(packageJson.scripts.prepack, 'npm run build', 'prepack builds the library')
})

test('G:PK-3 npm test compiles the specs into dist-spec/, so it never leaves dist/ unpublishable', t => {
  const avaConfig = require('../ava.config.js')
  t.deepEqual(avaConfig.typescript.rewritePaths, { '/': 'dist-spec/' })
  t.regex(packageJson.scripts['build:spec'], /--outDir dist-spec\b/)
  t.regex(packageJson.scripts.test, /^npm run build:spec && ava\b/)
  t.false(/\bnpm run build\b(?!:)/.test(packageJson.scripts.test), 'npm test does not run the library build with other options')
})

test('PK4-4 the packaging checks pack a temporary copy of the repository and never write into the working tree\'s dist/', t => {
  // Packing (which rebuilds dist/ through prepack) and the stale dist/ it starts from happened in the copy.
  t.deepEqual(state.distAfter, state.distBefore, 'dist/ of the working tree is exactly as it was before packing')
  t.false(state.packed.tarball.startsWith(root + path.sep), 'the tarball is written outside the working tree')
  // CONTRIBUTING.md says so, and that is now true.
  const contributing = readText('CONTRIBUTING.md').replace(/\s+/g, ' ')
  t.true(contributing.includes('never writes into `dist/`'), 'CONTRIBUTING.md says that npm test never writes into dist/')
  t.regex(contributing, /temporary copy of the repository/, 'CONTRIBUTING.md says that the packaging checks pack a temporary copy')
})

test('DOCS:ESM the default import is the Substitute class under native ESM', t => {
  const output = runNode(state.consumer, ['import.mjs'])
  t.regex(output, /import smoke test passed/)
})

test('DOCS:ESM CommonJS require, deep imports and package.json still work with the exports map', t => {
  t.regex(runNode(state.consumer, ['require.js']), /require smoke test passed/)
  t.regex(runNode(state.consumer, ['deep-imports.js']), /deep import smoke test passed/)
  t.regex(runNode(state.consumer, ['deep-imports.mjs']), /ESM deep import smoke test passed/)
})

// F1: tools that bundle or transform the package turn dist/index.js (CommonJS, with __esModule and exports.default)
// into an ES module in different ways. Each shape below is what one family of tools makes of it for the
// `import ... from './index.js'` in dist/index.mjs. compatibility-checks/test/bundlers.ts checks the real tools.
const commonJsViews = [
  { name: 'Node.js 12.17 to 14.12 (module.exports, no named exports)', defaultExport: 'real', namedExports: false },
  { name: 'Node.js 14.13+, webpack, esbuild and Rolldown (module.exports and the named exports)', defaultExport: 'real', namedExports: true },
  { name: 'the __esModule interop of Rollup\'s commonjs plugin, Vite SSR and vitest inlining (exports.default and the named exports)', defaultExport: 'real.default', namedExports: true }
]

/**
 * Writes a directory where dist/index.mjs imports an index.js that has the given shape. `defaultExport` is the
 * source of index.js's default export; `namedExports` is false (none), true (the real ones) or 'undefined' (every
 * named export present, but undefined).
 */
const simulateCommonJsView = (directory, cjsEntry, names, { defaultExport, namedExports }) => {
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  fs.copyFileSync(path.join(state.consumer, 'node_modules', '@fluffy-spoon', 'substitute', 'dist', 'index.mjs'), path.join(directory, 'index.mjs'))
  const namedExportValue = name => namedExports === 'undefined' ? 'undefined' : `real.${name}`
  fs.writeFileSync(path.join(directory, 'index.js'), [
    "import { createRequire } from 'module'",
    `const real = createRequire(import.meta.url)(${JSON.stringify(cjsEntry)})`,
    `export default ${defaultExport}`,
    ...(namedExports ? names.filter(name => name !== 'default').map(name => `export const ${name} = ${namedExportValue(name)}`) : []),
    ''
  ].join('\n'))
  fs.writeFileSync(path.join(directory, 'check.mjs'), [
    "import assert from 'assert'",
    "import { createRequire } from 'module'",
    "import Substitute, * as namespace from './index.mjs'",
    `const real = createRequire(import.meta.url)(${JSON.stringify(cjsEntry)})`,
    "assert.strictEqual(Substitute, real.default, 'the default import is the Substitute class')",
    "assert.deepStrictEqual(Object.keys(namespace).sort(), Object.keys(real).sort(), 'the same export names')",
    "for (const name of Object.keys(real)) assert.strictEqual(namespace[name], real[name], name)",
    "console.log('ok')",
    ''
  ].join('\n'))
}

test('F1 the ES module entry gives the real exports whichever CommonJS interop the importer applies', t => {
  const cjsEntry = path.join(state.consumer, 'node_modules', '@fluffy-spoon', 'substitute', 'dist', 'index.js')
  const names = Object.keys(require(cjsEntry))
  commonJsViews.forEach((view, index) => {
    const directory = path.join(state.consumer, `interop-${index}`)
    simulateCommonJsView(directory, cjsEntry, names, view)
    const result = spawnSync(process.execPath, ['check.mjs'], { cwd: directory, encoding: 'utf8', env: childEnvironment() })
    t.is(result.status, 0, `${view.name}: ${result.stdout}${result.stderr}`)
  })

  // A view that has neither shape fails loudly at import time instead of exporting undefined values.
  const unusableViews = [
    { name: 'an empty default import and no named exports', defaultExport: '{}', namedExports: false },
    { name: 'the Substitute class as the default import and undefined named exports', defaultExport: 'real.default', namedExports: 'undefined' }
  ]
  unusableViews.forEach((view, index) => {
    const directory = path.join(state.consumer, `interop-unusable-${index}`)
    simulateCommonJsView(directory, cjsEntry, names, view)
    const result = spawnSync(process.execPath, ['check.mjs'], { cwd: directory, encoding: 'utf8', env: childEnvironment() })
    t.not(result.status, 0, view.name)
    t.regex(result.stderr, /could not read the exports of its CommonJS build/, view.name)
  })
})

test('PK4-2 the ES module entry uses the named exports when the default import is an object without them (vitest server.deps.inline with deps.interopDefault: false)', t => {
  const cjsEntry = path.join(state.consumer, 'node_modules', '@fluffy-spoon', 'substitute', 'dist', 'index.js')
  const names = Object.keys(require(cjsEntry))
  // What vitest 3 and 5 hand dist/index.mjs with server.deps.inline and deps.interopDefault: false: the default import
  // is an object with only some of the exports (SubstituteException and default), and the namespace has every named
  // export plus that object as its default, not the Substitute class.
  const directory = path.join(state.consumer, 'interop-vitest-inline-no-interop-default')
  simulateCommonJsView(directory, cjsEntry, names, {
    defaultExport: '{ SubstituteException: real.SubstituteException, default: real.default }',
    namedExports: true
  })
  const result = spawnSync(process.execPath, ['check.mjs'], { cwd: directory, encoding: 'utf8', env: childEnvironment() })
  t.is(result.status, 0, result.stdout + result.stderr)
  t.regex(result.stdout, /^ok$/m)

  // The wrapper's default export is the class that dist/index.js exports as its default, found at build time,
  // not whatever default the view it reads from has.
  const wrapper = fs.readFileSync(path.join(path.dirname(cjsEntry), 'index.mjs'), 'utf8')
  t.regex(wrapper, /^export default cjs\.Substitute;$/m)
  t.notRegex(wrapper, /\b(?:cjs|value)\.default\b/, 'the wrapper never reads the default export of the view it uses')
})

test('PK4-2 the compatibility checks run vitest with the package inlined and deps.interopDefault: false', t => {
  const compatibility = path.join(root, 'compatibility-checks')
  const config = fs.readFileSync(path.join(compatibility, 'vitest.inline-no-interop-default.config.mts'), 'utf8')
  t.regex(config, /inline:\s*\['@fluffy-spoon\/substitute'\]/)
  t.regex(config, /interopDefault:\s*false/)
  const bundlers = fs.readFileSync(path.join(compatibility, 'test', 'bundlers.ts'), 'utf8')
  t.regex(bundlers, /'vitest\.inline-no-interop-default\.config\.mts'/, 'test/bundlers.ts runs vitest with that config')
})

test('F1 the compatibility checks bundle the packed package and run vitest with the package inlined', t => {
  const compatibility = JSON.parse(fs.readFileSync(path.join(root, 'compatibility-checks', 'package.json'), 'utf8'))
  t.regex(compatibility.scripts.test, /\btest\/bundlers\.ts\b/, 'npm test in compatibility-checks runs test/bundlers.ts')
  for (const dependency of ['rollup', '@rollup/plugin-commonjs', '@rollup/plugin-node-resolve', 'webpack', 'esbuild', 'vite', 'vitest']) {
    t.truthy(compatibility.devDependencies[dependency], `compatibility-checks depends on ${dependency}`)
  }
  const bundlers = fs.readFileSync(path.join(root, 'compatibility-checks', 'test', 'bundlers.ts'), 'utf8')
  t.regex(bundlers, /commonjs\(\)/, 'a bundle is built with @rollup/plugin-commonjs')
  t.regex(bundlers, /vitest\.inline\.config\.mts/, 'vitest runs with the inline config')
  const inlineConfig = fs.readFileSync(path.join(root, 'compatibility-checks', 'vitest.inline.config.mts'), 'utf8')
  t.regex(inlineConfig, /inline:\s*\['@fluffy-spoon\/substitute'\]/)
  t.regex(compatibility.scripts['validate:vitest-inline'], /--config vitest\.inline\.config\.mts/)
  t.regex(fs.readFileSync(path.join(root, 'compatibility-checks', 'test', 'index.ts'), 'utf8'), /name: 'vitest-inline'/)
})

test('P2 the compatibility checks bundle CommonJS code that require()s the package with each documented workaround', t => {
  const compatibility = path.join(root, 'compatibility-checks')
  const helper = fs.readFileSync(path.join(compatibility, 'bundlers', 'require-helper.cjs'), 'utf8')
  t.regex(helper, /require\('@fluffy-spoon\/substitute'\)/, 'the fixture is CommonJS code that require()s the package')
  t.regex(fs.readFileSync(path.join(compatibility, 'bundlers', 'require-entry.mjs'), 'utf8'), /from '\.\/require-helper\.cjs'/)
  const bundlers = fs.readFileSync(path.join(compatibility, 'test', 'bundlers.ts'), 'utf8')
  const p2 = bundlers.slice(bundlers.indexOf('const requireBundlers'))
  t.true(p2.length < bundlers.length, 'test/bundlers.ts has the P2 checks')
  // README "Importing" and MIGRATION "Imports and packaging" name these settings.
  t.regex(p2, /commonjs\(\{ esmExternals: true \}\)/, 'commonjs({ esmExternals: true }) with the package external')
  t.regex(p2, /commonjs\(\{ esmExternals: \[packageName\] \}\)/, 'commonjs({ esmExternals: [the package] }) with the package external')
  t.regex(p2, /noExternal: \[packageName\]/, 'Vite with ssr.noExternal: [the package]')
  t.regex(p2, /nodeResolve\(\{ preferBuiltins: true \}\), commonjs\(\)\]/, 'Rollup with the package bundled')
  t.regex(p2, /documented caveat/, 'the caveat itself (default options, package external) is checked too')
  t.regex(bundlers, /const packageName = '@fluffy-spoon\/substitute'/)
})

test('PK4-1 the compatibility checks bundle ES module code into CommonJS output with the package external and use the named import', t => {
  const compatibility = path.join(root, 'compatibility-checks')
  // The fixture uses only the named import, which README "Importing" recommends for this case.
  const fixture = fs.readFileSync(path.join(compatibility, 'bundlers', 'named-entry.mjs'), 'utf8')
  t.regex(fixture, /^import \{ Substitute, Arg\b[^}]*\} from '@fluffy-spoon\/substitute'$/m, 'named-entry.mjs uses the named import')
  t.notRegex(fixture, /^import\s+(?!\{)[\w$]+/m, 'named-entry.mjs has no default import')
  const bundlers = fs.readFileSync(path.join(compatibility, 'test', 'bundlers.ts'), 'utf8')
  const pk41 = bundlers.slice(bundlers.indexOf('const commonJsOutputBundlers'))
  t.true(pk41.length < bundlers.length, 'test/bundlers.ts has the PK4-1 checks')
  // Each bundler emits CommonJS and keeps the package external; README and MIGRATION name these settings.
  t.regex(pk41, /rollupCommonJsBundle\(input, /, "Rollup with output.format 'cjs'")
  t.regex(bundlers, /format: 'cjs', \.\.\.\(interop === undefined/, "rollupCommonJsBundle writes output.format 'cjs'")
  t.regex(pk41, /format: 'cjs', packages: 'external'/, "esbuild with format 'cjs' and packages: 'external'")
  t.regex(pk41, /\[packageName\]: `commonjs \$\{packageName\}`/, 'webpack with a commonjs external')
  t.regex(pk41, /viteSsrBundle\(input, outDir, undefined, \{ format: 'cjs'/, "a Vite SSR build with output.format 'cjs'")
  t.regex(pk41, /requiresPackageAtRunTime\(bundle\)/, 'each bundle require()s the package at run time')
  t.regex(pk41, /buildAndRun\(bundler, namedEntry\)/, 'the named import is checked with each of them')
  t.regex(pk41, /rollupCommonJsBundle\(input, path\.join\([^)]*\), 'auto'\)/, "Rollup's output.interop: 'auto' workaround for the default import is checked")
  t.regex(pk41, /documented caveat/, 'the caveat itself (the default import is the exports object) is checked too')
})

test('P28 the compatibility checks use substitutes inside jest matchers', t => {
  const compatibility = JSON.parse(fs.readFileSync(path.join(root, 'compatibility-checks', 'package.json'), 'utf8'))
  t.is(compatibility.scripts['validate:jest-matchers'], 'jest test-runners/jest-matchers/**.ts')
  const harness = fs.readFileSync(path.join(root, 'compatibility-checks', 'test', 'index.ts'), 'utf8')
  t.regex(harness, /execSync\('npm run validate:jest-matchers'/, 'test/index.ts runs the jest matcher suite and expects it to pass')
  const suite = fs.readFileSync(path.join(root, 'compatibility-checks', 'test-runners', 'jest-matchers', 'index.spec.ts'), 'utf8')
  t.regex(suite, /expect\(fn\)\.toHaveBeenCalledWith\(logger\)/)
  t.regex(suite, /expect\(42\)\.toEqual\(logger\)/)
  t.regex(suite, /Unexpected return from a matcher function/)
})

const typeScriptConsumer = [
  "import Substitute, { Arg, Substitute as Named } from '@fluffy-spoon/substitute'",
  "import { Arg as DeepArg } from '@fluffy-spoon/substitute/dist/api/Arg'",
  'interface Calculator { add(a: number, b: number): number }',
  'const calculator = Substitute.for<Calculator>()',
  'calculator.add(1, Arg.any()).returns(3)',
  'const same: typeof Named = Substitute',
  'const deep: typeof Arg = DeepArg',
  'export const result: number = calculator.add(1, 2) + (same === Named ? 0 : 1) + (deep === Arg ? 0 : 1)',
  ''
].join('\n')

const typeScriptModes = [
  { name: 'nodenext (ESM)', file: 'esm.mts', options: ['--module', 'nodenext', '--moduleResolution', 'nodenext'] },
  { name: 'nodenext (CommonJS)', file: 'cjs.cts', options: ['--module', 'nodenext', '--moduleResolution', 'nodenext'] },
  { name: 'node16 (ESM)', file: 'esm.mts', options: ['--module', 'node16', '--moduleResolution', 'node16'] },
  { name: 'bundler', file: 'bundler.ts', options: ['--module', 'esnext', '--moduleResolution', 'bundler'] },
  { name: 'node10', file: 'node10.ts', options: ['--module', 'commonjs', '--moduleResolution', 'node'] }
]

for (const mode of typeScriptModes) {
  test(`DOCS:ESM TypeScript types the default import as Substitute with moduleResolution ${mode.name}`, async t => {
    t.timeout(minutes(2))
    const directory = path.join(state.consumer, mode.name.replace(/\W+/g, '-'))
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, mode.file), typeScriptConsumer)
    const tsc = require.resolve('typescript/bin/tsc', { paths: [root] })
    const typeRoots = path.join(root, 'node_modules', '@types')
    const result = await run(process.execPath, [
      tsc, '--noEmit', '--strict', '--skipLibCheck', '--target', 'es2019', '--typeRoots', typeRoots, '--types', 'node',
      ...mode.options, mode.file
    ], directory)
    t.is(result.status, 0, `${mode.name}: ${result.output}`)
  })
}

// P34: a project that exports a member of a check view (`export const addView = bag.received().add`) or an Arg matcher
// and emits declarations with `moduleResolution: node` gets `import("@fluffy-spoon/substitute/dist/shared")` in its
// .d.ts: TypeScript names the directory, whose index re-exports the type. Projects that use those declarations with
// node16, nodenext or bundler resolution resolve such specifiers through "exports" only, where "./dist/*" maps a
// directory to a file that does not exist (`dist/shared.js`): TS2307, or silently `any` with skipLibCheck.
const declarationProducer = [
  "import { Substitute, Arg, received } from '@fluffy-spoon/substitute'",
  'export interface Bag { add(x: number): void; total: number }',
  'const bag = Substitute.for<Bag>()',
  'export const bagView = bag.received()',
  'export const addView = bag.received().add',
  'export const symbolAddView = bag[received](1).add',
  'export const isPositive = Arg.is((x: number) => x > 0)',
  'export const all = Arg.all()',
  ''
].join('\n')
const declarationConsumer = [
  "import { addView, bagView, symbolAddView, isPositive, all } from './declarations/index.js'",
  'addView(1)',
  'bagView.add(1)',
  'symbolAddView(Arg.any())',
  'const positive: number = isPositive',
  '// @ts-expect-error add takes a number (the emitted types resolved)',
  "addView('x')",
  '// @ts-expect-error the matcher has the type of AllArguments (the emitted types resolved)',
  'const text: string = all',
  "import { Arg } from '@fluffy-spoon/substitute'",
  'export { positive, text }',
  ''
].join('\n')
const declarationConsumerModes = [
  { name: 'node16', file: 'consumer.mts', options: ['--module', 'node16', '--moduleResolution', 'node16'] },
  { name: 'nodenext (ESM)', file: 'consumer.mts', options: ['--module', 'nodenext', '--moduleResolution', 'nodenext'] },
  { name: 'nodenext (CommonJS)', file: 'consumer.cts', options: ['--module', 'nodenext', '--moduleResolution', 'nodenext'] },
  { name: 'bundler', file: 'consumer.ts', options: ['--module', 'esnext', '--moduleResolution', 'bundler'] }
]

test('P34 declarations emitted with moduleResolution node for check views and matchers resolve under node16, nodenext and bundler', async t => {
  t.timeout(minutes(3))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [root] })
  const directory = path.join(state.consumer, 'p34-declarations')
  fs.mkdirSync(path.join(directory, 'producer'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'producer', 'index.ts'), declarationProducer)
  const emitted = await run(process.execPath, [
    tsc, '--declaration', '--emitDeclarationOnly', '--strict', '--target', 'es2019',
    '--module', 'commonjs', '--moduleResolution', 'node', '--outDir', 'declarations', path.join('producer', 'index.ts')
  ], directory)
  t.is(emitted.status, 0, emitted.output)
  // (The consumers import the emitted declarations, not the producer's source, which is in another directory.)
  const declarations = fs.readFileSync(path.join(directory, 'declarations', 'index.d.ts'), 'utf8')
  t.regex(declarations, /import\("@fluffy-spoon\/substitute\/dist\/shared"\)/, 'the emitted declarations name the dist/shared directory')
  for (const mode of declarationConsumerModes) {
    fs.writeFileSync(path.join(directory, mode.file), declarationConsumer)
    // Without skipLibCheck, so that an unresolved import in the emitted .d.ts is an error.
    const result = await run(process.execPath, [
      tsc, '--noEmit', '--strict', '--target', 'es2019', ...mode.options, mode.file
    ], directory)
    t.is(result.status, 0, `${mode.name}: ${result.output}`)
  }
})

// R17FE-2 / T83: a test-utils module that exports generic helpers returning check views, annotated with the exported
// `CheckViewOf<T>` (string and symbol forms), compiles with `isolatedDeclarations`, which needs an annotation on every
// export (before T83 the symbol forms had none that compiled in generic code), under node10 and nodenext resolution.
// Projects with node10, node16, nodenext (ES modules and CommonJS) and bundler resolution read the emitted declarations.
// A check view whose type TypeScript infers is written with the package's own specifier.
const checkViewProducer = [
  "import { Arg, CheckViewOf, Substitute, SubstituteOf, didNotReceive, received } from '@fluffy-spoon/substitute'",
  'export interface Mailer { send(to: string, body: string): Promise<void>; sent: number }',
  'export function sentOnce<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub.received(1) }',
  'export function neverSent<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub.didNotReceive() }',
  'export function sentOnceSymbol<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[received](1) }',
  'export function neverSentSymbol<T>(sub: SubstituteOf<T>): CheckViewOf<T> { return sub[didNotReceive]() }',
  'export function makeMailer(): SubstituteOf<Mailer> {',
  '  const mailer = Substitute.for<Mailer>()',
  '  mailer.send(Arg.any(), Arg.any()).resolves()',
  '  return mailer',
  '}',
  ''
].join('\n')
const inferredCheckViewProducer = [
  "import { Substitute } from '@fluffy-spoon/substitute'",
  'export const queueView = Substitute.for<Iterable<number> & { size(): number }>().received()',
  ''
].join('\n')
const checkViewConsumer = [
  "import { makeMailer, sentOnce, sentOnceSymbol, neverSent, neverSentSymbol } from './declarations/producer.js'",
  "import { queueView } from './declarations/inferred.js'",
  "import { Arg } from '@fluffy-spoon/substitute'",
  'const mailer = makeMailer()',
  "sentOnce(mailer).send('ann@example.com', Arg.any())",
  "sentOnceSymbol(mailer).send('ann@example.com', 'hello')",
  'neverSent(mailer).sent',
  'neverSentSymbol(mailer).send(Arg.all())',
  'queueView.size()',
  '// @ts-expect-error send takes strings (the emitted types resolved)',
  "sentOnceSymbol(mailer).send(1, 'hello')",
  '// @ts-expect-error the view has the members of Mailer only',
  'neverSent(mailer).receive()',
  'export {}',
  ''
].join('\n')
const checkViewProducerModes = [
  { name: 'node10', options: ['--module', 'commonjs', '--moduleResolution', 'node'] },
  { name: 'nodenext', options: ['--module', 'nodenext', '--moduleResolution', 'nodenext'] }
]
const checkViewConsumerModes = [
  { name: 'node10', file: 'consumer.ts', options: ['--module', 'commonjs', '--moduleResolution', 'node'] },
  ...declarationConsumerModes
]

test('R17FE-2 T83 generic helpers annotated with CheckViewOf<T> emit declarations with isolatedDeclarations, read under node10, node16, nodenext and bundler', async t => {
  t.timeout(minutes(4))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [root] })
  for (const producerMode of checkViewProducerModes) {
    const directory = path.join(state.consumer, `t83-${producerMode.name}`)
    fs.mkdirSync(path.join(directory, 'producer'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'producer', 'producer.ts'), checkViewProducer)
    fs.writeFileSync(path.join(directory, 'producer', 'inferred.ts'), inferredCheckViewProducer)
    const emit = (isolated, file) => run(process.execPath, [
      tsc, '--declaration', '--emitDeclarationOnly', ...(isolated ? ['--isolatedDeclarations'] : []), '--strict',
      '--target', 'es2019', ...producerMode.options, '--rootDir', 'producer', '--outDir', 'declarations', path.join('producer', file)
    ], directory)
    const isolated = await emit(true, 'producer.ts')
    t.is(isolated.status, 0, `${producerMode.name}, isolatedDeclarations: ${isolated.output}`)
    // (A check view whose type is inferred needs no annotation, but cannot be emitted with isolatedDeclarations.)
    const inferred = await emit(false, 'inferred.ts')
    t.is(inferred.status, 0, `${producerMode.name}, inferred check view: ${inferred.output}`)
    const declarations = fs.readFileSync(path.join(directory, 'declarations', 'producer.d.ts'), 'utf8')
    t.regex(declarations, /function sentOnceSymbol<T>\(sub: SubstituteOf<T>\): CheckViewOf<T>;/)
    const inferredDeclarations = fs.readFileSync(path.join(directory, 'declarations', 'inferred.d.ts'), 'utf8')
    t.regex(inferredDeclarations, /import\("@fluffy-spoon\/substitute"\)\.CheckViewOf</, 'an inferred check view is named through the package root')
    for (const mode of checkViewConsumerModes) {
      fs.writeFileSync(path.join(directory, mode.file), checkViewConsumer)
      // Without skipLibCheck, so that an unresolved import in the emitted .d.ts is an error.
      const result = await run(process.execPath, [tsc, '--noEmit', '--strict', '--target', 'es2019', ...mode.options, mode.file], directory)
      t.is(result.status, 0, `declarations emitted with ${producerMode.name}, read with ${mode.name}: ${result.output}`)
    }
  }
})

test('P34 exports maps every directory that the published declarations import to its index', t => {
  const dist = path.join(state.consumer, 'node_modules', '@fluffy-spoon', 'substitute', 'dist')
  // The directories with an index.d.ts that a published .d.ts imports (`from '../shared'`, `from './types'`, ...).
  const imported = new Set()
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/\.d\.m?ts$/.test(entry.name)) {
        for (const [, specifier] of fs.readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)) {
          const target = path.resolve(directory, specifier)
          if (fs.existsSync(path.join(target, 'index.d.ts'))) imported.add(path.relative(path.dirname(dist), target).split(path.sep).join('/'))
        }
      }
    }
  }
  visit(dist)
  t.deepEqual([...imported].sort(), ['dist/api', 'dist/api/types', 'dist/shared'])
  for (const directory of imported) {
    t.deepEqual(packageJson.exports[`./${directory}`], [
      { types: `./${directory}/index.d.ts`, default: `./${directory}/index.js` },
      `./${directory}/index.js`
    ], `exports["./${directory}"] maps the directory to its index, with the array fallback of exports["."]`)
    const resolved = runNode(state.consumer, ['-p', `require.resolve('@fluffy-spoon/substitute/${directory}')`]).trim()
    t.is(resolved, path.join(dist, ...directory.split('/').slice(1), 'index.js'))
  }
  // The other specifiers resolve as before.
  const resolve = specifier => runNode(state.consumer, ['-p', `require.resolve('@fluffy-spoon/substitute/${specifier}')`]).trim()
  t.is(resolve('dist/shared/index'), path.join(dist, 'shared', 'index.js'))
  t.is(resolve('dist/api/Arg'), path.join(dist, 'api', 'Arg.js'))
  t.is(resolve('dist/api/types/Substitute.js'), path.join(dist, 'api', 'types', 'Substitute.js'))
})

test('G:PK-4 package-lock.json has the same version as package.json', t => {
  const lock = readJson('package-lock.json')
  t.is(lock.version, packageJson.version)
  t.is(lock.packages[''].version, packageJson.version)
})

const normalizeVersion = version => {
  const parts = version.split('.')
  while (parts.length < 3) parts.push('0')
  return parts.join('.')
}

test('G:PK-2 engines.node is the minimum Node version that CI smoke-tests the packed package on', t => {
  const engines = /^>=\s*(\d+(?:\.\d+){0,2})$/.exec(packageJson.engines.node)
  t.truthy(engines, `engines.node is a plain lower bound: ${packageJson.engines.node}`)
  const minimum = /MINIMUM_NODE_VERSION:\s*['"]?(\d+\.\d+\.\d+)['"]?/.exec(ciWorkflow)
  t.truthy(minimum, 'nodejs.yml defines MINIMUM_NODE_VERSION')
  t.is(normalizeVersion(engines[1]), minimum[1], 'engines.node matches the version CI tests')
  t.regex(ciWorkflow, /node-version:\s*\$\{\{\s*env\.MINIMUM_NODE_VERSION\s*\}\}/, 'a CI job runs on MINIMUM_NODE_VERSION')
  t.regex(ciWorkflow, /node\s+require\.js/, 'that job runs the CommonJS smoke test')
})

test('F2 exports["."] falls back to the CommonJS entry for Node.js versions without conditional exports (13.0, 13.1)', t => {
  const entry = packageJson.exports['.']
  t.true(Array.isArray(entry), 'exports["."] is a fallback array')
  t.is(entry.length, 2)
  const [conditions, fallback] = entry
  t.deepEqual(conditions, {
    import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
    default: { types: './dist/index.d.ts', default: './dist/index.js' }
  }, 'the conditions come first, so every Node.js version and tool that understands them uses them')
  t.is(fallback, packageJson.main, 'the fallback is the CommonJS entry')
  t.is(packageJson.engines.node, '>=10', 'engines.node stays >=10')

  // The packed package resolves like before on this Node.js version.
  const resolved = runNode(state.consumer, ['-p', "require.resolve('@fluffy-spoon/substitute')"]).trim()
  t.is(resolved, path.join(state.consumer, 'node_modules', '@fluffy-spoon', 'substitute', 'dist', 'index.js'))

  // CI smoke-tests the fallback on Node.js 13.0.0, and the ES module entry on 13.7.0, the oldest 13.x it supports.
  t.regex(ciWorkflow, /EXPORTS_FALLBACK_NODE_VERSION:\s*'13\.0\.0'/)
  t.regex(ciWorkflow, /MINIMUM_ESM_NODE_13_VERSION:\s*'13\.7\.0'/)
  t.regex(ciWorkflow, /node-version:\s*\$\{\{\s*env\.EXPORTS_FALLBACK_NODE_VERSION\s*\}\}[\s\S]*?node require\.js/)
  t.regex(ciWorkflow, /node-version:\s*\$\{\{\s*env\.MINIMUM_ESM_NODE_13_VERSION\s*\}\}[\s\S]*?node require\.js\s*\n\s*node import\.mjs/)
})

test('R3TD-5 CONTRIBUTING.md, MIGRATION.md and the deep-import smoke test agree on the Node.js versions where deep imports work', t => {
  const { deepImportSupport } = require('./smoke/deep-import-support')
  // Measured with the packed package on each of these Node.js versions:
  // [version, the form without .js works, the form with .js works]
  const measured = [
    ['v10.0.0', true, true], ['v12.0.0', true, true], ['v12.16.0', true, true],
    ['v12.17.0', false, false], ['v12.18.0', false, false], ['v12.19.0', false, false],
    ['v12.20.0', true, false], ['v12.22.12', true, false],
    ['v13.0.0', false, false], ['v13.1.0', false, false], ['v13.7.0', false, false], ['v13.14.0', false, false],
    ['v14.0.0', false, false], ['v14.13.0', true, false], ['v14.18.0', true, false],
    ['v14.19.0', true, true], ['v14.21.3', true, true],
    ['v16.0.0', true, false], ['v16.8.0', true, false],
    ['v16.9.0', true, true], ['v16.20.2', true, true], ['v18.20.8', true, true], ['v20.20.2', true, true],
    ['v22.0.0', true, true], ['v24.22.3', true, true], ['v26.13.1', true, true]
  ]
  for (const [version, withoutExtension, withExtension] of measured) {
    t.deepEqual(deepImportSupport(version), { withoutExtension, withExtension }, version)
  }
  t.deepEqual(deepImportSupport('14.12.0'), { withoutExtension: false, withExtension: false }, '14.12.0 (no subpath patterns yet)')
  t.is(deepImportSupport('v15.14.0'), undefined, '15.x was never checked, so nothing is claimed for it')

  // The documents state the same ranges. Comment markers and line breaks do not matter.
  const prose = file => readText(file).replace(/^[ \t]*\/\/ ?/gm, '').replace(/\s+/g, ' ')
  const range = (from, to) => `${from.replace(/\./g, '\\.')}\\s*(?:to|-|–)\\s*${to.replace(/\./g, '\\.')}`
  const fail = new RegExp(`${range('12.17', '12.19')}, (?:all of )?13\\.x and ${range('14.0', '14.12')}`)
  const withoutOnly = new RegExp(`${range('12.20', '12.22')}, ${range('14.13', '14.18')} and ${range('16.0', '16.8')}[^.;]*?only the form without \`\\.js\` works`)
  for (const file of ['CONTRIBUTING.md', 'MIGRATION.md', 'packaging/smoke/deep-imports.js', 'packaging/smoke/deep-import-support.js']) {
    // t.true instead of t.regex, so that a failure names the file instead of printing all of it.
    const text = prose(file)
    t.true(fail.test(text), `${file}: deep imports fail on 12.17 to 12.19, 13.x and 14.0 to 14.12`)
    t.true(withoutOnly.test(text), `${file}: on 12.20 to 12.22, 14.13 to 14.18 and 16.0 to 16.8 only the form without .js works`)
    t.false(/12\.17 to 12\.22|14\.0 to 14\.18/.test(text), `${file} does not claim that deep imports fail where the form without .js works`)
  }

  // CI runs the smoke test, which checks the table on the running version, on every old Node.js version it installs.
  const minimumNode = workflowJob(ciWorkflow, 'minimum-node')
  const steps = minimumNode.split(/\n {6}- /).filter(step => /node require\.js/.test(step))
  t.is(steps.length, 4, 'four smoke test steps')
  for (const step of steps) t.regex(step, /node deep-imports\.js/, step.split('\n')[0])
})

test('G:CI-1 the release workflow only publishes to registries it can authenticate against', t => {
  const owner = /github\.com\/([^/]+)\//.exec(packageJson.repository.url)[1].toLowerCase()
  const scope = packageJson.name.split('/')[0]
  for (const [, registry] of publishWorkflow.matchAll(/registry-url:\s*['"]?([^'"\s]+)/g)) {
    if (registry.includes('npm.pkg.github.com')) {
      // GitHub Packages only accepts packages whose scope is the repository owner.
      t.is(scope, `@${owner}`, `GitHub Packages cannot host ${packageJson.name}: its scope is not @${owner}`)
    } else {
      t.is(registry, 'https://registry.npmjs.org/')
    }
  }
  t.notRegex(publishWorkflow, /npm\.pkg\.github\.com/, 'no job publishes to GitHub Packages')
  t.regex(publishWorkflow, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_PUBLISH_TOKEN\s*\}\}/)
  t.is(packageJson.publishConfig && packageJson.publishConfig.registry, 'https://registry.npmjs.org/')
})

const distTag = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'dist-tag.js'), ...args], {
  cwd: root,
  encoding: 'utf8',
  env: childEnvironment()
})

test('CI:dist-tag a stable release tag publishes as latest, a prerelease as beta', t => {
  const cases = [
    { tag: 'v2.0.1', version: '2.0.1', prerelease: 'false', expected: 'latest' },
    { tag: '2.0.1', version: '2.0.1', prerelease: 'false', expected: 'latest' },
    { tag: 'v2.1.0-beta.1', version: '2.1.0-beta.1', prerelease: 'true', expected: 'beta' },
    { tag: 'v3.0.0-rc.2', version: '3.0.0-rc.2', prerelease: 'false', expected: 'beta' },
    { tag: 'v2.0.2', version: '2.0.2', prerelease: 'true', expected: 'beta' }
  ]
  for (const { tag, version, prerelease, expected } of cases) {
    const result = distTag(tag, version, prerelease)
    t.is(result.status, 0, result.stderr)
    t.is(result.stdout.trim(), expected, `${tag} (prerelease: ${prerelease})`)
  }
  t.regex(publishWorkflow, /node packaging\/dist-tag\.js/, 'the publish workflow uses packaging/dist-tag.js')
  t.notRegex(publishWorkflow, /contains\(github\.event\.release\.tag_name, 'beta'\)/)
})

test('CI:dist-tag a release tag that does not match package.json is rejected', t => {
  const result = distTag('v2.0.2', '2.0.1', 'false')
  t.not(result.status, 0)
  t.regex(result.stderr, /does not match/)
})

test('G:CI-2 a nested node --test run reports its failures (NODE_TEST_CONTEXT is not inherited)', t => {
  t.timeout(minutes(1))
  const { testRunnerEnvironment } = require('../compatibility-checks/test/environment.js')
  const directory = makeTemporaryDirectory('node-test')
  const inner = path.join(directory, 'inner.js')
  const outer = path.join(directory, 'outer.js')
  fs.writeFileSync(inner, "require('node:test').test('fails', () => { throw new Error('inner failure') })\n")
  fs.writeFileSync(outer, [
    "const { spawnSync } = require('child_process')",
    `const { testRunnerEnvironment } = require(${JSON.stringify(path.join(root, 'compatibility-checks', 'test', 'environment.js'))})`,
    "require('node:test').test('nested run fails', () => {",
    `  const result = spawnSync(process.execPath, ['--test', ${JSON.stringify(inner)}], { env: testRunnerEnvironment(), encoding: 'utf8' })`,
    "  if (result.status === 0) throw new Error('the nested node --test run did not report its failure')",
    '})',
    ''
  ].join('\n'))
  const result = spawnSync(process.execPath, ['--test', outer], { encoding: 'utf8', env: childEnvironment() })
  t.is(result.status, 0, result.stdout + result.stderr)
  t.is(testRunnerEnvironment({ NODE_TEST_CONTEXT: 'child-v8', KEEP: '1' }).NODE_TEST_CONTEXT, undefined)
  t.is(testRunnerEnvironment({ NODE_TEST_CONTEXT: 'child-v8', KEEP: '1' }).KEEP, '1')
})

test('G:CI-2 CI runs the compatibility checks against the packed local build', t => {
  const compatibility = JSON.parse(fs.readFileSync(path.join(root, 'compatibility-checks', 'package.json'), 'utf8'))
  t.is(compatibility.scripts.pretest, 'npm run install:local', 'npm test in compatibility-checks installs the packed local build first')
  t.regex(compatibility.scripts['install:local'], /^node scripts\/install-local-build\.js$/)
  const common = fs.readFileSync(path.join(root, 'compatibility-checks', 'test-runners', '_common', 'index.ts'), 'utf8')
  t.regex(common, /from '@fluffy-spoon\/substitute'/, 'the test runners import the package, not ../src')
  t.notRegex(common, /\.\.\/src/)
  t.regex(ciWorkflow, /working-directory:\s*compatibility-checks[\s\S]*?run:\s*npm test|run:\s*npm test\s*\n\s*working-directory:\s*compatibility-checks/, 'a CI job runs npm test in compatibility-checks')
})

test('CI:matrix CI tests every supported Node LTS line and runs the type tests', t => {
  const matrix = /node-version:\s*\[([^\]]+)\]/.exec(ciWorkflow)
  t.truthy(matrix, 'nodejs.yml has a node-version matrix')
  const versions = matrix[1].split(',').map(version => version.trim().replace(/['"]/g, ''))
  for (const version of ['22', '24', '26']) t.true(versions.includes(version), `Node ${version} is tested`)
  for (const version of ['18', '20', '21']) t.false(versions.includes(version), `end-of-life Node ${version} is not in the matrix`)
  t.regex(ciWorkflow, /npm run test:types --if-present/)
  t.regex(ciWorkflow, /pull_request/)
})

/** The body of a job in a workflow file: everything from `  <job>:` up to the next job. */
const workflowJob = (workflow, job) => {
  const match = new RegExp(`\\n  ${job}:\\n([\\s\\S]*?)(?=\\n  [\\w-]+:\\n|$)`).exec(workflow)
  return match ? match[1] : undefined
}

test('F4 CI (and so the release gate) type-checks the built typings with the oldest supported TypeScript', t => {
  t.regex(packageJson.scripts['test:types:min-ts'], /^npm run build && node spec-types\/min-ts\/check\.js$/)
  t.regex(readText('spec-types/min-ts/check.js'), /MINIMUM_TYPESCRIPT_VERSION = '3\.6'/)
  const job = workflowJob(ciWorkflow, 'types-min-ts')
  t.truthy(job, 'nodejs.yml has a types-min-ts job')
  t.regex(job, /run:\s*npm ci\b/)
  t.regex(job, /run:\s*npm run test:types:min-ts\s*$/m)
  t.notRegex(job, /\bif:/, 'the job always runs')
  // The publish workflow runs the whole CI workflow, this job included, before it publishes.
  t.regex(publishWorkflow, /uses:\s*\.\/\.github\/workflows\/nodejs\.yml/)
  t.regex(workflowJob(publishWorkflow, 'publish-npm'), /needs:\s*ci\b/)
})

test('TD-12 CONTRIBUTING.md documents every CI check, including test:docs and test:types:min-ts', t => {
  const contributing = readText('CONTRIBUTING.md')
  for (const command of ['npm run test:docs', 'npm run test:types:min-ts', 'npm run test:types']) {
    t.true(contributing.includes(command), `CONTRIBUTING.md shows how to run ${command}`)
  }
  for (const directory of ['spec-types/', 'spec-docs/']) {
    t.regex(contributing, new RegExp(`\\| \`${directory}\` \\|`), `the project layout lists ${directory}`)
  }
  t.true(contributing.includes('spec-docs/README.md'), 'CONTRIBUTING.md points to the docs check documentation')
  const ci = contributing.slice(contributing.indexOf('## Continuous integration'), contributing.indexOf('## Releasing'))
  for (const [, job] of ciWorkflow.matchAll(/\n  ([\w-]+):\n\s+name:/g)) {
    t.true(ci.includes(`**${job}**`), `the Continuous integration section describes the ${job} job`)
  }
  for (const [, command] of workflowJob(ciWorkflow, 'test').matchAll(/run:\s*(npm [^\n]+)/g)) {
    t.true(ci.includes(command.replace(' --if-present', '')), `the Continuous integration section mentions ${command}`)
  }
})

test('DOCS:CONTRIBUTING CONTRIBUTING.md (linked from the README) exists and documents the release process', t => {
  const contributing = readText('CONTRIBUTING.md')
  for (const topic of ['npm test', 'test:types', 'compatibility-checks', 'release']) {
    t.true(contributing.includes(topic), `CONTRIBUTING.md mentions ${topic}`)
  }
})
