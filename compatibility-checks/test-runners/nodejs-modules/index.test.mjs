import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Substitute, Arg } from '@fluffy-spoon/substitute'

// Round 9 (E53, R8FE-1): node:test's mock.module() (node --test --experimental-test-module-mocks) takes the named
// exports as an object of its own keys, which a substitute (a function without own keys) is not. The documented
// pattern: an object of the substitute's member handles as the named exports, or the substitute as the default export
// on its own. (Node.js 24 and newer also take them as `exports: { exec: sub.exec, default: sub }`, and deprecate
// namedExports and defaultExport; Node.js 22 knows only these.) test/index.ts runs this file; it must pass.

const childProcess = Substitute.for()
const fs = Substitute.for()
const os = Substitute.for()
os.hostname().returns('box')
childProcess.exec(Arg.any('string'), Arg.any('function')).mimicks((command, callback) => callback(null, ''))
fs.writeFile(Arg.all()).resolves()

mock.module('node:child_process', { namedExports: { exec: childProcess.exec } })
mock.module('node:fs/promises', { namedExports: { writeFile: fs.writeFile } })
mock.module('node:os', { defaultExport: os })

const { notify } = await import('./src/notify.mjs')

test('E53 module mocks made of substitutes answer the code under test, and the calls are checked', async () => {
  assert.equal(await notify('hi there'), 'box')
  childProcess.received(1).exec('notify-send "hi there"', Arg.any())
  fs.received(1).writeFile('/tmp/last-notify.txt', 'hi there')
  os.received(1).hostname()
})

test('E53 a substitute as the named exports is refused by node:test', () => {
  assert.throws(() => mock.module('node:path', { namedExports: Substitute.for() }), /namedExports/)
})
