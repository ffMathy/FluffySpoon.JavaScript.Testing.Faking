#!/usr/bin/env node
'use strict'
// The documentation check (`npm run test:docs`). It keeps README.md, MIGRATION.md and CHANGELOG.md honest:
//
// - Every ```typescript / ```ts block is type-checked under `strict` against the BUILT package (dist/, resolved through
//   package.json like an installed copy of @fluffy-spoon/substitute), then run with Node.js.
// - Every ```javascript / ```js block is run with Node.js.
// - `console.log(...) // prints <text>` must print exactly <text> (util.format output, like console.log).
// - `<statement> // throws <ErrorName>` and `<statement> // throws <ErrorName>: <text>` must throw that error (by its
//   `name`; the message must contain <text>). Both must be complete single-line statements.
// - Any other console.log, an unexpected exception, an uncaught exception or an unhandled rejection fails the check.
// - Relative links must point to an existing file, and #anchors to an existing heading.
//
// A block can be marked with an HTML comment on the lines before its fence: <!-- docs-check: <directives> -->
//   skip <reason>     not checked at all (code for old versions, deliberately partial code)
//   compile-only      type-checked but not run (e.g. code that needs a test runner)
//   name=<id>         lets other blocks use this block's code
//   uses=<id>[,<id>]  the named blocks' code (and the code they use) runs first, in the same module; each block
//                     gets a fresh copy
//   esm               an ES module (.mts / .mjs) instead of CommonJS
//   uncaught=<Name>   the block must end with an uncaught <Name> (an assertion reported on process.nextTick)
// A ```text block marked <!-- docs-check: error-message --> must equal "<name>: <message>" of the error thrown by the
// last `// throws` line of the preceding checked block (lines starting with "called at" match any stack frame).
//
// Usage: node spec-docs/check.js [--keep] [file.md ...]   (default: README.md MIGRATION.md CHANGELOG.md; build first)
// See spec-docs/README.md for examples.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const defaultFiles = ['README.md', 'MIGRATION.md', 'CHANGELOG.md']
const checkedLanguages = { typescript: 'ts', ts: 'ts', javascript: 'js', js: 'js' }
const knownDirectives = new Set(['skip', 'compile-only', 'name', 'uses', 'esm', 'uncaught', 'error-message'])
const snippetTimeout = 20 * 1000

// ---------------------------------------------------------------------------------------------------------------------
// Markdown

