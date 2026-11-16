import test from 'ava'
import { spawnSync } from 'child_process'
import * as path from 'path'

// Round 4: the runtime findings of the round-3 verification (R3-*), decided in the fix spec as E1-E7.

const library = path.resolve(__dirname, '../../../src/index.js')

/** Runs a script with the library in a child process, and returns what it prints as JSON. */
const runScript = (script: string, options: { args?: string[], env?: Record<string, string> } = {}): any => {
  const result = spawnSync(process.execPath, [...(options.args ?? []), '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...options.env }
  })
  if (result.status !== 0) throw new Error(`exit code ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

test('R3-2 (E7) the runtime\'s own util.promisify.custom and util.inspect.custom are used, also where they are not the registered symbols', t => {
  // Node.js 10.0 to 12.16.1 and 13.0 to 13.11 have a util.promisify.custom of their own (Node.js 10.0 to 10.11 the
  // same for util.inspect.custom), not Symbol.for('nodejs.util.promisify.custom'). This child process makes the
  // running Node.js look like that before it loads the library.
  const result = runScript(`
    const util = require('util')
    const promisifyCustom = util.promisify.custom = Symbol('util.promisify.custom')
    const inspectCustom = util.inspect.custom = Symbol('util.inspect.custom')
    const { Substitute, Arg } = require(${JSON.stringify(library)})

    // util.promisify of those versions: the function under the custom key, if there is one, or a wrapper
    const promisify = original => typeof original[promisifyCustom] === 'function' ? original[promisifyCustom]
      : (...args) => new Promise((resolve, reject) => original(...args, (error, value) => error ? reject(error) : resolve(value)))

    const fs = Substitute.for()
    fs.readFile(Arg.any(), Arg.any()).mimicks((file, done) => done(null, 'contents of ' + file))
    const loaded = promisify(fs.readFile)('/etc/app.json')
    const custom = typeof fs.readFile[promisifyCustom]
    let recorded = false
    try { fs.readFile.didNotReceive()[promisifyCustom] } catch (error) { recorded = true }
    const matcher = Arg.is(() => true)
    Promise.resolve(loaded).then(contents => console.log(JSON.stringify({
      contents: typeof contents === 'string' ? contents : typeof contents,
      custom,
      recorded,
      printed: typeof matcher[inspectCustom] === 'function' ? matcher[inspectCustom]() : 'not printable'
    })))
  `)
  t.deepEqual(result, {
    contents: 'contents of /etc/app.json',
    custom: 'undefined',
    recorded: false,
    printed: 'Arg.is{() => true}'
  })
})
