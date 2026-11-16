'use strict'
// Runs one compiled documentation snippet in its own process and records what it did:
//   node harness.js <compiled snippet (.js or .mjs)> <result file>
// check.js rewrites the `// prints` and `// throws` lines of a snippet into calls of the global `__docs` object below,
// so the result file says, per Markdown line, what was printed and what was thrown. Uncaught exceptions and unhandled
// rejections are recorded too (the snippet keeps running, like it would in a test runner).
const fs = require('fs')
const util = require('util')
const { pathToFileURL } = require('url')

const [snippet, resultFile] = process.argv.slice(2)
const result = { prints: [], throws: [], uncaught: [], error: null }

const describe = error => {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return { name: typeof error, message: String(error), stack: '' }
  }
  let name
  let message
  let stack
  try { name = String(error.name) } catch (_) { name = 'unknown' }
  try { message = String(error.message) } catch (_) { message = '' }
  try { stack = String(error.stack) } catch (_) { stack = '' }
  return { name, message, stack }
}

global.__docs = {
  print (line, ...values) {
    result.prints.push({ line, text: util.format(...values) })
  },
  throws (line, statement) {
    try {
      statement()
    } catch (error) {
      result.throws.push(Object.assign({ line, threw: true }, describe(error)))
      return
    }
    result.throws.push({ line, threw: false })
  }
}

process.on('uncaughtException', error => {
  result.uncaught.push(Object.assign({ kind: 'uncaught exception' }, describe(error)))
})
process.on('unhandledRejection', error => {
  result.uncaught.push(Object.assign({ kind: 'unhandled rejection' }, describe(error)))
})
process.on('exit', () => {
  fs.writeFileSync(resultFile, JSON.stringify(result))
})

const run = async () => {
  if (snippet.endsWith('.mjs')) await import(pathToFileURL(snippet).href)
  else require(snippet)
}

run().catch(error => {
  result.error = describe(error)
})
