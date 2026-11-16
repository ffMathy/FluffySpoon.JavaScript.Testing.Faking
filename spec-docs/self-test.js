#!/usr/bin/env node
'use strict'
// Checks that the docs check fails when it should: runs it on spec-docs/fixtures/broken.md, whose code blocks are
// broken on purpose, and compares the problems it reports with the `<!-- self-test: expect=<text> -->` comment of each
// block, and with the `<!-- self-test: next-line=<text> -->` comments for problems in the text (links). Part of
// `npm run test:docs`.
const fs = require('fs')
const path = require('path')
const { checkDocs, formatProblem } = require('./check')

const fixture = path.join('spec-docs', 'fixtures', 'broken.md')

const main = async () => {
  const { problems, blocks } = await checkDocs({ files: [fixture] })
  const failures = []
  const claimed = new Set()
  for (const block of blocks) {
    const comment = block.comments.find(text => text.startsWith('self-test:'))
    if (!comment) {
      failures.push(`${fixture}:${block.fenceLine}: the block has no <!-- self-test: expect=... --> comment`)
      continue
    }
    const expected = comment.replace(/^self-test:\s*expect=/, '').trim()
    const lastLine = block.fenceLine + block.code.length + 1
    const own = problems.filter(problem => problem.line >= block.fenceLine && problem.line <= lastLine)
    own.forEach(problem => claimed.add(problem))
    if (expected === 'pass') {
      if (own.length > 0) failures.push(`${fixture}:${block.fenceLine}: expected no problems, but got:\n  ${own.map(formatProblem).join('\n  ')}`)
    } else if (!own.some(problem => problem.message.includes(expected))) {
      failures.push(`${fixture}:${block.fenceLine}: expected a problem containing ${JSON.stringify(expected)}, but got:\n  ` +
        (own.length > 0 ? own.map(formatProblem).join('\n  ') : '(none)'))
    }
  }
  const lines = fs.readFileSync(path.resolve(__dirname, '..', fixture), 'utf8').split(/\r?\n/)
  let brokenLines = 0
  lines.forEach((line, index) => {
    const comment = /<!--\s*self-test:\s*next-line=(.*?)\s*-->/.exec(line)
    if (!comment) return
    brokenLines++
    const own = problems.filter(problem => problem.line === index + 2)
    own.forEach(problem => claimed.add(problem))
    if (!own.some(problem => problem.message.includes(comment[1]))) {
      failures.push(`${fixture}:${index + 2}: expected a problem containing ${JSON.stringify(comment[1])}, but got:\n  ` +
        (own.length > 0 ? own.map(formatProblem).join('\n  ') : '(none)'))
    }
  })
  for (const problem of problems.filter(p => !claimed.has(p))) {
    failures.push(`unexpected problem outside of the fixture's code blocks: ${formatProblem(problem)}`)
  }
  const broken = blocks.filter(block => !block.comments.some(text => text === 'self-test: expect=pass')).length
  if (failures.length > 0) {
    console.error(failures.join('\n'))
    console.error(`docs-check self-test: ${failures.length} of ${blocks.length} expectations failed`)
    process.exitCode = 1
  } else {
    console.log(`docs-check self-test: all ${broken} deliberately broken code blocks and ${brokenLines} broken links were reported, ` +
      `the ${blocks.length - broken} other code blocks passed`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
