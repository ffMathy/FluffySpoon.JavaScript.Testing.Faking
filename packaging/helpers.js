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
 * Copies the working tree of the repository (as it is on disk, uncommitted changes included) into `destination`
 * and returns it. Left out: build output (dist/, dist-spec/), .git, other directories whose name starts with a
 * dot, packed tarballs and every node_modules/. The copy's node_modules/ is a link to the repository's, so that
 * its scripts find the same tools. PK4-4: the packaging checks pack such a copy, so they never touch the
 * working tree's dist/.
 */
const copyRepository = destination => {
  const skippedAtRoot = name => name === 'dist' || name === 'dist-spec' || name === '.git' || /\.tgz$/.test(name)
  const copy = (from, to, atRoot) => {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      if (atRoot && (skippedAtRoot(entry.name) || (entry.isDirectory() && entry.name.startsWith('.')))) continue
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      if (entry.isDirectory()) copy(source, target, false)
      else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), target)
      else if (entry.isFile()) fs.copyFileSync(source, target)
    }
  }
  copy(root, destination, true)
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return destination
}

/**
 * A snapshot of every file below `directory` (path, size and modification time), or null if it does not exist.
 * Two snapshots are equal only if nothing in the directory was written, removed or added in between.
 */
const snapshotDirectory = directory => {
  if (!fs.existsSync(directory)) return null
  const files = {}
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      const name = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        files[`${name}/`] = 'directory'
        walk(file, name)
      } else {
        const stat = fs.lstatSync(file)
        files[name] = `${stat.size} bytes, modified ${stat.mtimeMs}`
      }
    }
  }
  walk(directory, '')
  return files
}

/**
 * Packs the repository (or the copy of it in `cwd`) exactly like `npm publish` does (lifecycle scripts
 * included) and returns the tarball path and the list of files in it.
 */
const pack = (destination, cwd = root) => {
  const output = execFileSync(npm, ['pack', '--json', '--silent', '--pack-destination', destination], {
    cwd,
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
  copyRepository,
  snapshotDirectory,
  pack,
  createConsumer,
  runNode,
  childEnvironment,
  makeTemporaryDirectory,
  removeTemporaryDirectories
}