const directivePattern = /^\s*<!--\s*docs-check:(.*?)-->\s*$/
const commentPattern = /^\s*<!--(.*?)-->\s*$/
const fenceOpenPattern = /^(\s*)(`{3,}|~{3,})(.*)$/

const parseDirectives = (text, problems, location) => {
  const directives = {}
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const [key, ...rest] = token.split('=')
    const value = rest.join('=')
    if (!knownDirectives.has(key)) {
      problems.push({ ...location, message: `unknown docs-check directive "${token}"` })
      continue
    }
    if (key === 'skip') {
      directives.skip = tokens.slice(index + 1).join(' ') || 'no reason given'
      break
    }
    if (key === 'compile-only') directives.compileOnly = true
    else if (key === 'esm') directives.esm = true
    else if (key === 'error-message') directives.errorMessage = true
    else if (!value) problems.push({ ...location, message: `docs-check directive "${key}" needs a value (${key}=...)` })
    else if (key === 'name') directives.name = value
    else if (key === 'uses') directives.uses = value.split(',').filter(Boolean)
    else if (key === 'uncaught') directives.uncaught = value
  }
  return directives
}

/** Splits a Markdown file into fenced code blocks, with the HTML comments directly before each fence. */
const parseMarkdown = (file, text) => {
  const lines = text.split(/\r?\n/)
  const blocks = []
  const problems = []
  let pending = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const open = fenceOpenPattern.exec(line)
    if (open) {
      const [, indent, fence, info] = open
      const language = info.trim().split(/\s+/)[0] || ''
      const fenceLine = index + 1
      const code = []
      let closed = false
      for (index++; index < lines.length; index++) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[index])
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
          closed = true
          break
        }
        const content = lines[index]
        const strip = Math.min(indent.length, content.length - content.trimStart().length)
        code.push(content.slice(strip))
      }
      const location = { file, line: fenceLine }
      if (!closed) problems.push({ ...location, message: 'code block is not closed' })
      const directives = {}
      const comments = []
      for (const comment of pending) {
        comments.push(comment.text)
        if (comment.directives) Object.assign(directives, parseDirectives(comment.directives, problems, location))
      }
      pending = []
      blocks.push({ file, fenceLine, firstLine: fenceLine + 1, language, code, directives, comments })
      continue
    }
    const directive = directivePattern.exec(line)
    const comment = commentPattern.exec(line)
    if (comment) {
      pending.push({ text: comment[1].trim(), line: index + 1, directives: directive ? directive[1] : undefined })
    } else if (line.trim() !== '') {
      for (const comment of pending.filter(c => c.directives !== undefined)) {
        problems.push({ file, line: comment.line, message: 'docs-check directive is not followed by a code block' })
      }
      pending = []
    }
  }
  for (const comment of pending.filter(c => c.directives !== undefined)) {
    problems.push({ file, line: comment.line, message: 'docs-check directive is not followed by a code block' })
  }
  return { blocks, problems }
}

// ---------------------------------------------------------------------------------------------------------------------
// Links: relative links must point to an existing file, and #anchors to an existing heading (GitHub's anchor rules).

/** The lines of a Markdown file outside of fenced code blocks, with their line numbers. */
const proseLines = text => {
  const result = []
  let fence
  text.split(/\r?\n/).forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = undefined
    } else if (marker) {
      fence = marker[1]
    } else {
      result.push({ line, number: index + 1 })
    }
  })
  return result
}

const headingAnchors = text => {
  const counts = new Map()
  const anchors = new Set()
  for (const { line } of proseLines(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (!heading) continue
    const slug = heading[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-')
    const count = counts.get(slug) || 0
    counts.set(slug, count + 1)
    anchors.add(count === 0 ? slug : `${slug}-${count}`)
  }
  return anchors
}

const checkLinks = (file, text) => {
  const problems = []
  const anchorsOf = new Map()
  const anchors = target => {
    if (!anchorsOf.has(target)) anchorsOf.set(target, headingAnchors(fs.readFileSync(target, 'utf8')))
    return anchorsOf.get(target)
  }
  for (const { line, number } of proseLines(text)) {
    const withoutCode = line.replace(/`+[^`]*`+/g, '')
    for (const [, target] of withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^[a-z][a-z+.-]*:/i.test(target)) continue
      const [pathPart, anchor] = target.split('#')
      const targetFile = pathPart ? path.resolve(root, path.dirname(file), pathPart) : path.resolve(root, file)
      const location = { file, line: number }
      if (!fs.existsSync(targetFile)) {
        problems.push({ ...location, message: `broken link ${target}: ${path.relative(root, targetFile)} does not exist` })
      } else if (anchor !== undefined && targetFile.endsWith('.md') && !anchors(targetFile).has(anchor)) {
        problems.push({ ...location, message: `broken link ${target}: ${path.relative(root, targetFile)} has no heading with the anchor #${anchor}` })
      }
    }
  }
  return problems
}

// ---------------------------------------------------------------------------------------------------------------------
// Snippets

const printsPattern = /^(.*?)\s*\/\/ prints (.*?)\s*$/
const throwsPattern = /^(\s*)(.*?);?\s*\/\/ throws ([A-Za-z_$][\w$]*)(?::\s*(.*?))?\s*$/

/** Rewrites the `// prints` and `// throws` lines of a block and collects what they promise. Keeps the line count. */
const instrument = (block, problems) => {
  const expectations = []
  const lines = block.code.map((line, offset) => {
    const markdownLine = block.firstLine + offset
    const location = { file: block.file, line: markdownLine }
    const prints = printsPattern.exec(line)
    if (prints) {
      const [, code, text] = prints
      if (!code.includes('console.log(')) {
        problems.push({ ...location, message: '"// prints" needs a console.log(...) call on the same line' })
        return line
      }
      expectations.push({ kind: 'prints', line: markdownLine, text })
      return code.replace('console.log(', `__docs.print(${markdownLine}, `)
    }
    const throws = throwsPattern.exec(line)
    if (throws) {
      const [, indent, code, name, message] = throws
      expectations.push({ kind: 'throws', line: markdownLine, name, message })
      return `${indent}__docs.throws(${markdownLine}, () => { ${code} })`
    }
    if (line.includes('console.log(')) {
      problems.push({ ...location, message: 'console.log(...) without a "// prints <output>" comment' })
    }
    return line
  })
  return { lines, expectations }
}

