'use strict'
// Packaging, release and CI checks. These run as part of `npm test` (see ava.config.js).
// They pack the repository the way `npm publish` does and use the tarball from a fresh consumer project.
const test = require('ava')
const { execFile, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const {
  root, readText, readJson, pack, createConsumer, runNode, childEnvironment, makeTemporaryDirectory, removeTemporaryDirectories
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

test.before('pack the repository like npm publish does', t => {
  t.timeout(minutes(5))
  // Start from a stale dist/ like the one `npm test` used to leave behind: spec output and no dist/index.js.
  // Packing must rebuild the library from scratch.
  const dist = path.join(root, 'dist')
  fs.rmSync(dist, { recursive: true, force: true })
  fs.mkdirSync(path.join(dist, 'spec'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'spec', 'Stale.spec.js'), '')

  const destination = makeTemporaryDirectory('pack')
  state.packed = pack(destination)
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

const simulateCommonJsView = (directory, cjsEntry, names, { defaultExport, namedExports }) => {
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  fs.copyFileSync(path.join(state.consumer, 'node_modules', '@fluffy-spoon', 'substitute', 'dist', 'index.mjs'), path.join(directory, 'index.mjs'))
  fs.writeFileSync(path.join(directory, 'index.js'), [
    "import { createRequire } from 'module'",
    `const real = createRequire(import.meta.url)(${JSON.stringify(cjsEntry)})`,
    `export default ${defaultExport}`,
    ...(namedExports ? names.filter(name => name !== 'default').map(name => `export const ${name} = real.${name}`) : []),
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
  const directory = path.join(state.consumer, 'interop-unusable')
  simulateCommonJsView(directory, cjsEntry, names, { defaultExport: '{}', namedExports: false })
  const result = spawnSync(process.execPath, ['check.mjs'], { cwd: directory, encoding: 'utf8', env: childEnvironment() })
  t.not(result.status, 0)
  t.regex(result.stderr, /could not read the exports of its CommonJS build/)
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

test('DOCS:CONTRIBUTING CONTRIBUTING.md (linked from the README) exists and documents the release process', t => {
  const contributing = readText('CONTRIBUTING.md')
  for (const topic of ['npm test', 'test:types', 'compatibility-checks', 'release']) {
    t.true(contributing.includes(topic), `CONTRIBUTING.md mentions ${topic}`)
  }
})
