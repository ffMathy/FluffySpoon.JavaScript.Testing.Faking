// F1: the package's ES module entry (dist/index.mjs) wraps its CommonJS build. Bundlers and test runners that
// transform the package themselves turn that CommonJS build into an ES module in different ways (the __esModule
// interop), and once got only undefined exports. These checks bundle bundlers/entry.mjs with each of them, run the
// bundle with Node.js and check that the default, named and namespace imports are the real exports.
//
// P2 (P29): CommonJS code that require()s the package (bundlers/require-helper.cjs), bundled with Rollup's commonjs
// plugin while the package stays external. With default options the plugin turns that require() into a default
// import, which Node.js resolves to the ES module entry, whose default export is the Substitute class, so require()
// gets the class instead of the exports object. the guide "Importing" and MIGRATION "Imports and packaging" document
// this and its workarounds; the checks below make sure each documented workaround works and the caveat is still real.
//
// PK4-1 (P33): ES module code bundled into CommonJS output while the package stays external (Rollup format 'cjs',
// Vite SSR builds with CommonJS output, esbuild format 'cjs', webpack with a commonjs external). The bundle require()s
// the package at run time and turns the default import into module.exports, the exports object, as Node.js does for
// CommonJS (Rollup with its default output.interop for any source; esbuild, webpack and Rolldown for .mjs sources and
// sources in a "type": "module" package). the guide "Importing" and MIGRATION "Imports and packaging" recommend the named
// import there; the checks below make sure it works with each of them, that Rollup's output.interop: 'auto' fixes the
// default import, and that the caveat itself is still real.
//
// Like test/index.ts, they run against the packed package that `npm run install:local` installed.
import * as test from 'node:test'
import * as assert from 'node:assert'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import { builtinModules } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import * as esbuild from 'esbuild'
import { rollup } from 'rollup'
import webpack from 'webpack'
import { testRunnerEnvironment } from './environment'

const here = path.resolve(__dirname, '..')
const entry = path.join(here, 'bundlers', 'entry.mjs')
const requireEntry = path.join(here, 'bundlers', 'require-entry.mjs')
const namedEntry = path.join(here, 'bundlers', 'named-entry.mjs')
const packageName = '@fluffy-spoon/substitute'
const exportNames = Object.keys(require(packageName)).sort()
const nodeBuiltins = [...builtinModules, ...builtinModules.map(name => `node:${name}`)]

const run = (command: string, args: string[], cwd: string) => new Promise<{ status: number, output: string }>(resolve => {
  execFile(command, args, { cwd, encoding: 'utf8', env: testRunnerEnvironment() }, (error, stdout, stderr) => {
    resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: stdout + stderr })
  })
})

type Bundler = {
  name: string
  /** Bundles `entry` into `outDir` and returns the path of the bundle. */
  bundle: (outDir: string) => Promise<string>
}

/** Bundles `input` with Rollup into an ES module file. Node.js built-ins and `external` stay external. */
const rollupBundle = async (input: string, file: string, plugins: Parameters<typeof rollup>[0]['plugins'], external: string[] = []) => {
  const build = await rollup({
    input,
    external: [...nodeBuiltins, ...external],
    onwarn: warning => { throw new Error(`rollup warning: ${warning.message}`) },
    plugins
  })
  await build.write({ file, format: 'es' })
  await build.close()
  return file
}

/** Bundles `input` with Rollup into a CommonJS file (output.format 'cjs'), with the package and Node.js built-ins external. */
const rollupCommonJsBundle = async (input: string, file: string, interop?: 'auto') => {
  const build = await rollup({
    input,
    external: [...nodeBuiltins, packageName],
    onwarn: warning => { throw new Error(`rollup warning: ${warning.message}`) }
  })
  await build.write({ file, format: 'cjs', ...(interop === undefined ? {} : { interop }) })
  await build.close()
  return file
}

/** Bundles `input` with webpack for Node.js into `outDir`/`filename`, with the given `externals`. */
const webpackBundle = (input: string, outDir: string, filename: string, externals?: Record<string, string>) => new Promise<string>((resolve, reject) => {
  webpack({
    mode: 'none',
    target: 'node',
    context: here,
    entry: input,
    ...(externals === undefined ? {} : { externals }),
    output: { path: outDir, filename }
  }, (error, stats) => {
    if (error) return reject(error)
    if (stats === undefined || stats.hasErrors() || stats.hasWarnings()) {
      return reject(new Error(`webpack: ${stats && stats.toString('errors-warnings')}`))
    }
    resolve(path.join(outDir, filename))
  })
})

/**
 * Runs a Vite SSR build of `input` into `outDir` with the given `ssr` options and returns the path of the bundle.
 * `output` goes to build.rolldownOptions.output (Vite 8 and newer) or build.rollupOptions.output (older Vite).
 */