const slug = file => path.basename(file).replace(/\.md$/i, '').replace(/[^\w]+/g, '-').toLowerCase()

const buildSnippets = parsed => {
  const problems = []
  const named = new Map()
  const snippets = []
  const messageChecks = []
  for (const { blocks } of parsed) {
    let previous
    for (const block of blocks) {
      const location = { file: block.file, line: block.fenceLine }
      const kind = checkedLanguages[block.language]
      const { directives } = block
      if (block.language === '') {
        problems.push({ ...location, message: 'code block without a language tag (use ```typescript, ```js, ```sh, ```text, ...)' })
        continue
      }
      if (directives.errorMessage) {
        if (block.language !== 'text') problems.push({ ...location, message: 'error-message is only allowed on ```text blocks' })
        else if (!previous) problems.push({ ...location, message: 'error-message block has no checked code block before it' })
        else messageChecks.push({ block, snippet: previous })
        continue
      }
      if (!kind) {
        if (Object.keys(directives).length > 0 && !directives.skip) {
          problems.push({ ...location, message: `docs-check directives on a \`\`\`${block.language} block, which is not checked` })
        }
        continue
      }
      if (directives.skip) continue
      const snippetProblems = []
      const { lines, expectations } = instrument(block, snippetProblems)
      if (directives.compileOnly && expectations.length > 0) {
        snippetProblems.push({ ...location, message: '"// prints" and "// throws" cannot be checked in a compile-only block' })
      }
      if (kind === 'js' && directives.compileOnly) {
        snippetProblems.push({ ...location, message: 'compile-only is only allowed on TypeScript blocks' })
      }
      const extension = kind === 'ts' ? (directives.esm ? '.mts' : '.ts') : (directives.esm ? '.mjs' : '.js')
      const snippet = {
        id: `${slug(block.file)}-${String(block.fenceLine).padStart(4, '0')}`,
        block,
        kind,
        extension,
        lines,
        expectations,
        problems: snippetProblems,
        directives
      }
      if (directives.name) {
        if (named.has(directives.name)) problems.push({ ...location, message: `there is already a block named "${directives.name}"` })
        named.set(directives.name, snippet)
      }
      snippets.push(snippet)
      previous = snippet
    }
  }
  // The blocks a snippet uses, transitively and in order, each once.
  const usedBlocks = (snippet, location, problems, path = []) => {
    const result = []
    for (const name of snippet.directives.uses || []) {
      const used = named.get(name)
      if (!used) {
        problems.push({ ...location, message: `uses=${name}: there is no block named "${name}"` })
        continue
      }
      if (used === snippet || path.includes(used)) {
        problems.push({ ...location, message: `uses=${name}: blocks cannot use each other in a cycle` })
        continue
      }
      if (used.kind !== snippet.kind) problems.push({ ...location, message: `uses=${name}: a ${snippet.kind} block cannot use a ${used.kind} block` })
      if (used.expectations.length > 0) problems.push({ ...location, message: `uses=${name}: a block that other blocks use must not contain "// prints" or "// throws"` })
      for (const block of [...usedBlocks(used, location, problems, [...path, snippet]), used]) {
        if (!result.includes(block)) result.push(block)
      }
    }
    return result
  }
  for (const snippet of snippets) {
    const location = { file: snippet.block.file, line: snippet.block.fenceLine }
    snippet.source = []
    snippet.lineMap = []
    for (const used of usedBlocks(snippet, location, snippet.problems)) {
      used.lines.forEach((line, offset) => {
        snippet.source.push(line)
        snippet.lineMap.push({ file: used.block.file, line: used.block.firstLine + offset })
      })
    }
    snippet.lines.forEach((line, offset) => {
      snippet.source.push(line)
      snippet.lineMap.push({ file: snippet.block.file, line: snippet.block.firstLine + offset })
    })
  }
  return { snippets, messageChecks, problems }
}

