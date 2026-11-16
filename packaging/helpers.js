'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const temporaryDirectories = []
/** Creates a temporary directory that removeTemporaryDirectories() deletes again. */
const makeTemporaryDirectory = prefix => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `substitute-${prefix}-`))
  temporaryDirectories.push(directory)
  return directory
}
const removeTemporaryDirectories = () => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
}

const readText = file => fs.readFileSync(path.join(root, file), 'utf8')
const readJson = file => JSON.parse(readText(file))

/** The environment for child processes, without what would make them behave like a child of a test runner. */
const childEnvironment = () => {
  const environment = { ...process.env }
  for (const name of Object.keys(environment)) {
    if (name.startsWith('NODE_TEST_') || name.startsWith('AVA_')) delete environment[name]
  }
  return environment
}

/**
 * Packs the repository exactly like `npm publish` does (lifecycle scripts included) and returns the
 * tarball path and the list of files in it.
 */
const pack = destination => {
  const output = execFileSync(npm, ['pack', '--json', '--silent', '--pack-destination', destination], {
    cwd: root,
    encoding: 'utf8',
    env: childEnvironment(),
    shell: process.platform === 'win32'
  })
  const [result] = JSON.parse(output.slice(output.indexOf('[')))
  return {
    tarball: path.join(destination, result.filename),
    files: result.files.map(file => file.path).sort()
  }
}

/** Creates an empty consumer project with the tarball extracted as node_modules/@fluffy-spoon/substitute. */
const createConsumer = tarball => {
  const consumer = makeTemporaryDirectory('consumer')
  const target = path.join(consumer, 'node_modules', '@fluffy-spoon', 'substitute')
  fs.mkdirSync(target, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'])
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true }))
  return consumer
}

const runNode = (cwd, args) => execFileSync(process.execPath, args, {
  cwd,
  encoding: 'utf8',
  env: childEnvironment(),
  stdio: 'pipe'
})

module.exports = {
  root,
  readText,
  readJson,
  pack,
  createConsumer,
  runNode,
  childEnvironment,
  makeTemporaryDirectory,
  removeTemporaryDirectories
}