const viteSsrBundle = async (input: string, outDir: string, ssr?: object, output?: object) => {
  const { build, version } = await import('vite')
  const bundlerOptions = output === undefined ? {} : Number(version.split('.')[0]) >= 8 ? { rolldownOptions: { output } } : { rollupOptions: { output } }
  await build({
    configFile: false,
    root: here,
    logLevel: 'silent',
    ...(ssr === undefined ? {} : { ssr }),
    build: { ssr: input, outDir, emptyOutDir: false, write: true, ...bundlerOptions }
  })
  const name = path.basename(input, path.extname(input))
  const [file] = fs.readdirSync(outDir).filter(file => [`${name}.js`, `${name}.mjs`, `${name}.cjs`].includes(file))
  assert.ok(file, `vite wrote ${fs.readdirSync(outDir).join(', ')}`)
  return path.join(outDir, file)
}

const bundlers: Bundler[] = [
  {
    name: 'rollup with @rollup/plugin-commonjs',
    bundle: outDir => rollupBundle(entry, path.join(outDir, 'rollup.mjs'), [nodeResolve({ preferBuiltins: true }), commonjs()])
  },
  {
    name: 'webpack',
    bundle: outDir => webpackBundle(entry, outDir, 'webpack.cjs')
  },
  {
    name: 'esbuild (CommonJS output)',
    bundle: async outDir => {
      const outfile = path.join(outDir, 'esbuild.cjs')
      await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' })
      return outfile
    }
  },
  {
    name: 'esbuild (ES module output)',
    bundle: async outDir => {
      const outfile = path.join(outDir, 'esbuild.mjs')
      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        // esbuild's ES module output cannot require() Node.js built-ins (the library requires 'util') without this.
        banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" }
      })
      return outfile
    }
  },
  {
    name: 'Vite SSR build with ssr.noExternal',
    bundle: outDir => viteSsrBundle(entry, outDir, { noExternal: true })
  }
]

test.describe('F1 bundled ES module imports are the real exports', () => {
  const outDirs: string[] = []
  test.after(() => {
    for (const outDir of outDirs) fs.rmSync(outDir, { recursive: true, force: true })
  })

  for (const bundler of bundlers) {
    test.it(`F1 ${bundler.name}: default, named and namespace imports are the real exports`, async () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'substitute-bundle-'))
      outDirs.push(outDir)
      const bundle = await bundler.bundle(outDir)
      const result = await run(process.execPath, [bundle], outDir)
      assert.strictEqual(result.status, 0, result.output)
      const report = JSON.parse(result.output.trim().split('\n').pop() as string)
      assert.deepStrictEqual(report, {
        defaultImport: 'function',
        defaultIsNamedSubstitute: true,
        namespaceDefaultIsSubstitute: true,
        arg: 'object',
        received: 'symbol',
        substituteException: 'function',
        namespaceKeys: exportNames,
        undefinedNamespaceValues: [],
        returns: 3,
        failingAssertion: 'SubstituteException'
      }, `${bundler.name}: ${result.output}`)
    })
  }

  const vitestInline = [
    { id: 'F1', name: 'vitest with server.deps.inline', config: 'vitest.inline.config.mts' },
    // PK4-2: vitest then gives the package's ES module entry a default import without the named exports, and a
    // namespace whose default is not the Substitute class.
    { id: 'PK4-2', name: 'vitest with server.deps.inline and deps.interopDefault: false', config: 'vitest.inline-no-interop-default.config.mts' }
  ]
  for (const { id, name, config } of vitestInline) {
    test.it(`${id} ${name}: default, named and namespace imports are the real exports`, async () => {
      const vitestPackage = require.resolve('vitest/package.json', { paths: [here] })
      const vitest = path.join(path.dirname(vitestPackage), require(vitestPackage).bin.vitest)
      const result = await run(process.execPath, [
        vitest, 'run', '--config', config, 'test-runners/vitest-inline/exports.test.ts'
      ], here)
      assert.strictEqual(result.status, 0, result.output)
      assert.match(result.output, /Tests\s+2 passed/, result.output)
    })
  }
})

// P2 (P29): bundles of bundlers/require-entry.mjs, which imports CommonJS code that require()s the package.
// A bundle that keeps the package external imports it at run time, so it is written below node_modules/ here,
// where Node.js finds the installed package. `fix` names the documented workaround that each bundle uses, and
// `external` says whether the package stays external (checked in the bundle, so a check cannot pass by accident).
type RequireBundler = Bundler & { fix: string, external: boolean }

