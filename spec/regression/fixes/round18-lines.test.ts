import test from 'ava'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { Substitute, Arg, mimick, received, didNotReceive } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 18: the lines, calls and record-path part of the round-17 findings (R17FE-5, R17-ADV-11, R17-ADV-3, R17V-3 =
// R17-ADV-7), decided in the fix spec as E125-E128. E128 (not met, see the report) has no test here.

const library = path.resolve(__dirname, '../../../src/index.js')

// ---- E125 (R17FE-5): the line rules on code that a transpiler put on one line ---------------------------------------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** A number in a source map's base64 VLQ. */
const vlq = (value: number): string => {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1
  let text = ''
  do {
    let digit = rest & 31
    rest >>>= 5
    if (rest > 0) digit |= 32
    text += BASE64[digit]
  } while (rest > 0)
  return text
}

/**
 * The layout of tsx 4 (esbuild with minifyWhitespace): the whole file on one line, with a source map that maps the first
 * token of each source line to that line, and, as tsc and esbuild do, the name after a leading dot rather than the dot
 * (V8 puts a property read of a chain at the dot). Every line of `source` must end a statement, open or close a block,
 * or continue a chain.
 */
const onOneLine = (source: string[], sourceName: string): string => {
  let column = 0
  let previous = 0
  let previousOriginal = 0
  const segments: string[] = []
  source.forEach((line, index) => {
    const indent = line.length - line.trimStart().length
    const token = indent + (line.trimStart().startsWith('.') ? 1 : 0)
    segments.push(vlq(column + token - previous) + vlq(0) + vlq(index === 0 ? 0 : 1) + vlq(token - previousOriginal))
    previous = column + token
    previousOriginal = token
    column += line.length + 1
  })
  const map = { version: 3, sources: [sourceName], names: [] as string[], mappings: segments.join(','), sourcesContent: [source.join('\n')] }
  return `${source.join(' ')}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`
}

/** The test code of the R17FE-5 repros (fe17 c-jobs/probes/tsxline: wrongpass.ts, readme1.ts, deferred.ts). */
const scenario = [
  `const { Substitute, Arg, mimick } = require(${JSON.stringify(library)});`,
  'const results = {};',
  "const report = (label, check) => { try { check(); results[label] = 'passes' } catch (error) { results[label] = 'throws: ' + error.message.split(':')[0] } };",
  'const reported = [];',
  "process.on('uncaughtException', error => { reported.push(error.message.split(':')[0]) });",
  // part A: a self-returning setup, a call of the test, and a check on the NEXT line (README 'Which calls lead to a setup or a check')
  'function mapCase() {',
  '  const map = Substitute.for();',
  '  map.set(Arg.all()).returns(map);',
  "  map.set('b', 2);",
  "  map.didNotReceive().set('b', 2);",
  '}',
  "report('map didNotReceive on the next line', mapCase);",
  'function readmeMap() {',
  '  const map = Substitute.for();',
  '  map.set(Arg.all()).returns(map);',
  "  if (map.set('b', 2) !== map) throw new Error('not fluent');",
  "  map.received(1).set('b', 2);",
  '}',
  "report('map received(1) on the next line', readmeMap);",
  'function mimickCase() {',
  '  const emitter = Substitute.for();',
  '  emitter[mimick]({ on() { return this } });',
  "  emitter.on('data', () => {});",
  "  emitter.didNotReceive().on('data', Arg.any());",
  '}',
  "report('mimicked on() then didNotReceive on the next line', mimickCase);",
  'function loggerCase() {',
  '  const logger = Substitute.for();',
  '  logger[mimick]({ info() { return this }, warn() { return this } });',
  "  if (logger.info('a', { x: 1 }).warn('b') !== logger) throw new Error('not fluent');",
  "  logger.received(1).info('a', { x: 1 });",
  '}',
  "report('mimicked fluent logger, received(1) on the next line', loggerCase);",
  // README 'Through a call with matchers': a stored handle on a later line is a check of io itself; one line narrows
  'function storedHandle() {',
  '  const io = Substitute.for();',
  '  io.to(Arg.any()).returns(io);',
  "  io.to('room-a').emit('m');",
  "  const roomB = io.to('room-b');",
  "  roomB.didNotReceive().emit('m');",
  '}',
  "report('stored handle, didNotReceive on a later line', storedHandle);",
  'function oneLine() {',
  '  const io = Substitute.for();',
  '  io.to(Arg.any()).returns(io);',
  "  io.to('room-a').emit('m');",
  "  io.to('room-b').received(1).emit('m');",
  '}',
  "report('check through io.to(room-b) on one line', oneLine);",
  // a check over two lines is a check of io itself (the dot of `.received` belongs to the second line)
  'function twoLines() {',
  '  const io = Substitute.for();',
  '  io.to(Arg.any()).returns(io);',
  "  io.to('room-a').emit('m');",
  "  io.to('room-b')",
  "    .received(1).emit('m');",
  '}',
  "report('check through io.to(room-b) over two lines', twoLines);",
  // part B: a matcher usage error in a later statement never cancels the report of an earlier check (README 'Assertions that fail later')
  'function deferredRead() {',
  '  const sub = Substitute.for();',
  '  sub.m(1);',
  '  void sub.didNotReceive().m;',
  "  try { Arg.any('Strin') } catch (error) { }",
  '}',
  'deferredRead();',
  'function danglingView() {',
  '  const next = Substitute.for();',
  '  next.didNotReceive();',
  "  try { Arg.is('x') } catch (error) { }",
  '}',
  'danglingView();',
  // and one in the same statement still cancels it (E37), also in a chain over lines with the arguments on the member's line
  'function sameStatement() {',
  '  const sub = Substitute.for();',
  "  sub.log('x');",
  "  try { sub.received(2).log(Arg.any('String')) } catch (error) { }",
  '}',
  'sameStatement();',
  'function chainOverLines() {',
  '  const logger = Substitute.for();',
  "  logger.log('a');",
  '  try {',
  '    logger',
  '      .received(2)',
  "      .log(Arg.any('String'));",
  '  } catch (error) { }',
  '}',
  'chainOverLines();',
  'setTimeout(() => console.log(JSON.stringify({ results, reported })), 20);'
]

type Outcome = { results: Record<string, string>, reported: string[] }

/** Runs `code` as a file of its own (a temporary directory, removed after) and returns what it printed. */
const runFile = (code: string, args: string[]): Outcome => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'substitute-r18-lines-'))
  try {
    const file = path.join(directory, 'checks.js')
    fs.writeFileSync(file, code)
    const result = spawnSync(process.execPath, [...args, file], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
    if (result.status !== 0) throw new Error(`exit code ${result.status}: ${result.stderr}`)
    return JSON.parse(result.stdout)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

/** What the scenario gives when its statements are on lines of their own, as README documents. */
const documented: Outcome = {
  results: {
    'map didNotReceive on the next line': 'throws: Call count mismatch in @Substitute.set',
    'map received(1) on the next line': 'passes',
    'mimicked on() then didNotReceive on the next line': 'throws: Call count mismatch in @Substitute.on',
    'mimicked fluent logger, received(1) on the next line': 'passes',
    'stored handle, didNotReceive on a later line': 'throws: Call count mismatch in @Substitute.emit',
    'check through io.to(room-b) on one line': "throws: Call count mismatch in @Substitute.to('room-b').emit",
    'check through io.to(room-b) over two lines': 'passes'
  },
  reported: ['Call count mismatch in @Substitute.m', '@Substitute.didNotReceive() checked nothing']
}

test('R17FE-5 (E125) control: the scenario with a statement per line gives the documented results', t => {
  t.deepEqual(runFile(scenario.join('\n') + '\n', []), documented)
})

test('R17FE-5 (E125) a file on one line with a source map (tsx\'s layout) gives the same results as a statement per line', t => {
  // source maps on, as tsx turns them on: the rules compare the lines of the source
  const code = onOneLine(scenario, 'checks.ts')
  t.is(code.split('\n').length, 3, 'the whole code is on one line')
  t.deepEqual(runFile(code, ['--enable-source-maps']), documented)
})

test('R17FE-5 (E125) without a source map, statements on one line of the file that runs are on one line (the documented limitation)', t => {
  // e.g. minified or bundled test code without source maps: the second statement continues the first one's expression
  const outcome = runFile(onOneLine(scenario, 'checks.ts'), [])
  t.is(outcome.results['map didNotReceive on the next line'], 'passes')
  t.is(outcome.results['map received(1) on the next line'], "throws: Call count mismatch in @Substitute.set('b', 2).set")
  // and the usage error of a later statement cancels the report of the earlier check on that line
  t.deepEqual(outcome.reported, [])
})

// ---- E126 (R17-ADV-11): links to a hand-out of the substitute itself ----------------------------------------------------

const passes = (check: () => void): boolean => {
  try {
    check()
    return true
  } catch (error) {
    if (error instanceof SubstituteException) return false
    throw error
  }
}

test('R17-ADV-11 (E126) a link to a hand-out of the substitute itself is still decided by E111\'s line rule when a setup or a check uses it', t => {
  // one line: the setup continues the call that answered map itself, which is not recorded (README)
  const map = Substitute.for<any>()
  map.set(Arg.all()).returns(map)
  map.set('b', 2).get(Arg.any()).returns(5)
  t.is(map.get('x'), 5)
  t.notThrows(() => map.didNotReceive().set('b', 2))
  // the next line: a check of map itself, which counts the test's own call
  map.set('c', 3)
  t.notThrows(() => map.received(1).set('c', 3))
  t.false(passes(() => map.didNotReceive().set('c', 3)))

  // a check through a concrete call on one line narrows, on a later line it counts every call (E111(b), E99)
  const io = Substitute.for<any>()
  io.to(Arg.any()).returns(io)
  io.to('room-a').emit('m')
  t.false(passes(() => io.to('room-b').received(1).emit('m')))
  t.true(passes(() => io.to('room-b')[didNotReceive]().emit('m')))
  const roomB = io.to('room-b')
  t.true(passes(() => roomB.received(1).emit('m')))

  // a mimicked fluent chain, checked through its own call on one line
  const fluent = Substitute.for<any>()
  fluent[mimick]({ on() { return this }, emit() { return true } })
  fluent.on('a').emit('x')
  t.true(passes(() => fluent.on('a')[received](1).emit('x')))
  t.false(passes(() => fluent.on('b')[received](1).emit('x')))
})

test('R17-ADV-11 (E126) a read right after a hand-out of the substitute itself, invoked later, is decided where it is invoked', t => {
  // read on the line of the call that answered map itself, invoked on the next line: the setup leaves that call recorded
  // (the invocation is a call made where it is invoked, E1; E111's line rule)
  const map = Substitute.for<any>()
  map.set(Arg.all()).returns(map)
  const get = map.set('k', 1).get
  get('x').returns(5)
  t.is(map.get('x'), 5)
  t.notThrows(() => map.received(1).set('k', 1))
  // read and invoked on that line: the setup continues the call that answered map itself, which is not recorded
  const other = Substitute.for<any>()
  other.set(Arg.all()).returns(other)
  other.set('k', 1).get('x').returns(5)
  t.is(other.get('x'), 5)
  t.notThrows(() => other.didNotReceive().set('k', 1))
})
