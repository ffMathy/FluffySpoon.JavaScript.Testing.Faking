import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import Substitute, { Arg, Substitute as NamedSubstitute, SubstituteException, received } from '@fluffy-spoon/substitute'
import * as namespace from '@fluffy-spoon/substitute'

// F1: run by test/bundlers.ts with vitest.inline.config.mts, and expected to pass.
const exportNames = Object.keys(createRequire(__filename)('@fluffy-spoon/substitute')).sort()

test('F1 default, named and namespace imports are the real exports when vitest inlines the package', () => {
  expect(typeof Substitute.for).toBe('function')
  expect(Substitute).toBe(NamedSubstitute)
  expect(typeof Arg.any).toBe('function')
  expect(typeof received).toBe('symbol')
  expect(typeof SubstituteException).toBe('function')
  expect(Object.keys(namespace).sort()).toEqual(exportNames)
  expect(Object.keys(namespace).filter(name => (namespace as Record<string, unknown>)[name] === undefined)).toEqual([])
})

test('F1 the inlined package works', () => {
  const calculator = Substitute.for<{ add(a: number, b: number): number }>()
  calculator.add(1, Arg.any()).returns(3)
  expect(calculator.add(1, 2)).toBe(3)
  calculator[received](1).add(1, 2)
  expect(() => calculator.received(2).add(1, 2)).toThrow(SubstituteException)
})