const requireBundlers: RequireBundler[] = [
  {
    name: 'rollup with @rollup/plugin-commonjs and the package external',
    fix: 'commonjs({ esmExternals: true })',
    external: true,
    bundle: outDir => rollupBundle(requireEntry, path.join(outDir, 'rollup-esm-externals.mjs'), [commonjs({ esmExternals: true })], [packageName])
  },
  {
    name: 'rollup with @rollup/plugin-commonjs and the package external',
    fix: `commonjs({ esmExternals: ['${packageName}'] })`,
    external: true,
    bundle: outDir => rollupBundle(requireEntry, path.join(outDir, 'rollup-esm-externals-list.mjs'), [commonjs({ esmExternals: [packageName] })], [packageName])
  },
  {
    name: 'rollup with @rollup/plugin-commonjs',
    fix: 'the package bundled (@rollup/plugin-node-resolve, not external)',
    external: false,
    bundle: outDir => rollupBundle(requireEntry, path.join(outDir, 'rollup-bundled.mjs'), [nodeResolve({ preferBuiltins: true }), commonjs()])
  },
  {
    name: 'Vite SSR build',
    fix: `ssr.noExternal: ['${packageName}']`,
    external: false,
    bundle: outDir => viteSsrBundle(requireEntry, outDir, { noExternal: [packageName] })
  },
  {
    // Vite 8 bundles with Rolldown instead of Rollup and its commonjs plugin, so its default externals work.
    // README and MIGRATION say that Vite 7 and older are affected; this makes sure the Vite in use here is not.
    name: 'Vite SSR build (Vite 8 or newer, Rolldown)',
    fix: 'the default externals',
    external: true,
    bundle: outDir => viteSsrBundle(requireEntry, outDir)
  }
]

/**
 * Whether a bundle loads the package at run time instead of containing it: an import of it, an import() or a
 * require() (Rolldown's is called `__require`).
 */
