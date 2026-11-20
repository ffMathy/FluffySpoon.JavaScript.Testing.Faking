#!/usr/bin/env node
// Type-checks spec-types/min-ts/consumer.ts against the BUILT package typings (dist/*.d.ts, resolved through
// package.json like an installed package) with older TypeScript versions, each installed on the fly with npx.
//
//   npm run test:types:min-ts                     # builds dist/, then checks the minimum supported version and 4.3
//   node spec-types/min-ts/check.js 3.9 4.0 4.4   # after `npm run build`: check other versions
//
// The consumer is compiled with `strict`, without @types/node and with skipLibCheck both off and on. The declaration-emit
// fixtures spec-types/declaration-emit/R13TD-1.T73.check-views.ts, R14TD-1.annotated-generic-helpers.ts and
// R17FE-2.T83.check-view-type.ts (importing the package instead of ../../src) are compiled with `declaration: true` and
// `emitDeclarationOnly` too, into the temporary directory (R13TD-1, T73; R14TD-1; R17FE-2, T83). (The R14TD-2 / T77
// fixture needs @types/node and a newer TypeScript.)
//
// Afterwards it runs spec-types/TD-10.T32.jsdoc.js, which checks (with the project's own TypeScript) that the public
// API in the same built typings carries documentation comments, and spec-types/R6V-5.R6TD-2.T44.check-cost.js, which
// checks the type-check cost of a substitute of a large union.
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MINIMUM_TYPESCRIPT_VERSION = '3.6'
// Also checked by default: versions with typing behaviour of their own that the consumer pins (4.3: unions with a
// string index signature, R7TD-3).
const PINNED_TYPESCRIPT_VERSIONS = ['4.3']

const root = path.resolve(__dirname, '..', '..')
const versions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [MINIMUM_TYPESCRIPT_VERSION].concat(PINNED_TYPESCRIPT_VERSIONS)
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const typings = packageJson.types || packageJson.typings
if (!typings || !fs.existsSync(path.join(root, typings))) {
  console.error(`The package typings (${typings}) were not found: run \`npm run build\` first.`)
  process.exit(1)
}

const copyDirectory = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyDirectory(source, target)
    else fs.copyFileSync(source, target)
  }
}

const removeDirectory = directory => {
  if (fs.rmSync) fs.rmSync(directory, { recursive: true, force: true })
  else if (fs.existsSync(directory)) fs.rmdirSync(directory, { recursive: true })
}

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'substitute-min-ts-'))
let failed = false
try {
  const packageDirectory = path.join(workDirectory, 'node_modules', '@fluffy-spoon', 'substitute')
  fs.mkdirSync(packageDirectory, { recursive: true })
  fs.copyFileSync(path.join(root, 'package.json'), path.join(packageDirectory, 'package.json'))
  copyDirectory(path.join(root, 'dist'), path.join(packageDirectory, 'dist'))
  fs.copyFileSync(path.join(__dirname, 'consumer.ts'), path.join(workDirectory, 'consumer.ts'))
  const declarationFixtures = {
    'declaration-emit.ts': 'R13TD-1.T73.check-views.ts',
    'declaration-emit-generic.ts': 'R14TD-1.annotated-generic-helpers.ts',
    'declaration-emit-check-view-type.ts': 'R17FE-2.T83.check-view-type.ts'
  }
  for (const [name, fixture] of Object.entries(declarationFixtures)) {
    fs.writeFileSync(
      path.join(workDirectory, name),
      fs.readFileSync(path.join(__dirname, '..', 'declaration-emit', fixture), 'utf8')
        .replace(/from '\.\.\/\.\.\/src'/g, "from '@fluffy-spoon/substitute'")
    )
  }

  for (const skipLibCheck of [false, true]) {
    const compilerOptions = {
      module: 'commonjs',
      moduleResolution: 'node',
      target: 'es2018',
      lib: ['es2018'],
      strict: true,
      noEmit: true,
      skipLibCheck,
      types: []
    }
    fs.writeFileSync(
      path.join(workDirectory, `tsconfig.${skipLibCheck}.json`),
      JSON.stringify({ compilerOptions, files: ['consumer.ts'] }, null, 2)
    )
  }
  const declarationOptions = {
    module: 'commonjs',
    moduleResolution: 'node',
    target: 'es2018',
    lib: ['es2018'],
    strict: true,
    declaration: true,
    emitDeclarationOnly: true,
    outDir: 'declarations',
    skipLibCheck: true,
    types: []
  }
  fs.writeFileSync(
    path.join(workDirectory, 'tsconfig.declaration.json'),
    JSON.stringify({ compilerOptions: declarationOptions, files: Object.keys(declarationFixtures) }, null, 2)
  )

  for (const version of versions) {
    for (const skipLibCheck of [false, true]) {
      const args = ['--yes', '-p', `typescript@${version}`, 'tsc', '-p', path.join(workDirectory, `tsconfig.${skipLibCheck}.json`)]
      const result = spawnSync(npx, args, { cwd: workDirectory, encoding: 'utf8' })
      const ok = result.status === 0
      failed = failed || !ok
      console.log(`${ok ? 'ok  ' : 'FAIL'} typescript@${version} (skipLibCheck: ${skipLibCheck})`)
      if (!ok) console.log(`${result.stdout || ''}${result.stderr || ''}`.trim().replace(/^/gm, '     '))
    }
    const args = ['--yes', '-p', `typescript@${version}`, 'tsc', '-p', path.join(workDirectory, 'tsconfig.declaration.json')]
    const result = spawnSync(npx, args, { cwd: workDirectory, encoding: 'utf8' })
    const emitted = Object.keys(declarationFixtures)
      .every(name => fs.existsSync(path.join(workDirectory, 'declarations', name.replace(/\.ts$/, '.d.ts'))))
    const ok = result.status === 0 && emitted
    failed = failed || !ok
    console.log(`${ok ? 'ok  ' : 'FAIL'} typescript@${version} (declaration emit of check views and annotated generic helpers)`)
    if (!ok) console.log(`${result.stdout || ''}${result.stderr || ''}`.trim().replace(/^/gm, '     '))
    removeDirectory(path.join(workDirectory, 'declarations'))
  }
} finally {
  removeDirectory(workDirectory)
}

const documentation = spawnSync(process.execPath, [path.join(__dirname, '..', 'TD-10.T32.jsdoc.js')], { cwd: root, encoding: 'utf8' })
const documented = documentation.status === 0
failed = failed || !documented
console.log(`${documented ? 'ok  ' : 'FAIL'} documentation comments of the public API (spec-types/TD-10.T32.jsdoc.js)`)
if (!documented) {
  const report = `${documentation.stdout || ''}${documentation.stderr || ''}`.split('\n').filter(line => !line.startsWith('ok'))
  console.log(report.join('\n').trim().replace(/^/gm, '     '))
}
const cost = spawnSync(process.execPath, [path.join(__dirname, '..', 'R6V-5.R6TD-2.T44.check-cost.js')], { cwd: root, encoding: 'utf8' })
const cheap = cost.status === 0
failed = failed || !cheap
console.log(`${cheap ? 'ok  ' : 'FAIL'} type-check cost of a large union (spec-types/R6V-5.R6TD-2.T44.check-cost.js)`)
if (!cheap) console.log(`${cost.stdout || ''}${cost.stderr || ''}`.trim().replace(/^/gm, '     '))
process.exit(failed ? 1 : 0)