// ---------------------------------------------------------------------------------------------------------------------
// Type-checking and running

const globalsDeclaration = [
  '// Generated by spec-docs/check.js: the helpers that the `// prints` and `// throws` lines are rewritten to.',
  'declare const __docs: {',
  '  print(line: number, ...values: unknown[]): void',
  '  throws(line: number, statement: () => unknown): void',
  '}',
  ''
].join('\n')

const prepareWorkDirectory = () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'substitute-docs-'))
  fs.mkdirSync(path.join(work, 'src'))
  fs.mkdirSync(path.join(work, 'out'))
  const modules = path.join(work, 'node_modules')
  fs.mkdirSync(path.join(modules, '@fluffy-spoon'), { recursive: true })
  // The package itself, resolved through its package.json (exports map, types) like an installed copy.
  fs.symlinkSync(root, path.join(modules, '@fluffy-spoon', 'substitute'), 'junction')
  // Test runners that examples may import (compile-only examples).
  for (const name of ['ava']) {
    const target = path.join(root, 'node_modules', name)
    if (fs.existsSync(target)) fs.symlinkSync(target, path.join(modules, name), 'junction')
  }
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'docs-check', private: true, type: 'commonjs' }))
  return work
}

const typeCheckAndEmit = (work, snippets) => {
  const ts = require('typescript')
  const sourceDirectory = path.join(work, 'src')
  const outDirectory = path.join(work, 'out')
  const byFile = new Map()
  const rootNames = [path.join(sourceDirectory, 'docs-check-globals.d.ts')]
  fs.writeFileSync(rootNames[0], globalsDeclaration)
  for (const snippet of snippets.filter(s => s.kind === 'ts')) {
    const file = path.join(sourceDirectory, snippet.id + snippet.extension)
    fs.writeFileSync(file, snippet.source.join('\n') + '\n')
    rootNames.push(file)
    byFile.set(path.normalize(file), snippet)
    snippet.sourceFile = file
    snippet.outputFile = path.join(outDirectory, snippet.id + (snippet.extension === '.mts' ? '.mjs' : '.js'))
  }
  const options = {
    strict: true,
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
    esModuleInterop: true,
    types: ['node'],
    typeRoots: [path.join(root, 'node_modules', '@types')],
    rootDir: sourceDirectory,
    outDir: outDirectory,
    inlineSourceMap: true,
    newLine: ts.NewLineKind.LineFeed,
    skipLibCheck: false
  }
  const program = ts.createProgram({ rootNames, options })
  const general = []
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const snippet = diagnostic.file && byFile.get(path.normalize(diagnostic.file.fileName))
    if (snippet && diagnostic.start !== undefined) {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      const mapped = snippet.lineMap[line] || { file: snippet.block.file, line: snippet.block.fenceLine }
      snippet.problems.push({ ...mapped, message: `error TS${diagnostic.code}: ${text}` })
      snippet.typeErrors = true
    } else {
      const where = diagnostic.file ? path.relative(root, diagnostic.file.fileName) : 'TypeScript'
      general.push({ file: where, line: 0, message: `error TS${diagnostic.code}: ${text}` })
    }
  }
  program.emit()
  return general
}

const childEnvironment = () => {
  const environment = { ...process.env, NO_COLOR: '1' }
  for (const name of Object.keys(environment)) {
    if (name === 'FORCE_COLOR' || name.startsWith('NODE_TEST_') || name.startsWith('AVA_')) delete environment[name]
  }
  return environment
}

const runSnippet = (work, snippet) => new Promise(resolve => {
  const resultFile = path.join(work, `${snippet.id}.result.json`)
  const child = spawn(process.execPath, ['--enable-source-maps', path.join(__dirname, 'harness.js'), snippet.outputFile, resultFile], {
    cwd: work,
    env: childEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const timer = setTimeout(() => child.kill('SIGKILL'), snippetTimeout)
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    let result
    try {
      result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
    } catch (_) {
      result = undefined
    }
    resolve({ code, signal, output, result })
  })
})

const runAll = async (work, snippets) => {
  const queue = snippets.slice()
  const workers = Math.max(2, Math.min(8, os.cpus().length))
  const runWorker = async () => {
    for (let snippet = queue.shift(); snippet; snippet = queue.shift()) {
      snippet.run = await runSnippet(work, snippet)
    }
  }
  await Promise.all(Array.from({ length: workers }, runWorker))
}

