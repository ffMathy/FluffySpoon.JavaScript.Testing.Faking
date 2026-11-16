#!/usr/bin/env node
// Type-checks spec-types/min-ts/consumer.ts against the BUILT package typings (dist/*.d.ts, resolved through
// package.json like an installed package) with older TypeScript versions, each installed on the fly with npx.
//
//   npm run test:types:min-ts                     # builds dist/, then checks the minimum supported version
//   node spec-types/min-ts/check.js 3.9 4.0 4.4   # after `npm run build`: check other versions
//
// The consumer is compiled with `strict`, without @types/node and with skipLibCheck both off and on.
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MINIMUM_TYPESCRIPT_VERSION = '3.6'

const root = path.resolve(__dirname, '..', '..')
const versions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [MINIMUM_TYPESCRIPT_VERSION]
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

const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'substitute-min-ts-'))
let failed = false
try {
  const packageDirectory = path.join(workDirectory, 'node_modules', '@fluffy-spoon', 'substitute')
  fs.mkdirSync(packageDirectory, { recursive: true })
  fs.copyFileSync(path.join(root, 'package.json'), path.join(packageDirectory, 'package.json'))
  copyDirectory(path.join(root, 'dist'), path.join(packageDirectory, 'dist'))
  fs.copyFileSync(path.join(__dirname, 'consumer.ts'), path.join(workDirectory, 'consumer.ts'))

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

  for (const version of versions) {
    for (const skipLibCheck of [false, true]) {
      const args = ['--yes', '-p', `typescript@${version}`, 'tsc', '-p', path.join(workDirectory, `tsconfig.${skipLibCheck}.json`)]
      const result = spawnSync(npx, args, { cwd: workDirectory, encoding: 'utf8' })
      const ok = result.status === 0
      failed = failed || !ok
      console.log(`${ok ? 'ok  ' : 'FAIL'} typescript@${version} (skipLibCheck: ${skipLibCheck})`)
      if (!ok) console.log(`${result.stdout || ''}${result.stderr || ''}`.trim().replace(/^/gm, '     '))
    }
  }
} finally {
  if (fs.rmSync) fs.rmSync(workDirectory, { recursive: true, force: true })
  else fs.rmdirSync(workDirectory, { recursive: true })
}
process.exit(failed ? 1 : 0)
