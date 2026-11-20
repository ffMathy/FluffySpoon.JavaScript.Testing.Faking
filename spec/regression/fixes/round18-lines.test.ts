import test from 'ava'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Round 18: the lines, calls and record-path part of the round-17 findings (R17FE-5, R17-ADV-11, R17-ADV-3, R17V-3 =
// R17-ADV-7), decided in the fix spec as E125-E128. The timing tests of E126 and E128 are in
// round18-lines-hashing.test.ts (serial run).

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
 * The layout of tsx 4 (esbuild with minifyWhitespace): the whole file on one line, with a source map that maps the start
 * of each source line to that line. Every line of `source` must end a statement or open or close a block.
 */
const onOneLine = (source: string[], sourceName: string): string => {
  let column = 0
  let previous = 0
  const segments: string[] = []
  source.forEach((line, index) => {
    segments.push(vlq(column - previous) + vlq(0) + vlq(index === 0 ? 0 : 1) + vlq(0))
    previous = column
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
  // and one in the same statement still cancels it (E37)
  'function sameStatement() {',
  '  const sub = Substitute.for();',
  "  sub.log('x');",
  "  try { sub.received(2).log(Arg.any('String')) } catch (error) { }",
  '}',
  'sameStatement();',
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
    'check through io.to(room-b) on one line': "throws: Call count mismatch in @Substitute.to('room-b').emit"
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