// ---------------------------------------------------------------------------------------------------------------------
// Evaluation

/** Replaces positions in the generated snippet files with Markdown positions. */
const mapStack = (snippet, text) => {
  if (!text) return ''
  const files = [snippet.sourceFile, snippet.outputFile].filter(Boolean)
  let mapped = text
  for (const file of files) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    mapped = mapped.replace(new RegExp(`(?:file://)?${escaped}:(\\d+)(?::\\d+)?`, 'g'), (match, line) => {
      const location = snippet.lineMap[Number(line) - 1]
      return location ? `${location.file}:${location.line}` : match
    })
  }
  return mapped
}

const quote = text => JSON.stringify(text)
const describeError = (snippet, error) => {
  const message = mapStack(snippet, `${error.name}: ${error.message}`)
  // The first lines of a stack repeat the message; show the frames after it.
  const frames = mapStack(snippet, error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 5)
  return [message, ...frames].join('\n')
}

const evaluateSnippet = snippet => {
  const { run, block, directives } = snippet
  const location = { file: block.file, line: block.fenceLine }
  const problems = snippet.problems
  if (!run.result) {
    const reason = run.signal ? `was killed (${run.signal}, timeout ${snippetTimeout / 1000} s)` : `exited with code ${run.code}`
    problems.push({ ...location, message: `the snippet ${reason} before reporting a result\n${mapStack(snippet, run.output)}` })
    return
  }
  const { prints, throws, uncaught, error } = run.result
  if (error) problems.push({ ...location, message: `the snippet threw ${describeError(snippet, error)}` })
  for (const expectation of snippet.expectations) {
    const at = { file: block.file, line: expectation.line }
    if (expectation.kind === 'prints') {
      const printed = prints.filter(p => p.line === expectation.line)
      if (printed.length === 0 && !error) problems.push({ ...at, message: `expected to print ${quote(expectation.text)}, but the line printed nothing` })
      else if (printed.length > 1) problems.push({ ...at, message: `expected to print once, but printed ${printed.length} times: ${printed.map(p => quote(p.text)).join(', ')}` })
      else if (printed.length === 1 && printed[0].text !== expectation.text) {
        problems.push({ ...at, message: `expected to print ${quote(expectation.text)}, but printed ${quote(printed[0].text)}` })
      }
    } else {
      const records = throws.filter(t => t.line === expectation.line)
      const expected = expectation.name + (expectation.message ? `: ${expectation.message}` : '')
      if (records.length === 0 && !error) problems.push({ ...at, message: `expected to throw ${expected}, but the line did not run` })
      for (const record of records) {
        if (!record.threw) problems.push({ ...at, message: `expected to throw ${expected}, but it did not throw` })
        else if (record.name !== expectation.name || (expectation.message && !record.message.includes(expectation.message))) {
          problems.push({ ...at, message: `expected to throw ${expected}, but it threw ${record.name}: ${record.message}` })
        }
      }
    }
  }
  const expectedUncaught = directives.uncaught
  for (const failure of uncaught) {
    if (expectedUncaught && failure.name === expectedUncaught && failure.kind === 'uncaught exception') continue
    problems.push({ ...location, message: `${failure.kind}: ${describeError(snippet, failure)}` })
  }
  if (expectedUncaught && !uncaught.some(f => f.name === expectedUncaught && f.kind === 'uncaught exception')) {
    problems.push({ ...location, message: `expected an uncaught ${expectedUncaught} (uncaught=${expectedUncaught}), but there was none` })
  }
  if (run.code !== 0 && problems.length === 0) {
    problems.push({ ...location, message: `the snippet exited with code ${run.code}\n${mapStack(snippet, run.output)}` })
  }
}