const loadsPackageAtRunTime = (bundle: string) =>
  /(?:\bfrom\s*|\bimport\s*\(\s*|require\s*\(\s*)(['"])@fluffy-spoon\/substitute\1/.test(fs.readFileSync(bundle, 'utf8'))

/** Whether a bundle require()s the package at run time (CommonJS output with the package external). */
const requiresPackageAtRunTime = (bundle: string) =>
  /require\s*\(\s*(['"])@fluffy-spoon\/substitute\1\s*\)/.test(fs.readFileSync(bundle, 'utf8'))

// Bundles that keep the package external import it at run time, so they are written below node_modules/ here,
// where Node.js finds the installed package.
const bundleRoot = path.join(here, 'node_modules', '.substitute-bundles')
const makeOutDir = () => {
  fs.mkdirSync(bundleRoot, { recursive: true })
  return fs.mkdtempSync(path.join(bundleRoot, 'bundle-'))
}

/** Runs a bundle with Node.js and returns the report it prints on its last line. */
const runBundle = async (bundle: string, cwd: string) => {
  const result = await run(process.execPath, [bundle], cwd)
  assert.strictEqual(result.status, 0, result.output)
  return { report: JSON.parse(result.output.trim().split('\n').pop() as string), output: result.output }
}

test.describe('P2 (P29) bundled CommonJS code that require()s the package gets the exports object with the documented settings', () => {
  test.after(() => {
    fs.rmSync(bundleRoot, { recursive: true, force: true })
  })

  const runRequireBundle = async (bundler: Bundler & { external: boolean }) => {
    const outDir = makeOutDir()
    const bundle = await bundler.bundle(outDir)
    assert.strictEqual(loadsPackageAtRunTime(bundle), bundler.external,
      `${bundler.name}: the package is ${bundler.external ? 'external' : 'bundled'}`)
    return runBundle(bundle, outDir)
  }

  for (const bundler of requireBundlers) {
    test.it(`P2 ${bundler.name}, with ${bundler.fix}: require() gives the exports object`, async () => {
      const { report, output } = await runRequireBundle(bundler)
      assert.deepStrictEqual(report, {
        requireIsSubstituteClass: false,
        exportKeys: exportNames,
        undefinedExportValues: [],
        substitute: 'function',
        defaultIsSubstitute: true,
        arg: 'object',
        received: 'symbol',
        substituteException: 'function',
        returns: 3,
        failingAssertion: 'SubstituteException'
      }, `${bundler.name}, with ${bundler.fix}: ${output}`)
    })
  }

  // The caveat itself. If this fails because require() now gives the exports object, the tools changed: update
  // the caveat in the guide "Importing" and MIGRATION "Imports and packaging", and then this check.
  test.it('P2 rollup with @rollup/plugin-commonjs (default options) and the package external: require() gives the Substitute class (the documented caveat)', async () => {
    const { report, output } = await runRequireBundle({
      name: 'rollup with @rollup/plugin-commonjs (default options) and the package external',
      external: true,
      bundle: outDir => rollupBundle(requireEntry, path.join(outDir, 'rollup-default.mjs'), [commonjs()], [packageName])
    })
    assert.strictEqual(report.requireIsSubstituteClass, true, `require() gives the Substitute class: ${output}`)
    assert.deepStrictEqual(report.exportKeys, [], output)
    assert.strictEqual(report.substitute, 'undefined', output)
    assert.strictEqual(report.arg, 'undefined', output)
  })
})

// PK4-1 (P33): ES module code bundled into CommonJS output with the package external. `bundle` builds `input` into
// `outDir` and returns the path of the bundle; each of them must require() the package at run time.
type CommonJsOutputBundler = { name: string, bundle: (input: string, outDir: string) => Promise<string> }

const commonJsOutputBundlers: CommonJsOutputBundler[] = [
  {
    name: "rollup, output.format 'cjs'",
    bundle: (input, outDir) => rollupCommonJsBundle(input, path.join(outDir, 'rollup.cjs'))
  },
  {
    name: "esbuild, format 'cjs' and packages: 'external'",
    bundle: async (input, outDir) => {
      const outfile = path.join(outDir, 'esbuild.cjs')
      await esbuild.build({ entryPoints: [input], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile, logLevel: 'silent' })
      return outfile
    }
  },
  {
    name: "webpack, target 'node' and a commonjs external",
    bundle: (input, outDir) => webpackBundle(input, outDir, 'webpack.cjs', { [packageName]: `commonjs ${packageName}` })
  },
  {
    // Vite 8 bundles with Rolldown, older Vite with Rollup; both keep dependencies external in SSR builds.
    name: "Vite SSR build with output.format 'cjs' (default externals)",
    bundle: (input, outDir) => viteSsrBundle(input, outDir, undefined, { format: 'cjs', entryFileNames: '[name].cjs' })
  }
]

test.describe('PK4-1 (P33) CommonJS output with the package external: the named import works, the default import is the exports object', () => {
  test.after(() => {
    fs.rmSync(bundleRoot, { recursive: true, force: true })
  })

  const buildAndRun = async (bundler: CommonJsOutputBundler, input: string) => {
    const outDir = makeOutDir()
    const bundle = await bundler.bundle(input, outDir)
    assert.ok(requiresPackageAtRunTime(bundle), `${bundler.name}: the bundle require()s the package at run time`)
    return runBundle(bundle, outDir)
  }

  for (const bundler of commonJsOutputBundlers) {
    test.it(`PK4-1 ${bundler.name}, package external: the named import { Substitute, Arg } works`, async () => {
      const { report, output } = await buildAndRun(bundler, namedEntry)
      assert.deepStrictEqual(report, {
        substitute: 'function',
        substituteFor: 'function',
        arg: 'object',
        received: 'symbol',
        substituteException: 'function',
        returns: 3,
        failingAssertion: 'SubstituteException'
      }, `${bundler.name}: ${output}`)
    })
  }

  // The documented fix for Rollup (and for Vite 7 and older, through build.rollupOptions.output.interop).
  test.it("PK4-1 rollup, output.format 'cjs' with output.interop: 'auto', package external: the default import is the Substitute class", async () => {
    const { report, output } = await buildAndRun({
      name: "rollup, output.format 'cjs', output.interop 'auto'",
      bundle: (input, outDir) => rollupCommonJsBundle(input, path.join(outDir, 'rollup-interop-auto.cjs'), 'auto')
    }, entry)
    assert.deepStrictEqual(report, {
      defaultImport: 'function',
      defaultIsNamedSubstitute: true,
      namespaceDefaultIsSubstitute: true,
      arg: 'object',
      received: 'symbol',
      substituteException: 'function',
      namespaceKeys: exportNames,
      undefinedNamespaceValues: [],
      returns: 3,
      failingAssertion: 'SubstituteException'
    }, output)
  })

  // The caveat itself, for bundlers/entry.mjs (an .mjs source). If one of these fails because the default import is
  // now the Substitute class, the tool changed: update the guide "Importing" and MIGRATION "Imports and packaging",
  // and then this check.
  for (const bundler of commonJsOutputBundlers) {
    test.it(`PK4-1 ${bundler.name}, package external: the default import of an .mjs source is the exports object (the documented caveat)`, async () => {
      const { report, output } = await buildAndRun(bundler, entry)
      assert.strictEqual(report.defaultImport, 'object', `the default import is module.exports: ${output}`)
      assert.strictEqual(report.defaultIsNamedSubstitute, false, output)
      assert.strictEqual(report.returns, 3, `the named import still works: ${output}`)
    })
  }
})
