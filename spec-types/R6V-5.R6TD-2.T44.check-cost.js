#!/usr/bin/env node
// R6V-5 / R6TD-2 / T44 Type-check cost of a substitute of a large concrete union. Compiles
// spec-types/R6V-5.R6TD-2.T44.element-union.ts against the BUILT package typings (dist/*.d.ts) with the project's
// TypeScript and fails when it needs more type instantiations than the budget below. Instantiation counts are
// deterministic (unlike timings). With the comparison of every variant with every other one (T42, 2.0.1 before T44)
// the file needed about 525 000 instantiations on TypeScript 5.9, and the element union took 1.6 to 1.8 times as long
// to check as before T42 on TypeScript 3.6 to 3.8; now it needs about 442 000, and the element union checks about as
// fast as before T42.
//
//   npm run build && node spec-types/R6V-5.R6TD-2.T44.check-cost.js
//
// `npm run test:types:min-ts` runs it too (see spec-types/min-ts/check.js). The consumer only exists in memory.
'use strict'
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const INSTANTIATION_BUDGET = 470000

const root = path.resolve(__dirname, '..')
if (!fs.existsSync(path.join(root, 'dist', 'index.d.ts'))) {
  console.error('The package typings (dist/index.d.ts) were not found: run `npm run build` first.')
  process.exit(1)
}

const fixturePath = path.join(__dirname, 'R6V-5.R6TD-2.T44.element-union.ts')
const consumerPath = path.join(__dirname, '__T44-consumer__.ts')
const consumer = fs.readFileSync(fixturePath, 'utf8').replace(/from '\.\.\/src'/g, "from '../dist'")

const options = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2018,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10 || ts.ModuleResolutionKind.NodeJs,
  lib: ['lib.es2018.d.ts', 'lib.dom.d.ts'],
  types: [],
  skipLibCheck: true
}
const host = ts.createCompilerHost(options)
const getSourceFile = host.getSourceFile
host.getSourceFile = (fileName, languageVersion, ...rest) =>
  path.resolve(fileName) === consumerPath ?
    ts.createSourceFile(fileName, consumer, languageVersion, true) :
    getSourceFile.call(host, fileName, languageVersion, ...rest)
const fileExists = host.fileExists
host.fileExists = fileName => path.resolve(fileName) === consumerPath || fileExists.call(host, fileName)
const readFile = host.readFile
host.readFile = fileName => path.resolve(fileName) === consumerPath ? consumer : readFile.call(host, fileName)

const program = ts.createProgram([consumerPath], options, host)
const diagnostics = ts.getPreEmitDiagnostics(program)
const instantiations = program.getInstantiationCount()

let failed = false
if (diagnostics.length > 0) {
  failed = true
  console.log(`FAIL ${path.basename(fixturePath)} does not compile:`)
  console.log(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n'
  }).trim().replace(/^/gm, '     '))
}
const withinBudget = instantiations <= INSTANTIATION_BUDGET
failed = failed || !withinBudget
console.log(`${withinBudget ? 'ok  ' : 'FAIL'} ${path.basename(fixturePath)}: ${instantiations} type instantiations (budget ${INSTANTIATION_BUDGET}, TypeScript ${ts.version})`)
process.exit(failed ? 1 : 0)