const normalizeMessage = text => {
  const lines = text.split(/\r?\n/).map(line => line.trimEnd().replace(/^(\s*called at ).*$/, '$1…'))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

const evaluateMessageCheck = ({ block, snippet }, problems) => {
  const location = { file: block.file, line: block.fenceLine }
  const throwsLines = snippet.expectations.filter(e => e.kind === 'throws')
  if (throwsLines.length === 0) {
    problems.push({ ...location, message: 'error-message block: the code block before it has no "// throws" line' })
    return
  }
  if (!snippet.run || !snippet.run.result) {
    problems.push({ ...location, message: 'error-message block: the code block before it did not run' })
    return
  }
  const last = throwsLines[throwsLines.length - 1]
  const record = snippet.run.result.throws.find(t => t.line === last.line && t.threw)
  if (!record) {
    problems.push({ ...location, message: `error-message block: line ${last.line} did not throw` })
    return
  }
  const expected = normalizeMessage(block.code.join('\n'))
  const actual = normalizeMessage(`${record.name}: ${record.message}`)
  if (expected !== actual) {
    problems.push({ ...location, message: `error-message block does not match the message thrown on line ${last.line}.\n--- expected (README)\n${expected}\n--- actual\n${actual}` })
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Checks the code blocks of the given Markdown files. Returns every problem, and per code block the problems that
 * belong to it (used by spec-docs/self-test.js).
 */
const checkDocs = async ({ files = defaultFiles, keep = false } = {}) => {
  const absolute = files.map(file => path.resolve(root, file))
  const texts = absolute.map(file => ({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }))
  const parsed = texts.map(({ file, text }) => parseMarkdown(file, text))
  const { snippets, messageChecks, problems: buildProblems } = buildSnippets(parsed)
  const problems = [...parsed.flatMap(p => p.problems), ...buildProblems, ...texts.flatMap(({ file, text }) => checkLinks(file, text))]

  if (!fs.existsSync(path.join(root, 'dist', 'index.js')) || !fs.existsSync(path.join(root, 'dist', 'index.mjs'))) {
    problems.push({ file: 'dist', line: 0, message: 'dist/ is not built: run `npm run build` first (or `npm run test:docs`)' })
    return { problems, snippets, blocks: parsed.flatMap(p => p.blocks), files: texts.map(t => t.file) }
  }

  const work = prepareWorkDirectory()
  try {
    problems.push(...typeCheckAndEmit(work, snippets))
    for (const snippet of snippets.filter(s => s.kind === 'js')) {
      snippet.outputFile = path.join(work, 'out', snippet.id + snippet.extension)
      fs.writeFileSync(snippet.outputFile, snippet.source.join('\n') + '\n')
    }
    const runnable = snippets.filter(s => !s.directives.compileOnly && !s.typeErrors && s.problems.length === 0)
    await runAll(work, runnable)
    for (const snippet of runnable) evaluateSnippet(snippet)
    for (const check of messageChecks) evaluateMessageCheck(check, problems)
  } finally {
    if (keep) console.log(`docs-check: kept the generated files in ${work}`)
    else fs.rmSync(work, { recursive: true, force: true })
  }
  for (const snippet of snippets) problems.push(...snippet.problems)
  return {
    problems,
    snippets,
    blocks: parsed.flatMap(p => p.blocks),
    files: texts.map(t => t.file),
    runnableCount: snippets.filter(s => s.run).length
  }
}

const formatProblem = problem => `${problem.file}:${problem.line}: ${problem.message.replace(/\n/g, '\n    ')}`

const main = async () => {
  const args = process.argv.slice(2)
  const keep = args.includes('--keep')
  const files = args.filter(arg => !arg.startsWith('--'))
  const started = Date.now()
  const result = await checkDocs({ files: files.length > 0 ? files : defaultFiles, keep })
  const { problems, snippets, blocks, runnableCount } = result
  const unique = [...new Map(problems.map(p => [formatProblem(p), p])).values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const checkedFiles = result.files.join(', ')
  const skipped = blocks.filter(b => checkedLanguages[b.language] && b.directives.skip).length
  const compileOnly = snippets.filter(s => s.directives.compileOnly).length
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  for (const problem of unique) console.error(formatProblem(problem))
  console.log(`docs-check: ${snippets.length} code blocks in ${checkedFiles}: ${runnableCount || 0} type-checked and run, ` +
    `${compileOnly} only type-checked, ${skipped} skipped; ${unique.length} problem(s) in ${seconds} s`)
  process.exitCode = unique.length > 0 ? 1 : 0
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { checkDocs, parseMarkdown, formatProblem }
