// F1: the package's ES module entry (dist/index.mjs) wraps its CommonJS build. Bundlers and test runners that
// transform the package themselves turn that CommonJS build into an ES module in different ways (the __esModule
// interop), and once got only undefined exports. These checks bundle bundlers/entry.mjs with each of them, run the
// bundle with Node.js and check that the default, named and namespace imports are the real exports.
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
const exportNames = Object.keys(require('@fluffy-spoon/substitute')).sort()
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

const bundlers: Bundler[] = [
  {
    name: 'rollup with @rollup/plugin-commonjs',
    bundle: async outDir => {
      const file = path.join(outDir, 'rollup.mjs')
      const build = await rollup({
        input: entry,
        external: nodeBuiltins,
        onwarn: warning => { throw new Error(`rollup warning: ${warning.message}`) },
        plugins: [nodeResolve({ preferBuiltins: true }), commonjs()]
      })
      await build.write({ file, format: 'es' })
      await build.close()
      return file
    }
  },
  {
    name: 'webpack',
    bundle: outDir => new Promise((resolve, reject) => {
      webpack({
        mode: 'none',
        target: 'node',
        context: here,
        entry,
        output: { path: outDir, filename: 'webpack.cjs' }
      }, (error, stats) => {
        if (error) return reject(error)
        if (stats === undefined || stats.hasErrors() || stats.hasWarnings()) {
          return reject(new Error(`webpack: ${stats && stats.toString('errors-warnings')}`))
        }
        resolve(path.join(outDir, 'webpack.cjs'))
      })
    })
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
    bundle: async outDir => {
      const { build } = await import('vite')
      await build({
        configFile: false,
        root: here,
        logLevel: 'silent',
        ssr: { noExternal: true },
        build: { ssr: entry, outDir, emptyOutDir: false, write: true }
      })
      const [file] = fs.readdirSync(outDir).filter(name => /^entry\.m?js$/.test(name))
      assert.ok(file, `vite wrote ${fs.readdirSync(outDir).join(', ')}`)
      return path.join(outDir, file)
    }
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

  test.it('F1 vitest with server.deps.inline: default, named and namespace imports are the real exports', async () => {
    const vitestPackage = require.resolve('vitest/package.json', { paths: [here] })
    const vitest = path.join(path.dirname(vitestPackage), require(vitestPackage).bin.vitest)
    const result = await run(process.execPath, [
      vitest, 'run', '--config', 'vitest.inline.config.mts', 'test-runners/vitest-inline/exports.test.ts'
    ], here)
    assert.strictEqual(result.status, 0, result.output)
    assert.match(result.output, /Tests\s+2 passed/, result.output)
  })
})
