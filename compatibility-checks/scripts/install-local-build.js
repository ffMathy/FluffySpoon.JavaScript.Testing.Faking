'use strict'
// Packs the repository root exactly like `npm publish` does (its prepack script builds dist/) and installs
// the tarball into this project, so the compatibility checks run against what would be published, not
// against ../src. Runs automatically before `npm test` (the pretest script).
//
// The tarball is installed with --no-save, so package.json and package-lock.json here stay untouched.

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const here = path.resolve(__dirname, '..')
const root = path.resolve(here, '..')
const isWindows = process.platform === 'win32'
const npm = isWindows ? 'npm.cmd' : 'npm'

const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'substitute-compatibility-'))
try {
  const output = execFileSync(npm, ['pack', '--json', '--silent', '--pack-destination', destination], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: isWindows
  })
  const [{ filename }] = JSON.parse(output.slice(output.indexOf('[')))
  const tarball = path.join(destination, filename)
  // Remove a previously installed build, so that npm never keeps a stale copy.
  fs.rmSync(path.join(here, 'node_modules', '@fluffy-spoon', 'substitute'), { recursive: true, force: true })
  execFileSync(npm, ['install', '--no-save', '--no-audit', '--no-fund', tarball], {
    cwd: here,
    stdio: 'inherit',
    shell: isWindows
  })
  const installed = require(path.join(here, 'node_modules', '@fluffy-spoon', 'substitute', 'package.json'))
  console.log(`Installed ${installed.name}@${installed.version} from ${filename}`)
} finally {
  fs.rmSync(destination, { recursive: true, force: true })
}
