#!/usr/bin/env node
// TD-10 / T32 The public API carries documentation comments that editors show (quick info), in the BUILT package
// typings (dist/*.d.ts). Each `/*@name*/` marker in the consumer below sits right before an identifier; the check asks
// the TypeScript language service for the quick info at that identifier and fails when it has no documentation.
//
//   npm run build && node spec-types/TD-10.T32.jsdoc.js
//
// `npm run test:types:min-ts` runs it too (see spec-types/min-ts/check.js). The consumer only exists in memory.
'use strict'
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
if (!fs.existsSync(path.join(root, 'dist', 'index.d.ts'))) {
  console.error('The package typings (dist/index.d.ts) were not found: run `npm run build` first.')
  process.exit(1)
}

const consumerPath = path.join(__dirname, '__jsdoc-consumer__.ts')
const consumer = `
import {
  Substitute, Arg, SubstituteOf, SubstituteException,
  received, didNotReceive, mimick, clearReceivedCalls, configure, returns, throws, resolves, rejects, mimicks
} from '../dist'

interface Calculator {
  add(a: number, b: number): number
  load(): Promise<number>
}
const calculator = Substitute./*@Substitute.for*/for<Calculator>()
const asSubstitute: /*@SubstituteOf*/SubstituteOf<Calculator> = calculator

calculator.add(/*@Arg*/Arg.any(), 2)
calculator.add(Arg./*@Arg.any*/any('number'), Arg.any./*@Arg.any.not*/not('number'))
calculator.add(Arg./*@Arg.is*/is(x => x > 0), Arg.is./*@Arg.is.not*/not(x => x === 0))
calculator.add(Arg./*@Arg.all*/all())

calculator.add(1, 2)./*@returns()*/returns(3)
calculator.add(1, 2)./*@throws()*/throws(new Error())
calculator.add(1, 2)./*@mimicks()*/mimicks((a, b) => a + b)
calculator.load()./*@resolves()*/resolves(1)
calculator.load()./*@rejects()*/rejects(new Error())
calculator.add(1, 2)[/*@[returns]*/returns](3)
calculator.add(1, 2)[/*@[throws]*/throws](new Error())
calculator.add(1, 2)[/*@[mimicks]*/mimicks]((a, b) => a + b)
calculator.load()[/*@[resolves]*/resolves](1)
calculator.load()[/*@[rejects]*/rejects](new Error())

calculator./*@received()*/received(1).add(1, 2)
calculator./*@didNotReceive()*/didNotReceive().add(1, 2)
calculator[/*@[received]*/received]().add(1, 2)
calculator[/*@[didNotReceive]*/didNotReceive]().add(1, 2)
calculator[/*@[configure]*/configure]().add(1, 2).returns(3)
calculator[/*@[mimick]*/mimick]({ add: (a, b) => a + b, load: async () => 1 })
calculator[/*@[clearReceivedCalls]*/clearReceivedCalls]()

const error = new /*@SubstituteException*/SubstituteException('message')
export { asSubstitute, error }
`

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  target: ts.ScriptTarget.ES2018,
  lib: ['lib.es2018.d.ts'],
  strict: true,
  noEmit: true,
  types: []
}
const host = {
  getScriptFileNames: () => [consumerPath],
  getScriptVersion: () => '1',
  getScriptSnapshot: fileName => {
    const text = fileName === consumerPath ? consumer : (fs.existsSync(fileName) ? fs.readFileSync(fileName, 'utf8') : undefined)
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
  },
  getCurrentDirectory: () => __dirname,
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
  fileExists: fileName => fileName === consumerPath || fs.existsSync(fileName),
  readFile: fileName => fileName === consumerPath ? consumer : fs.readFileSync(fileName, 'utf8'),
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories
}
const service = ts.createLanguageService(host, ts.createDocumentRegistry())

let failed = false
const diagnostics = service.getSemanticDiagnostics(consumerPath).concat(service.getSyntacticDiagnostics(consumerPath))
for (const diagnostic of diagnostics) {
  failed = true
  console.log(`FAIL the consumer does not compile: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
}

const marker = /\/\*@(.+?)\*\//g
let match
let count = 0
while ((match = marker.exec(consumer)) !== null) {
  count++
  const name = match[1]
  const info = service.getQuickInfoAtPosition(consumerPath, match.index + match[0].length)
  const documentation = info ? ts.displayPartsToString(info.documentation).trim() : ''
  if (documentation === '') {
    failed = true
    console.log(`FAIL ${name}: no documentation comment`)
  } else {
    console.log(`ok   ${name}: ${documentation.split('\n')[0].slice(0, 90)}`)
  }
}
if (count === 0) {
  failed = true
  console.log('FAIL no markers found')
}
process.exit(failed ? 1 : 0)
